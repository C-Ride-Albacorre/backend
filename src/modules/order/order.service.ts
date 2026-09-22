import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import {
  CreateOrderDto,
  DropoffLocationDto,
  OrderSummaryDto,
  PickupLocationDto,
} from '../customer/dto/order.dto';
import {
  AssignmentStatus,
  CartItemType,
  CartStatus,
  OrderStatus,
  OrderType,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { CartService } from '../cart/cart.service';
import Helper from '../../shared/utils/helpers';
import { DateTime } from 'luxon';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { NotificationService } from '../notification/notification.service';
import { DriverAssignmentService } from '../driver/driver-assignment.service';
import { MapGateway } from 'src/common/map-gateway/map.gateway';
import { TrackingDataResponseDto } from './dto/tracking-response.dto';
import { REDIS_CLIENT } from '../redis/redis.provider';
import Redis from 'ioredis';
import { DriverHistoryDto } from '../driver/dto/driver-history.dto';

type TransitionContext = {
  actorId?: string;
  actorRole?: Role;
  reason?: string;
  metadata?: any;
  respondedAt?: Date;
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private readonly TIMEZONE = 'Africa/Lagos';

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    @Inject(REDIS_CLIENT) public redis: Redis,
    //private driverAssignment: DriverAssignmentService,

    @Inject(forwardRef(() => DriverAssignmentService))
    private readonly driverAssignment: DriverAssignmentService,
    private notification: NotificationService,
    @InjectQueue('order-events') private orderQueue: Queue,
    private mapGateway: MapGateway // 👈 inject the gateway

  ) { }

  transitions: Record<
    string,
    { from: OrderStatus[]; to: OrderStatus; action: string }
  > = {
      confirm_payment: {
        from: [OrderStatus.ORDER_PLACED], // after payment verification
        to: OrderStatus.CONFIRMED,
        action: 'CONFIRMED',
      },
      vendor_accept: {
        from: [OrderStatus.CONFIRMED],
        to: OrderStatus.ORDER_ACCEPTED,
        action: 'VENDOR_ACCEPT',
      },
      assign_driver: {
        from: [OrderStatus.ORDER_ACCEPTED],
        to: OrderStatus.ORDER_ASSIGNED,
        action: 'ASSIGN_DRIVER',
      },
      pickup: {
        from: [OrderStatus.ORDER_ASSIGNED],
        to: OrderStatus.PICKED_UP,
        action: 'PICKUP',
      },
      deliver: {
        from: [OrderStatus.PICKED_UP],
        to: OrderStatus.DELIVERED,
        action: 'DELIVER',
      },
      cancel: {
        from: [OrderStatus.ORDER_PLACED, OrderStatus.CONFIRMED, OrderStatus.ORDER_ACCEPTED],
        to: OrderStatus.CANCELLED,
        action: 'CANCEL',
      },
    };


  async transition(
    orderId: string,
    targetStatus: OrderStatus,
    context: TransitionContext,
  ) {
    // 1. Perform the database transaction
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // a) Fetch current order with necessary relations
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { driverAssignment: true },
      });
      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }

      const currentStatus = order.orderStatus;

      // b) Validate transition
      const transitionKey = Object.keys(this.transitions).find(
        (key) =>
          this.transitions[key].to === targetStatus &&
          this.transitions[key].from.includes(currentStatus),
      );
      if (!transitionKey) {
        throw new BadRequestException(
          `Invalid transition from ${currentStatus} to ${targetStatus}`,
        );
      }
      const rule = this.transitions[transitionKey];

      // c) Build update data
      const updateData: any = {
        orderStatus: targetStatus,
        statusHistory: {
          push: {
            status: targetStatus,
            timestamp: new Date().toISOString(),
            note: rule.action,
            actorId: context.actorId,
            reason: context.reason,
            respondedAt: context.respondedAt,
          },
        },
      };

      // d) Set specialised timestamps based on target status
      if (targetStatus === OrderStatus.ORDER_ACCEPTED) {
        updateData.vendorAcceptedAt = new Date();
      } else if (targetStatus === OrderStatus.ORDER_ASSIGNED) {
        updateData.driverAssignedAt = new Date();
      } else if (targetStatus === OrderStatus.PICKED_UP) {
        updateData.pickedUpAt = new Date();
      } else if (targetStatus === OrderStatus.DELIVERED) {
        updateData.deliveredAt = new Date();
      }

      // e) Update order
      const updated = await tx.order.update({
        where: { id: orderId },
        data: updateData,
      });

      // f) Log activity
      await tx.orderActivityLog.create({
        data: {
          orderId,
          actorId: context.actorId,
          actorRole: context.actorRole,
          action: rule.action,
          fromStatus: currentStatus,
          toStatus: targetStatus,
          reason: context.reason,
          metadata: context.metadata,
        },
      });

      // g) Enqueue background job (side effects)
      await this.orderQueue.add(
        rule.action,
        { orderId, context },
        { attempts: 3 },
      );


      // Inside transition, after the transaction and before returning:
      if (targetStatus === OrderStatus.DELIVERED || targetStatus === OrderStatus.CANCELLED || targetStatus === OrderStatus.PENDING || targetStatus === OrderStatus.CONFIRMED) {
        await this.driverAssignment.removeEtaScheduler(orderId).catch(err => {
          this.logger.warn(`Failed to remove ETA scheduler for ${orderId}: ${err.message}`);
        });
      }


      // Return the updated order from the transaction
      return updated;
    });

    // 2. 🔔 EMIT WEBSOCKET EVENT AFTER TRANSACTION COMMITS
    try {
      // Ensure we have a history array (if not, fallback to empty)
      const history = updatedOrder.statusHistory || [];
      this.mapGateway.emitOrderStatus(orderId, targetStatus, history);
      this.logger.log(`📡 Emitted order-status for ${orderId}: ${targetStatus}`);
    } catch (error) {
      // Log but do not throw – status change is already persisted
      this.logger.error(
        `Failed to emit order-status for ${orderId}: ${error}`,
        error,
      );
    }

    // 3. Return the updated order
    return updatedOrder;
  }

  buildFullAddressOld(location: DropoffLocationDto): string {
    return [
      location.address,
      location.country,
      location.city,
      location.state,
      location.postalCode,
      location.country,
    ]
      .filter(Boolean)
      .join(', ');
  }

  buildFullAddressold1(loc: any): string {
    const parts = [
      loc.street,
      loc.city,
      loc.state,
      loc.postalCode,
      loc.country,
    ]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0);

    // Dedup consecutive-equal-ish tokens; drop the trailing country if
    // it already appeared earlier in the string.
    const deduped: string[] = [];
    for (const part of parts) {
      if (!deduped.includes(part)) deduped.push(part);
    }
    return deduped.join(', ');
  }

  buildFullAddress(loc: any): string {
  const parts = [
    loc.address,
    loc.city,
    loc.state,
    loc.country,
  ]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0);

  return parts.join(', ');
}


  /**
   * Create an order from a cart.
   * - Uses row‑level locking to prevent double checkout.
   * - Builds cart summary inside the transaction before changing cart status.
   * - Supports idempotency key to prevent duplicate orders.
   * - Validates store hours and daily limits atomically.
   * - Retries on transient transaction failures.
   */
  // async createOrderOld(
  //   userId: string,
  //   dto: CreateOrderDto,
  // ): Promise<OrderSummaryDto> {
  //   const requestId = crypto.randomUUID();
  //   this.logger.log(
  //     `[${requestId}] ORDER_CREATE_STARTED user=${userId} cart=${dto.cartId}`,
  //   );

  //   // ----- Pre-transaction fast validations (no lock) -----
  //   const existingCart = await this.prisma.cart.findUnique({
  //     where: { id: dto.cartId },
  //     select: { id: true, userId: true, status: true },
  //   });
  //   if (!existingCart) throw new NotFoundException('Cart not found');
  //   if (existingCart.userId !== userId)
  //     throw new ForbiddenException('Access denied');
  //   if (existingCart.status !== CartStatus.ACTIVE)
  //     throw new BadRequestException(`Cart is ${existingCart.status}`);

  //   // ----- Idempotency check (if key provided) -----
  //   if (dto.idempotencyKey) {
  //     const existing = await this.prisma.idempotencyRecord.findUnique({
  //       where: { key: dto.idempotencyKey },
  //     });
  //     if (existing?.orderId) {
  //       this.logger.log(
  //         `[${requestId}] Idempotent request, returning existing order ${existing.orderId}`,
  //       );
  //       return this.getOrderSummary(existing.orderId, userId);
  //     }
  //   }

  //   // ----- Precompute time‑based values (constant across retries) -----
  //   const timezone = 'Africa/Lagos';
  //   const now = DateTime.now().setZone(timezone);
  //   const currentMinutes = now.hour * 60 + now.minute;
  //   // const todayWeekday = now.toFormat('cccc');
  //   const todayWeekday = now.weekdayLong.toUpperCase();
  //   const startOfDay = now.startOf('day').toJSDate();
  //   const endOfDay = now.endOf('day').toJSDate();
  //   const orderNumber = Helper.generateOrderNumber();
  //   const orderCode = Helper.generate4DigitCode();

  //   const MAX_RETRIES = 3;
  //   let lastError: any;

  //   // Before transaction
  //   let enrichedDropoffLocation = null;

  //   if (dto.dropoffLocation) {
  //     const address = this.buildFullAddress(dto.dropoffLocation);

  //     this.logger.log(`checking customer's address ${address}`)


  //     const coordinates = await Helper.geocodeAddress(address);

  //     if (!coordinates) {
  //       this.logger.log('Invalid dropoff address. Unable to determine location.')
  //       throw new BadRequestException(
  //         'Invalid dropoff address. Unable to determine location.',
  //       );
  //     }

  //     enrichedDropoffLocation = {
  //       ...dto.dropoffLocation,
  //       latitude: coordinates.lat,
  //       longitude: coordinates.lng,
  //     };
  //   }

  //   for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  //     try {
  //       const order = await this.prisma.$transaction(
  //         async (tx) => {
  //           // --------------------------------------------------------------
  //           // 1. Lock the cart row (SELECT FOR UPDATE)
  //           // --------------------------------------------------------------
  //           const lockedCart = await tx.$queryRaw<
  //             Array<{ id: string; userId: string; status: string }>
  //           >`
  //           SELECT id, "userId", status FROM "Cart" WHERE id = ${dto.cartId} FOR UPDATE
  //         `;
  //           if (!lockedCart.length)
  //             throw new NotFoundException('Cart not found');
  //           if (lockedCart[0].userId !== userId)
  //             throw new ForbiddenException('Access denied');
  //           if (lockedCart[0].status !== CartStatus.ACTIVE) {
  //             throw new BadRequestException(`Cart is ${lockedCart[0].status}`);
  //           }

  //           // --------------------------------------------------------------
  //           // 2. Fetch full cart with items (row is locked)
  //           // --------------------------------------------------------------
  //           const cartWithItems = await tx.cart.findUnique({
  //             where: { id: dto.cartId },
  //             include: {
  //               items: {
  //                 include: {
  //                   product: {
  //                     include: {
  //                       store: true,
  //                       productImages: {
  //                         orderBy: [
  //                           { isPrimary: 'desc' },
  //                           { displayOrder: 'asc' },
  //                         ],
  //                         take: 1,
  //                       },
  //                     },
  //                   },
  //                   package: { include: { store: true } },
  //                 },
  //               },
  //             },
  //           });
  //           if (!cartWithItems) throw new NotFoundException('Cart not found');

  //           // --------------------------------------------------------------
  //           // 3. Build cart summary from fetched data (before status change)
  //           // --------------------------------------------------------------
  //           const items = cartWithItems.items.map((item) => {
  //             if (item.itemType === 'PRODUCT') {
  //               const product = item.product;
  //               return {
  //                 id: item.id,
  //                 itemType: item.itemType,
  //                 productId: item.productId,
  //                 variantId: item.variantId,
  //                 packageId: null,
  //                 name: product?.productName || 'Product (deleted)',
  //                 imageUrl: product?.productImages?.[0]?.imageUrl || null,
  //                 quantity: item.quantity,
  //                 unitPrice: item.unitPrice,
  //                 totalPrice: item.totalPrice,
  //                 selectedAddons: Array.isArray(item.selectedAddons)
  //                   ? item.selectedAddons
  //                   : [],
  //                 storeId: product?.storeId || null,
  //                 storeName: product?.store?.storeName || null,
  //                 specialInstructions: item.specialInstructions,
  //               };
  //             } else {
  //               const pkg = item.package;
  //               return {
  //                 id: item.id,
  //                 itemType: item.itemType,
  //                 productId: null,
  //                 variantId: null,
  //                 packageId: item.packageId,
  //                 name: pkg?.name || 'Package (deleted)',
  //                 imageUrl: null,
  //                 quantity: item.quantity,
  //                 unitPrice: item.unitPrice,
  //                 totalPrice: item.totalPrice,
  //                 selectedAddons: [],
  //                 storeId: pkg?.storeId || null,
  //                 storeName: pkg?.store?.storeName || null,
  //                 specialInstructions: item.specialInstructions,
  //               };
  //             }
  //           });

  //           const subtotal = items.reduce((sum, i) => sum + i.totalPrice, 0);

  //           // Calculate fees using the transaction client
  //           const deliveryFee = await this.cartService.calculateDeliveryFee(
  //             dto.cartId,
  //             tx,
  //           );
  //           const serviceFee = await this.cartService.calculateServiceFee(
  //             subtotal,
  //             tx,
  //           );
  //           const taxAmount = await this.cartService.calculateTax(subtotal, tx);

  //           const cartSummary = {
  //             cartId: cartWithItems.id,
  //             items,
  //             subtotal,
  //             deliveryFee,
  //             serviceFee,
  //             taxAmount,
  //             totalAmount: subtotal + deliveryFee + serviceFee + taxAmount,
  //           };

  //           if (cartSummary.items.length === 0) {
  //             throw new BadRequestException('Cart is empty');
  //           }

  //           // --------------------------------------------------------------
  //           // 4. Idempotency record creation (if key provided)
  //           // --------------------------------------------------------------
  //           if (dto.idempotencyKey) {
  //             await tx.idempotencyRecord.create({
  //               data: { key: dto.idempotencyKey, status: 'PROCESSING' },
  //             });
  //           }

  //           // --------------------------------------------------------------
  //           // 5. Mark cart as CHECKED_OUT (now safe)
  //           // --------------------------------------------------------------
  //           await tx.cart.update({
  //             where: { id: dto.cartId },
  //             data: {
  //               status: CartStatus.CHECKED_OUT,
  //               checkedOutAt: new Date(),
  //             },
  //           });

  //           // --------------------------------------------------------------
  //           // 6. Store validation with atomic daily limits
  //           // --------------------------------------------------------------
  //           const storeIds = [
  //             ...new Set(
  //               cartSummary.items.map((i) => i.storeId).filter(Boolean),
  //             ),
  //           ] as string[];

  //           if (!storeIds.length) {
  //             throw new BadRequestException('No vendor found for cart');
  //           }

  //           // Fetch store details for validation
  //           const store = await tx.store.findUnique({
  //             where: { id: storeIds[0] },
  //             select: {
  //               id: true,
  //               storeName: true,
  //               storeAddress: true,
  //               latitude: true,
  //               longitude: true,
  //             },
  //           });

  //           if (!store) {
  //             throw new NotFoundException('Vendor store not found');
  //           }

  //           for (const storeId of storeIds) {
  //             await this.validateStoreWithAtomicCounter(
  //               tx,
  //               storeId,
  //               todayWeekday,
  //               currentMinutes,
  //               startOfDay,
  //               endOfDay,
  //             );
  //           }



  //           // --------------------------------------------------------------
  //           // 7. Create order
  //           // --------------------------------------------------------------
  //           const newOrder = await tx.order.create({
  //             data: {
  //               orderNumber,
  //               orderCode,
  //               userId,
  //               orderType: this.determineOrderType(cartSummary.items),
  //               subtotal: cartSummary.subtotal,
  //               deliveryFee: cartSummary.deliveryFee,
  //               serviceFee: cartSummary.serviceFee,
  //               taxAmount: cartSummary.taxAmount,
  //               totalAmount: cartSummary.totalAmount,
  //               deliveryOptionId: dto.deliveryOptionId,
  //               // pickupLocation: dto.pickupLocation
  //               //   ? (dto.pickupLocation as unknown as Prisma.JsonObject)
  //               //   : null,
  //               pickupLocation: {
  //                 storeId: store.id,
  //                 storeName: store.storeName,
  //                 address: store.storeAddress,
  //                 latitude: store.latitude,
  //                 longitude: store.longitude,
  //               } as Prisma.JsonObject,
  //               dropoffLocation: enrichedDropoffLocation
  //                 ? (enrichedDropoffLocation as Prisma.JsonObject)
  //                 : null,
  //               recipientName: dto.recipientName,
  //               recipientPhone: dto.recipientPhone,
  //               deliveryInstructions: dto.deliveryInstructions,
  //               paymentStatus: PaymentStatus.PENDING,
  //               orderStatus: OrderStatus.ORDER_PLACED,
  //               statusHistory: [
  //                 {
  //                   status: OrderStatus.ORDER_PLACED,
  //                   timestamp: now.toISO(),
  //                   note: 'Order created',
  //                 },
  //               ],
  //             },
  //           });

  //           // --------------------------------------------------------------
  //           // 8. Create order items
  //           // --------------------------------------------------------------
  //           await tx.orderItem.createMany({
  //             data: cartSummary.items.map((item) => ({
  //               orderId: newOrder.id,
  //               itemType: item.itemType as CartItemType,
  //               productId: item.itemType === 'PRODUCT' ? item.productId : null,
  //               packageId:
  //                 item.itemType === 'PACKAGE' || item.itemType === 'DOCUMENT'
  //                   ? item.packageId
  //                   : null,
  //               storeId: item.storeId || null,
  //               variantId: item.variantId || null,
  //               selectedAddons: item.selectedAddons || [],
  //               quantity: item.quantity,
  //               unitPrice: item.unitPrice,
  //               totalPrice: item.totalPrice,
  //               specialInstructions: item.specialInstructions || null,
  //             })),
  //           });

  //           // --------------------------------------------------------------
  //           // 9. Update idempotency record to COMPLETED
  //           // --------------------------------------------------------------
  //           if (dto.idempotencyKey) {
  //             await tx.idempotencyRecord.update({
  //               where: { key: dto.idempotencyKey },
  //               data: { status: 'COMPLETED', orderId: newOrder.id },
  //             });
  //           }

  //           return newOrder;
  //         },
  //         {
  //           isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  //           timeout: 15000, // 15 seconds
  //         },
  //       );

  //       this.logger.log(
  //         `[${requestId}] ORDER_CREATE_SUCCESS order=${order.id}`,
  //       );
  //       return this.getOrderSummary(order.id, userId);
  //     } catch (err: any) {
  //       lastError = err;
  //       this.logger.error(
  //         `[${requestId}] Attempt ${attempt} failed: ${err.message}`,
  //         err.stack,
  //       );

  //       const isRetryable = err.code === 'P2034' || err.code === 'P2028';
  //       if (!isRetryable || attempt === MAX_RETRIES) {
  //         // No need to manually reset cart status – transaction rollback already did it
  //         throw err;
  //       }
  //       this.logger.warn(
  //         `[${requestId}] Retrying transaction, attempt ${attempt + 1}`,
  //       );
  //       await new Promise((resolve) => setTimeout(resolve, 100 * attempt)); // exponential backoff
  //     }
  //   }
  //   throw lastError;
  // }

  async createOrder(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<OrderSummaryDto> {
    const requestId = crypto.randomUUID();
    this.logger.log(
      `[${requestId}] ORDER_CREATE_STARTED user=${userId} cart=${dto.cartId}`,
    );

    // ── Pre-transaction fast validations (no lock) ──────────────────────────
    const existingCart = await this.prisma.cart.findUnique({
      where: { id: dto.cartId },
      select: { id: true, userId: true, status: true },
    });
    if (!existingCart) throw new NotFoundException('Cart not found');
    if (existingCart.userId !== userId)
      throw new ForbiddenException('Access denied');
    if (existingCart.status !== CartStatus.ACTIVE)
      throw new BadRequestException(`Cart is ${existingCart.status}`);

    // ── Idempotency check (if key provided) ─────────────────────────────────
    if (dto.idempotencyKey) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: { key: dto.idempotencyKey },
      });
      if (existing?.orderId) {
        this.logger.log(
          `[${requestId}] Idempotent request, returning existing order ${existing.orderId}`,
        );
        return this.getOrderSummary(existing.orderId, userId);
      }
    }

    // ── Precompute time-based values (constant across retries) ──────────────
    const timezone = 'Africa/Lagos';
    const now = DateTime.now().setZone(timezone);
    const currentMinutes = now.hour * 60 + now.minute;
    const todayWeekday = now.weekdayLong.toUpperCase();
    const startOfDay = now.startOf('day').toJSDate();
    const endOfDay = now.endOf('day').toJSDate();
    const orderNumber = Helper.generateOrderNumber();
    const orderCode = Helper.generate4DigitCode();

    const MAX_RETRIES = 3;
    let lastError: any;

    // ── Enrich dropoff location with coordinates (before transaction) ───────
    let enrichedDropoffLocation: {
      latitude: number;
      longitude: number;
      [key: string]: any;
    } | null = null;

    if (dto.dropoffLocation) {
      const address = this.buildFullAddress(dto.dropoffLocation);
    //const address = dto.dropoffLocation.address; // Use the address field directly
    // if (dto.dropoffAddress) {
    //   this.logger.log(
    //     `[${requestId}] Geocoding dropoff address | ` +
    //     `cartId=${dto.cartId} | dropoffAddress="${dto.dropoffAddress}"`,
    //   );

      this.logger.log(
        `[${requestId}] Checking customer's address ${address}`,
      );

      const coordinates = await Helper.geocodeAddress(address);

      if (!coordinates) {
        this.logger.log(
          `[${requestId}] Invalid dropoff address. Unable to determine location.`,
        );
        throw new BadRequestException(
          'Invalid dropoff address. Unable to determine location.',
        );
      }

      enrichedDropoffLocation = {
        ...dto.dropoffLocation,
        latitude: coordinates.lat,
        longitude: coordinates.lng,
      };
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const order = await this.prisma.$transaction(
          async (tx) => {
            // ────────────────────────────────────────────────────────────
            // 1. Lock the cart row (SELECT FOR UPDATE)
            // ────────────────────────────────────────────────────────────
            const lockedCart = await tx.$queryRaw<
              Array<{ id: string; userId: string; status: string }>
            >`
            SELECT id, "userId", status FROM "Cart" WHERE id = ${dto.cartId} FOR UPDATE
          `;
            if (!lockedCart.length)
              throw new NotFoundException('Cart not found');
            if (lockedCart[0].userId !== userId)
              throw new ForbiddenException('Access denied');
            if (lockedCart[0].status !== CartStatus.ACTIVE) {
              throw new BadRequestException(`Cart is ${lockedCart[0].status}`);
            }

            // ────────────────────────────────────────────────────────────
            // 2. Fetch full cart with items (row is locked)
            // ────────────────────────────────────────────────────────────
            const cartWithItems = await tx.cart.findUnique({
              where: { id: dto.cartId },
              include: {
                items: {
                  include: {
                    product: {
                      include: {
                        store: true,
                        productImages: {
                          orderBy: [
                            { isPrimary: 'desc' },
                            { displayOrder: 'asc' },
                          ],
                          take: 1,
                        },
                      },
                    },
                    package: { include: { store: true } },
                  },
                },
              },
            });
            if (!cartWithItems) throw new NotFoundException('Cart not found');
            if (cartWithItems.items.length === 0) {
              throw new BadRequestException('Cart is empty');
            }

            // ────────────────────────────────────────────────────────────
            // 3. Build cart summary items from fetched data
            // ────────────────────────────────────────────────────────────
            const items = cartWithItems.items.map((item) => {
              if (item.itemType === 'PRODUCT') {
                const product = item.product;
                return {
                  id: item.id,
                  itemType: item.itemType,
                  productId: item.productId,
                  variantId: item.variantId,
                  packageId: null,
                  name: product?.productName || 'Product (deleted)',
                  imageUrl: product?.productImages?.[0]?.imageUrl || null,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  totalPrice: item.totalPrice,
                  selectedAddons: Array.isArray(item.selectedAddons)
                    ? item.selectedAddons
                    : [],
                  storeId: product?.storeId || null,
                  storeName: product?.store?.storeName || null,
                  specialInstructions: item.specialInstructions,
                };
              } else {
                const pkg = item.package;
                return {
                  id: item.id,
                  itemType: item.itemType,
                  productId: null,
                  variantId: null,
                  packageId: item.packageId,
                  name: pkg?.name || 'Package (deleted)',
                  imageUrl: null,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  totalPrice: item.totalPrice,
                  selectedAddons: [],
                  storeId: pkg?.storeId || null,
                  storeName: pkg?.store?.storeName || null,
                  specialInstructions: item.specialInstructions,
                };
              }
            });

            const subtotal = items.reduce((sum, i) => sum + i.totalPrice, 0);

            // ────────────────────────────────────────────────────────────
            // 4. Resolve the single vendor store for this cart
            // ────────────────────────────────────────────────────────────
            const storeIds = [
              ...new Set(items.map((i) => i.storeId).filter(Boolean)),
            ] as string[];

            if (!storeIds.length) {
              throw new BadRequestException('No vendor found for cart');
            }
            if (storeIds.length > 1) {
              throw new BadRequestException(
                'Cart contains items from multiple stores',
              );
            }

            const store = await tx.store.findUnique({
              where: { id: storeIds[0] },
              select: {
                id: true,
                storeName: true,
                storeAddress: true,
                latitude: true,
                longitude: true,
                userId: true,
              },
            });
            if (!store) throw new NotFoundException('Vendor store not found');

            // ────────────────────────────────────────────────────────────
            // 5. Calculate fees
            // ────────────────────────────────────────────────────────────

            // 5a. Delivery — distance-based, vehicle-type-config driven.
            //     calculateDeliveryFeeWithMeta uses the SAME resolver as
            //     getDeliveryOptions and returns distance provenance so we
            //     can persist it on the order.
            const deliveryQuote =
              await this.cartService.calculateDeliveryFeeWithMeta(
                dto.cartId,
                enrichedDropoffLocation
                  ? {
                    latitude: enrichedDropoffLocation.latitude,
                    longitude: enrichedDropoffLocation.longitude,
                  }
                  : null,
                dto.deliveryOptionId, // chosen VehicleTypeConfig.id (may be undefined)
                tx,
                requestId,
              );

            const deliveryFee = deliveryQuote.fee;

            // 5b. Service fee — single vendor, single commission lookup
            const serviceFee = await this.cartService.calculateServiceFee(
              subtotal,
              store.userId,
              tx,
            );

            // 5c. Tax — VAT from GlobalSetting.taxRate
            const taxAmount = await this.cartService.calculateTax(subtotal, tx);

            const cartSummary = {
              cartId: cartWithItems.id,
              items,
              subtotal,
              deliveryFee,
              serviceFee: taxAmount + serviceFee,
              taxAmount,
              totalAmount: subtotal + deliveryFee + serviceFee,
            };

            // ────────────────────────────────────────────────────────────
            // 6. Idempotency record creation (if key provided)
            // ────────────────────────────────────────────────────────────
            if (dto.idempotencyKey) {
              await tx.idempotencyRecord.create({
                data: { key: dto.idempotencyKey, status: 'PROCESSING' },
              });
            }

            // ────────────────────────────────────────────────────────────
            // 7. Mark cart as CHECKED_OUT (now safe)
            // ────────────────────────────────────────────────────────────
            await tx.cart.update({
              where: { id: dto.cartId },
              data: {
                status: CartStatus.CHECKED_OUT,
                checkedOutAt: new Date(),
              },
            });

            // ────────────────────────────────────────────────────────────
            // 8. Store validation with atomic daily limits
            // ────────────────────────────────────────────────────────────
            await this.validateStoreWithAtomicCounter(
              tx,
              store.id,
              todayWeekday,
              currentMinutes,
              startOfDay,
              endOfDay,
            );


            const distanceKmRaw = deliveryQuote.distanceKm;
            const distanceKmSafe =
              distanceKmRaw != null && Number.isFinite(distanceKmRaw) ? distanceKmRaw : null;

            // ────────────────────────────────────────────────────────────
            // 9. Create order
            // ────────────────────────────────────────────────────────────
            const newOrder = await tx.order.create({
              data: {
                orderNumber,
                orderCode,
                userId,
                orderType: this.determineOrderType(cartSummary.items),
                subtotal: cartSummary.subtotal,
                deliveryFee: cartSummary.deliveryFee,
                serviceFee: cartSummary.serviceFee,
                taxAmount: cartSummary.taxAmount,
                totalAmount: cartSummary.totalAmount,
                deliveryOptionId: dto.deliveryOptionId,

                // ── Distance provenance (persisted once, matches the fee) ──
                // ── Distance provenance (guarded) ──
                deliveryDistanceKm:
                  distanceKmSafe != null
                    ? new Prisma.Decimal(distanceKmSafe.toFixed(3))
                    : null,
                deliveryDistanceSource:
                  distanceKmSafe != null ? (deliveryQuote.distanceSource ?? null) : null,

                pickupLocation: {
                  storeId: store.id,
                  storeName: store.storeName,
                  address: store.storeAddress,
                  latitude: store.latitude,
                  longitude: store.longitude,
                } as Prisma.JsonObject,
                dropoffLocation: enrichedDropoffLocation
                  ? (enrichedDropoffLocation as Prisma.JsonObject)
                  : null,
                recipientName: dto.recipientName,
                recipientPhone: dto.recipientPhone,
                deliveryInstructions: dto.deliveryInstructions,
                paymentStatus: PaymentStatus.PENDING,
                orderStatus: OrderStatus.ORDER_PLACED,
                statusHistory: [
                  {
                    status: OrderStatus.ORDER_PLACED,
                    timestamp: now.toISO(),
                    note: 'Order created',
                  },
                ],
              },
            });

            // ────────────────────────────────────────────────────────────
            // 10. Create order items
            // ────────────────────────────────────────────────────────────
            await tx.orderItem.createMany({
              data: cartSummary.items.map((item) => ({
                orderId: newOrder.id,
                itemType: item.itemType as CartItemType,
                productId:
                  item.itemType === 'PRODUCT' ? item.productId : null,
                packageId:
                  item.itemType === 'PACKAGE' || item.itemType === 'DOCUMENT'
                    ? item.packageId
                    : null,
                storeId: item.storeId || null,
                variantId: item.variantId || null,
                selectedAddons: item.selectedAddons || [],
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                specialInstructions: item.specialInstructions || null,
              })),
            });

            // ────────────────────────────────────────────────────────────
            // 11. Update idempotency record to COMPLETED
            // ────────────────────────────────────────────────────────────
            if (dto.idempotencyKey) {
              await tx.idempotencyRecord.update({
                where: { key: dto.idempotencyKey },
                data: { status: 'COMPLETED', orderId: newOrder.id },
              });
            }

            this.logger.log(
              `[${requestId}] ORDER_CREATE_TX_COMMITTED order=${newOrder.id} | ` +
              `deliveryFee=${cartSummary.deliveryFee} | ` +
              `distanceKm=${deliveryQuote.distanceKm?.toFixed(2) ?? 'n/a'} | ` +
              `distanceSource=${deliveryQuote.distanceSource ?? 'n/a'}`,
            );

            return newOrder;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 15000, // 15 seconds
          },
        );

        this.logger.log(
          `[${requestId}] ORDER_CREATE_SUCCESS order=${order.id}`,
        );
        return this.getOrderSummary(order.id, userId);
      } catch (err: any) {
        lastError = err;
        this.logger.error(
          `[${requestId}] Attempt ${attempt} failed: ${err.message}`,
          err.stack,
        );

        const isRetryable = err.code === 'P2034' || err.code === 'P2028';
        if (!isRetryable || attempt === MAX_RETRIES) {
          // No need to manually reset cart status – transaction rollback already did it
          throw err;
        }
        this.logger.warn(
          `[${requestId}] Retrying transaction, attempt ${attempt + 1}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt)); // exponential backoff
      }
    }
    throw lastError;
  }


  // ================================
  // Atomic daily limit helper
  // ================================

  private async validateStoreWithAtomicCounter(
    tx: Prisma.TransactionClient,
    storeId: string,
    todayWeekday: string,
    currentMinutes: number,
    startOfDay: Date,
    endOfDay: Date,
  ) {
    // Fetch store with operating hours (non‑transactional read – acceptable)
    const store = await tx.store.findUnique({
      where: { id: storeId },
      include: { operatingHours: true },
    });
    if (!store) throw new NotFoundException(`Store ${storeId} not found`);

    // Atomic daily limit using a counter table
    if (store.dailyOrderLimit && store.dailyOrderLimit > 0) {
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      // Use raw SQL for atomic increment with limit check (database specific)
      // This example uses PostgreSQL syntax; adapt for MySQL.
      const result = await tx.$executeRaw`
        UPDATE store_daily_counters
        SET order_count = order_count + 1
        WHERE store_id = ${storeId}
          AND date = ${date}
          AND order_count + 1 <= ${store.dailyOrderLimit}
      `;
      if (result === 0) {
        // Try to insert initial row if not exists
        try {
          await tx.$executeRaw`
            INSERT INTO store_daily_counters (store_id, date, order_count)
            VALUES (${storeId}, ${date}, 1)
          `;
        } catch (e: any) {
          // If unique violation, another transaction inserted it – retry the update
          const retryResult = await tx.$executeRaw`
            UPDATE store_daily_counters
            SET order_count = order_count + 1
            WHERE store_id = ${storeId}
              AND date = ${date}
              AND order_count + 1 <= ${store.dailyOrderLimit}
          `;
          if (retryResult === 0) {
            throw new BadRequestException(
              `${store.storeName} has reached its daily order limit`,
            );
          }
        }
      }
    }
  }


  /**
   * Get order summary
   */
  /**
   * Get a detailed summary of an order.
   * Only the owning user can access it.
   * Accepts an optional transaction client for use inside larger transactions.
   */
  async getOrderSummary(
    orderId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<OrderSummaryDto> {
    // 1. Validate input
    if (!orderId || !userId) {
      throw new BadRequestException('Order ID and User ID are required');
    }

    const prisma = tx ?? this.prisma;

    // 2. Fetch order with ownership check and detailed relations
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        userId, // ✅ security: only if owned by the user
      },
      include: {
        items: {
          include: {
            // For product items, fetch product details (name, images, store)
            product: {
              include: {
                store: true,
                productImages: {
                  orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
                  take: 1,
                },
              },
            },
            // For package items, fetch package details (name, store)
            package: {
              include: {
                store: true,
              },
            },
          },
        },
        deliveryOption: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found or access denied');
    }

    // 3. Map order items to a clean DTO (similar to cart items but for orders)
    const items = order.items.map((item) => {
      if (item.itemType === 'PRODUCT') {
        const product = item.product;
        const imageUrl = product?.productImages?.[0]?.imageUrl || null;

        return {
          id: item.id,
          itemType: item.itemType,
          productId: item.productId,
          variantId: item.variantId,
          packageId: null,
          name: product?.productName || 'Product (deleted)',
          imageUrl,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          selectedAddons: Array.isArray(item.selectedAddons)
            ? item.selectedAddons
            : [],
          storeId: product?.storeId || null,
          storeName: product?.store?.storeName || null,
          specialInstructions: item.specialInstructions,
        };
      }

      // PACKAGE or DOCUMENT
      const pkg = item.package;
      return {
        id: item.id,
        itemType: item.itemType,
        productId: null,
        variantId: null,
        packageId: item.packageId,
        name: pkg?.name || 'Package (deleted)',
        imageUrl: null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        selectedAddons: [],
        storeId: pkg?.storeId || null,
        storeName: pkg?.store?.storeName || null,
        specialInstructions: item.specialInstructions,
      };
    });

    // 4. Build the full summary DTO
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      items,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      serviceFee: order.serviceFee, // combined service fee and tax
      taxAmount: order.taxAmount,
      totalAmount: order.totalAmount,
      dropoffLocation: order.dropoffLocation as any as DropoffLocationDto, // ensure type safety
      pickupLocation: order.pickupLocation as any as PickupLocationDto,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      deliveryInstructions: order.deliveryInstructions,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      statusHistory: order.statusHistory, // if you want to expose
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      deliveryOption: order.deliveryOption
        ? {
          deliveryOptionId: order.deliveryOption.id,
          name: order.deliveryOption.name,
          // baseFee: order.deliveryOption.baseFee,
          // estimatedDays: order.deliveryOption.estimatedDays,
          // description: order.deliveryOption.description,
          // minDeliveryFee: order.deliveryOption.minDeliveryFee,
          // perKmRate: order.deliveryOption.perKmRate,
          // deliveryType: order.deliveryOption.deliveryType,
          // iconUrl: order.deliveryOption.icon,
        }
        : null,
    };
  }

  /**
   * Get user orders
   */
  async getUserOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: {
        items: {
          take: 1, // preview first item
          include: {
            product: {
              select: {
                productName: true, // ✅ include product name
              },
            },
          },
        },
        deliveryOption: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserOrdersold(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: {
        items: {
          take: 1, // Just preview first item
        },
        deliveryOption: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get order details
   */
  async getOrderDetails(orderId: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
      },
      include: {
        items: {
          include: {
            product: {
              include: {
                productImages: {
                  take: 1,
                  where: { isPrimary: true },
                },
              },
            },
          },
        },
        deliveryOption: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
        orderStatus: { in: ['PENDING', 'PROCESSING'] },
      },
    });

    if (!order) {
      throw new BadRequestException('Order cannot be cancelled');
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        orderStatus: 'CANCELLED',
        statusHistory: JSON.stringify([
          ...(JSON.parse(order.statusHistory as string) || []),
          {
            status: 'CANCELLED',
            timestamp: new Date().toISOString(),
            note: 'Order cancelled by customer',
          },
        ]),
      },
    });

    return {
      success: true,
      message: 'Order cancelled successfully',
      order: updatedOrder,
    };
  }


  private determineOrderType(items: any[]): OrderType {
    const types = new Set(items.map((item) => item.itemType));

    if (types.size === 1) {
      const type = Array.from(types)[0];
      return type === 'PRODUCT' ? 'VENDOR' : type;
    }

    return 'MIXED';
  }

  //////////////////

  async getVendorOrders(
    vendorId: string,
    filters: {
      status?: OrderStatus;
      page?: number;
      limit?: number;
    },
  ) {
    // 1. Get vendor stores
    const stores = await this.prisma.store.findMany({
      where: { userId: vendorId },
      select: { id: true },
    });

    const storeIds = stores.map((s) => s.id);

    if (!storeIds.length) {
      return {
        data: [],
        total: 0,
        page: filters.page || 1,
        limit: filters.limit || 20,
        totalPages: 0,
      };
    }

    // 2. Pagination
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = Math.min(Number(filters.limit) || 20, 100);

    // 3. Build filter

    const where = {
      paymentStatus: PaymentStatus.PAID,
      items: {
        some: {
          storeId: {
            in: storeIds,
          },
        },
      },
      ...(filters.status && {
        orderStatus: filters.status,
      }),
    };

    // 4. Fetch orders
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: {
            where: {
              storeId: {
                in: storeIds,
              },
            },
            include: {
              store: true,
              variant: true,
              product: {
                include: {
                  productImages: true,
                },
              },
            },
          },
          user: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: (page - 1) * limit,
        take: limit,
      }),

      this.prisma.order.count({ where }),
    ]);

    // 5. Transform response
    const data = orders.map((order) => {
      const vendorItems = order.items;

      const vendorSubtotal = vendorItems.reduce(
        (sum, item) => sum + item.totalPrice,
        0,
      );

      const vendorQuantity = vendorItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        orderCode: order.orderCode,
        createdAt: order.createdAt,

        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,

        user: {
          firstName: order.user.firstName,
          lastName: order.user.lastName,
          email: order.user.email,
          phone: order.user.phoneNumber,
          countryCode: order.user.countryCode,
          isVerified: order.user.isVerified,
          profilePicture: order.user.profilePicture,
        },

        items: vendorItems.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,

          product: item.product
            ? {
              id: item.product.id,
              productName: item.product.productName,
              image:
                item.product.productImages?.[0]?.imageUrl ?? null,
            }
            : null,

          variant: item.variant,
          store: item.store,
        })),

        vendorSummary: {
          itemCount: vendorItems.length,
          totalQuantity: vendorQuantity,
          subtotal: vendorSubtotal,
        },
      };
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getVendorOrdersWithoutStatus(
    vendorId: string,
    filters: { status?: string, page?: number; limit?: number },
  ) {
    // 1. Get vendor stores
    const stores = await this.prisma.store.findMany({
      where: { userId: vendorId },
      select: { id: true },
    });

    const storeIds = stores.map((s) => s.id);

    if (!storeIds.length) {
      return {
        data: [],
        total: 0,
        page: filters.page || 1,
        limit: filters.limit || 20,
        totalPages: 0,
      };
    }

    // 2. Pagination
    const page = Math.max(filters.page || 1, 1);
    const limit = Math.min(filters.limit || 20, 100);

    // 3. Vendor order filter (STRICT)
    const where: any = {
      orderStatus: "CONFIRMED",
      paymentStatus: "PAID",
      items: {
        some: {
          storeId: { in: storeIds },
        },
      },
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: {
            where: {
              storeId: { in: storeIds },
            },
            include: {
              store: true,
              variant: true,
              product: {
                include: {
                  productImages: true,
                },
              },
            },
          },
          user: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (page - 1) * limit,
        take: limit,
      }),

      this.prisma.order.count({ where }),
    ]);

    // 5. Transform vendor-safe response
    const data = orders.map((order) => {
      const vendorItems = order.items;

      const vendorSubtotal = vendorItems.reduce(
        (sum, item) => sum + item.totalPrice,
        0,
      );

      const vendorQuantity = vendorItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        orderCode: order.orderCode,
        createdAt: order.createdAt,

        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,

        user: {
          firstName: order.user.firstName,
          lastName: order.user.lastName,
          email: order.user.email,
          phone: order.user.phoneNumber,
          counryCode: order.user.countryCode,
          isVerified: order.user.isVerified,
          profilePicture: order.user.profilePicture,
        },

        items: vendorItems.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,

          product: item.product
            ? {
              id: item.product.id,
              productName: item.product.productName,
              image:
                item.product.productImages?.[0]?.imageUrl ?? null,
            }
            : null,

          variant: item.variant,
          store: item.store,
        })),

        vendorSummary: {
          itemCount: vendorItems.length,
          totalQuantity: vendorQuantity,
          subtotal: vendorSubtotal,
        },
      };
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getVendorOrderById(
    vendorId: string,
    orderId: string,
  ) {
    const stores = await this.prisma.store.findMany({
      where: {
        userId: vendorId,
      },
      select: {
        id: true,
      },
    });

    const storeIds = stores.map((s) => s.id);

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        //orderStatus: "CONFIRMED",
        paymentStatus: "PAID",
        items: {
          some: {
            storeId: {
              in: storeIds,
            },
          },
        },
      },
      include: {
        user: true,
        items: {
          where: {
            storeId: {
              in: storeIds,
            },
          },
          include: {
            store: true,
            variant: true,
            product: {
              include: {
                productImages: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    const vendorSubtotal = order.items.reduce(
      (sum, item) => sum + item.totalPrice,
      0,
    );

    const vendorQuantity = order.items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      orderCode: order.orderCode,

      createdAt: order.createdAt,

      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,

      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,

      deliveryInstructions: order.deliveryInstructions,

      pickupLocation: order.pickupLocation,
      dropoffLocation: order.dropoffLocation,

      user: order.user,

      items: order.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,

        product: item.product
          ? {
            id: item.product.id,
            productName: item.product.productName,
            image:
              item.product.productImages?.[0]?.imageUrl ?? null,
          }
          : null,

        variant: item.variant,
        store: item.store,
      })),

      vendorSummary: {
        itemCount: order.items.length,
        totalQuantity: vendorQuantity,
        subtotal: vendorSubtotal,
      },
    };
  }

  async handleVendorAction(
    orderId: string,
    vendorId: string,
    dto: { action: string; reason?: string },
  ) {
    // Verify vendor owns a store associated with this order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { store: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const isVendorStore = order.items.some(
      (item) => item.store?.userId === vendorId,
    );
    if (!isVendorStore) throw new ForbiddenException('Not your store');

    const existingAction = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    // if (existingAction?.orderStatus === OrderStatus.ORDER_ACCEPTED || existingAction?.orderStatus === OrderStatus.CANCELLED) {
    //   this.logger.warn(`Vendor ${vendorId} attempted to respond to order ${orderId} which is already ${existingAction.orderStatus}`);
    //   throw new ForbiddenException(`Order already responded to with status ${existingAction.orderStatus}`);
    // }
    if (existingAction?.orderStatus !== OrderStatus.CONFIRMED) {
      throw new ConflictException(`Order already processed: ${existingAction.orderStatus}`);
    }

    if (dto.action === 'ACCEPT') {
      // Update vendor action
      await this.transition(orderId, OrderStatus.ORDER_ACCEPTED, {
        actorId: vendorId,
        actorRole: Role.VENDOR,
        respondedAt: new Date()
      });

      let pickupLocation = order.pickupLocation as any;
      if (!pickupLocation || typeof pickupLocation !== 'object' || !pickupLocation.lat || !pickupLocation.lng) {
        const store = order.items[0]?.store;
        if (store?.latitude && store?.longitude) {
          pickupLocation = { lat: store.latitude, lng: store.longitude };
          this.logger.warn(`Using store location as fallback for order ${orderId}`);
        } else {
          throw new BadRequestException('No valid pickup location for this order');
        }
      }
      this.logger.log(`Initiating driver search for order ${orderId} with pickup location: ${JSON.stringify(pickupLocation)}`);

      // Ensure it has lat/lng
      const vendorLocation = {
        lat: pickupLocation.latitude ?? pickupLocation.lat,
        lng: pickupLocation.longitude ?? pickupLocation.lng,
      };

      if (!vendorLocation.lat || !vendorLocation.lng) {
        throw new BadRequestException('Invalid pickup location');
      }
      await this.driverAssignment.initiateDriverSearch(orderId, vendorLocation);

      return {
        success: true,
        message: 'Order accepted. Searching for a driver...',
      };
    } else {

      await this.transition(orderId, OrderStatus.CANCELLED, {
        actorId: vendorId,
        actorRole: Role.VENDOR,
        reason: dto.reason,
        respondedAt: new Date(),
      });
      await this.notification.sendOrderCancelled(
        order.userId,
        order.orderNumber,
        dto.reason,
      );

    }

    return { success: true };
  }


  async getTrackingData(userId: string): Promise<TrackingDataResponseDto> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const driverAssignment = await this.prisma.driverAssignment.findFirst({
      where: {
        driverId: userId,
        order: {
          orderStatus: {
            in: [OrderStatus.ORDER_ACCEPTED, OrderStatus.PICKED_UP, OrderStatus.ORDER_ASSIGNED],
          },
        },
      },
      include: {
        order: {
          include: {
            items: {
              include: {
                store: true,
              },
            },
            driverAssignment: true,
          },
        },
      },
    });

    if (!driverAssignment?.order) {
      throw new NotFoundException(`No active delivery assigned for this driver ${userId}`);
    }

    const { order } = driverAssignment;
    const { driverAssignment: assignment } = order;
    const orderId = order.id;

    // Store
    const store = order.items[0]?.store;

    // Order
    const orderData = {
      id: order.id,
      number: order.orderNumber,
      code: order.orderCode,
      status: order.orderStatus,
      statusHistory: Array.isArray(order.statusHistory)
        ? order.statusHistory
        : [],
      totalAmount: order.totalAmount,
      orderType: order.orderType,
      createdAt: order.createdAt,
      pickupLocation: order.pickupLocation,
      dropoffLocation: order.dropoffLocation,
    };

    // Store
    const storeData = {
      id: store?.id ?? '',
      name: store?.storeName ?? '',
      logo: store?.storeLogo ?? '',
      address: store?.storeAddress ?? '',
      lat: store?.latitude ?? null,
      lng: store?.longitude ?? null,
    };

    // Driver
    let driverData: TrackingDataResponseDto['driver'];
    let assignmentData: TrackingDataResponseDto['assignment'] = null;
    let driverId: string | null = assignment?.driverId ?? null;

    if (driverId) {

      const [driverUser, driverProfile] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: driverId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
            phoneNumber: true,
          },
        }),
        this.prisma.driverProfile.findUnique({
          where: { userId: driverId },
          select: {
            status: true,
            rating: true,
            totalDeliveries: true,
            vehicleMake: true,
            vehicleModel: true,
            licensePlate: true,
          },
        }),
      ]);

      if (driverUser) {

        driverData = {
          id: driverUser.id,
          fullName: `${driverUser.firstName} ${driverUser.lastName}`,
          photo: driverUser.profilePicture,
          phone: driverUser.phoneNumber,

          rating: driverProfile?.rating ?? 0,
          totalTrips: driverProfile?.totalDeliveries ?? 0,

          vehicleMake: driverProfile?.vehicleMake ?? '',
          vehicleModel: driverProfile?.vehicleModel ?? '',
          vehiclePlate: driverProfile?.licensePlate ?? '',

          status: driverProfile?.status ?? 'OFFLINE',
        };
      }

      assignmentData = {
        status: assignment.assignmentStatus as AssignmentStatus,
        assignedAt: assignment.assignedAt,
        etaSeconds: assignment.etaSeconds ?? null,

      };
    }

    // Tracking
    let leg: 'to-vendor' | 'to-customer' | null = null;
    let etaSeconds: number | null = null;
    let polyline: string | null = null;
    let driverLocation: TrackingDataResponseDto['tracking']['driverLocation'] =
      null;
    let destination: TrackingDataResponseDto['tracking']['destination'] = null;

    try {
      const [etaRaw, polylineRaw, destinationRaw, locationRaw] =
        await Promise.all([
          this.redis.get(`order:${orderId}:eta`),
          this.redis.get(`order:${orderId}:polyline`),
          this.redis.get(`order:${orderId}:destination`),
          driverId ? this.redis.get(`driver:${driverId}:loc`) : Promise.resolve(null),
        ]);

      if (etaRaw) {
        const eta = JSON.parse(etaRaw);
        leg = eta.leg ?? null;
        etaSeconds = eta.etaSeconds ?? null;
      }

      polyline = polylineRaw;

      if (destinationRaw) {
        destination = JSON.parse(destinationRaw);
      }

      if (locationRaw) {
        const location = JSON.parse(locationRaw);

        driverLocation = {
          lat: location.lat,
          lng: location.lng,
          heading: location.heading ?? 0,
          timestamp: location.timestamp ?? Date.now(),
        };
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch tracking data for order ${orderId}: ${error}`,
      );
    }

    return {
      order: orderData,
      store: storeData,
      driver: driverData,
      assignment: assignmentData,
      tracking: {
        leg,
        etaSeconds: etaSeconds ?? assignment?.etaSeconds ?? null,
        polyline,
        driverLocation,
        destination,
      },
    };
  }


  // order.service.ts (or a dedicated TrackingService)

  async getTrackingDataWithOrderId(orderId: string): Promise<TrackingDataResponseDto> {
    // 1. Fetch order with store, items, driver assignment and driver profile
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: { store: true }, // include store from first item (assuming one store per order)
        },
        driverAssignment: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    // 2. Extract store info (from first order item's store)
    const firstItem = order.items[0];
    const store = firstItem?.store;

    // 3. Build order object
    const statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    const orderData = {
      id: order.id,
      number: order.orderNumber,
      code: order.orderCode,
      status: order.orderStatus,
      statusHistory,
      totalAmount: order.totalAmount,
      orderType: order.orderType,
      createdAt: order.createdAt,
      pickupLocation: order.pickupLocation,
      dropoffLocation: order.dropoffLocation,
    };

    // 4. Build store object
    const storeData = {
      id: store?.id || '',
      name: store?.storeName || '',
      logo: store?.storeLogo || '',
      address: store?.storeAddress || '',
      lat: store?.latitude ?? null,
      lng: store?.longitude ?? null,
    };

    // 5. Build driver & assignment data (if assigned)
    let driverData = undefined;
    let assignmentData = null;
    let driverId: string | null = null;

    const assignment = order.driverAssignment;
    if (assignment?.driverId) {
      driverId = assignment.driverId;

      const [driverUser, driverProfile] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: driverId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
            phoneNumber: true,
          },
        }),
        this.prisma.driverProfile.findUnique({
          where: { userId: driverId },
          select: {
            status: true,
            rating: true,
            totalDeliveries: true,
            vehicleMake: true,
            vehicleModel: true,
            licensePlate: true,
          },
        }),
      ]);

      if (driverUser) {

        driverData = {
          id: driverUser.id,
          fullName: `${driverUser.firstName} ${driverUser.lastName}`,
          photo: driverUser.profilePicture,
          phone: driverUser.phoneNumber,

          rating: driverProfile?.rating ?? 0,
          totalTrips: driverProfile?.totalDeliveries ?? 0,

          vehicleMake: driverProfile?.vehicleMake ?? '',
          vehicleModel: driverProfile?.vehicleModel ?? '',
          vehiclePlate: driverProfile?.licensePlate ?? '',

          status: driverProfile?.status ?? 'OFFLINE',
        };
      }

      assignmentData = {
        status: assignment.assignmentStatus,
        assignedAt: assignment.assignedAt,
        etaSeconds: assignment.etaSeconds ?? null,
      };
    }

    // 6. Fetch real‑time data from Redis
    let leg: 'to-vendor' | 'to-customer' | null = null;
    let etaSeconds: number | null = null;
    let polyline: string | null = null;
    let driverLocation: { lat: number; lng: number; heading: number; timestamp: number } | null = null;
    let destination: { lat: number; lng: number } | null = null;

    try {
      // ETA and leg from Redis
      const etaKey = `order:${orderId}:eta`;
      const etaRaw = await this.redis.get(etaKey);
      if (etaRaw) {
        const parsed = JSON.parse(etaRaw);
        leg = parsed.leg || null;
        etaSeconds = parsed.etaSeconds || null;
      }

      // Polyline
      const polylineKey = `order:${orderId}:polyline`;
      polyline = await this.redis.get(polylineKey) || null;

      // Destination
      const destKey = `order:${orderId}:destination`;
      const destRaw = await this.redis.get(destKey);
      if (destRaw) {
        destination = JSON.parse(destRaw);
      }

      // Driver location (if driver assigned)
      if (driverId) {
        const locKey = `driver:${driverId}:loc`;
        const locRaw = await this.redis.get(locKey);
        if (locRaw) {
          const parsed = JSON.parse(locRaw);
          driverLocation = {
            lat: parsed.lat,
            lng: parsed.lng,
            heading: parsed.heading || 0,
            timestamp: parsed.timestamp || Date.now(),
          };
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch Redis data for order ${orderId}: ${error}`);
    }

    // 7. Assemble final response
    return {
      order: orderData,
      store: storeData,
      driver: driverData,
      assignment: assignmentData,
      tracking: {
        leg,
        etaSeconds: etaSeconds ?? assignment?.etaSeconds ?? null,
        polyline,
        driverLocation,
        destination,
      },
    };
  }


  async getDriverOrderHistory(
    driverId: string,
    filters: DriverHistoryDto,
  ) {
    const page = Math.max(filters.page ?? 1, 1);
    const limit = Math.min(filters.limit ?? 20, 100);

    const where = {
      driverId,
      order: {
        paymentStatus: PaymentStatus.PAID,
        ...(filters.status
          ? { orderStatus: filters.status }
          : {}),
      },
    };

    const [assignments, total] = await Promise.all([
      this.prisma.driverAssignment.findMany({
        where,
        include: {
          order: {
            include: {
              user: true,
              items: {
                include: {
                  store: true,
                  variant: true,
                  product: {
                    include: {
                      productImages: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          order: {
            createdAt: 'desc',
          },
        },
        skip: (page - 1) * limit,
        take: limit,
      }),

      this.prisma.driverAssignment.count({
        where,
      }),
    ]);

    const data = assignments.map(({ id: assignmentId, order }) => ({
      assignmentId,

      orderId: order.id,
      orderNumber: order.orderNumber,
      orderCode: order.orderCode,

      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,

      totalAmount: order.totalAmount,
      deliveryFee: order.deliveryFee,

      deliveredAt: order.deliveredAt,
      createdAt: order.createdAt,

      customer: {
        id: order.user.id,
        firstName: order.user.firstName,
        lastName: order.user.lastName,
        phoneNumber: order.user.phoneNumber,
        profilePicture: order.user.profilePicture,
      },

      stores: [
        ...new Map(
          order.items
            .filter((item) => item.store)
            .map((item) => [
              item.store!.id,
              {
                id: item.store!.id,
                storeName: item.store!.storeName,
                storeLogo: item.store!.storeLogo,
                phoneNumber: item.store!.phoneNumber,
                address: item.store!.storeAddress,
              },
            ]),
        ).values(),
      ],

      items: order.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,

        product: item.product
          ? {
            id: item.product.id,
            productName: item.product.productName,
            image: item.product.productImages[0]?.imageUrl ?? null,
          }
          : null,

        variant: item.variant
          ? {
            id: item.variant.id,
            name: item.variant.variantName,
          }
          : null,
      })),
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }


  async getDriverHistoryDetails(
    driverId: string,
    orderId: string,
  ) {
    const assignment =
      await this.prisma.driverAssignment.findFirst({
        where: {
          driverId,
          orderId,
        },
        include: {
          order: {
            include: {
              user: true,

              items: {
                include: {
                  store: true,
                  variant: true,
                  product: {
                    include: {
                      addons: true,
                      productImages: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

    if (!assignment) {
      throw new NotFoundException('Order history not found');
    }

    const order = assignment.order;

    return {
      assignment: {
        id: assignment.id,
        status: assignment.assignmentStatus,
        assignedAt: assignment.assignedAt,
        pickedUpAt: assignment.pickupConfirmedAt,
        deliveredAt: assignment.deliveryConfirmedAt,
      },

      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        orderCode: order.orderCode,

        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,

        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        serviceFee: order.serviceFee,
        taxAmount: order.taxAmount,
        totalAmount: order.totalAmount,

        pickupLocation: order.pickupLocation,
        dropoffLocation: order.dropoffLocation,

        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
        deliveryInstructions: order.deliveryInstructions,

        createdAt: order.createdAt,
        deliveredAt: order.deliveredAt,
      },

      customer: {
        id: order.user.id,
        firstName: order.user.firstName,
        lastName: order.user.lastName,
        email: order.user.email,
        phoneNumber: order.user.phoneNumber,
        profilePicture: order.user.profilePicture,
        countryCode: order.user.countryCode,
      },

      stores: [
        ...new Map(
          order.items
            .filter((i) => i.store)
            .map((i) => [
              i.store!.id,
              {
                id: i.store!.id,
                storeName: i.store!.storeName,
                storeLogo: i.store!.storeLogo,
                address: i.store!.storeAddress,
                phoneNumber: i.store!.phoneNumber,
              },
            ]),
        ).values(),
      ],

      items: order.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        specialInstructions: item.specialInstructions,
        selectedAddons: item.selectedAddons,

        product: item.product
          ? {
            id: item.product.id,
            productName: item.product.productName,
            description: item.product.description,
            image:
              item.product.productImages[0]?.imageUrl ?? null,
          }
          : null,

        variant: item.variant,

        addons: item.product?.addons ?? [],
      })),
    };
  }

}
