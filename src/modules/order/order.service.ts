// src/customer/services/order.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import {
  CreateOrderDto,
  DropoffLocationDto,
  OrderSummaryDto,
  PickupLocationDto,
} from '../customer/dto/order.dto';
import {
  CartItemType,
  CartStatus,
  OrderStatus,
  OrderType,
  PaymentStatus,
  Prisma,
  Role,
  VendorActionStatus,
} from '@prisma/client';
import { CartService } from '../cart/cart.service';
import Helper from 'src/shared/utils/helpers';
import { DateTime } from 'luxon';
// import { v4 as uuidv4 } from 'uuid';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { NotificationService } from '../notification/notification.service';
import { DriverService } from '../driver/driver.service';
import { DriverAssignmentService } from '../driver/driver-assignment.service';

type TransitionContext = {
  actorId?: string;
  actorRole?: Role;
  reason?: string;
  metadata?: any;
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private readonly TIMEZONE = 'Africa/Lagos';

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    // private driverAssignment: DriverService,
    private driverAssignment: DriverAssignmentService,
    private notification: NotificationService,
    @InjectQueue('order-events') private orderQueue: Queue,
  ) {}

  transitions: Record<
    string,
    { from: OrderStatus[]; to: OrderStatus; action: string }
  > = {
    confirm_payment: {
      from: [OrderStatus.ORDER_PLACED], // after payment verification
      to: OrderStatus.ORDER_PLACED,
      action: 'ORDER_PLACED',
    },
    vendor_accept: {
      from: [OrderStatus.ORDER_PLACED],
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
      from: [OrderStatus.ORDER_PLACED, OrderStatus.ORDER_ACCEPTED],
      to: OrderStatus.CANCELLED,
      action: 'CANCEL',
    },
  };

  async transition(
    orderId: string,
    targetStatus: OrderStatus,
    context: TransitionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { driverAssignment: true }, //vendorAction: true,
      });
      if (!order) throw new Error('Order not found');

      const current = order.orderStatus;
      const transitionKey = Object.keys(this.transitions).find(
        (key) =>
          this.transitions[key].to === targetStatus &&
          this.transitions[key].from.includes(current),
      );
      if (!transitionKey) {
        throw new BadRequestException(
          `Invalid transition from ${current} to ${targetStatus}`,
        );
      }
      const rule = this.transitions[transitionKey];

      // Update order
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          orderStatus: targetStatus,
          statusHistory: {
            push: {
              status: targetStatus,
              timestamp: new Date().toISOString(),
              note: rule.action,
              actorId: context.actorId,
              reason: context.reason,
            },
          },
          ...(targetStatus === OrderStatus.ORDER_ACCEPTED && {
            vendorAcceptedAt: new Date(),
          }),
          ...(targetStatus === OrderStatus.ORDER_ASSIGNED && {
            driverAssignedAt: new Date(),
          }),
          ...(targetStatus === OrderStatus.PICKED_UP && {
            pickupTime: new Date(),
          }),
          ...(targetStatus === OrderStatus.DELIVERED && {
            deliveryTime: new Date(),
          }),
        },
      });

      // Log activity
      await tx.orderActivityLog.create({
        data: {
          orderId,
          actorId: context.actorId,
          actorRole: context.actorRole,
          action: rule.action,
          fromStatus: current,
          toStatus: targetStatus,
          reason: context.reason,
          metadata: context.metadata,
        },
      });

      // Fire background job for side effects (notifications, etc.)
      await this.orderQueue.add(
        rule.action,
        { orderId, context },
        { attempts: 3 },
      );

      return updated;
    });
  }

  /**
   * Create order from cart
   */
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<OrderSummaryDto> {
    const requestId = crypto.randomUUID();
    this.logger.log(
      `[${requestId}] ORDER_CREATE_STARTED user=${userId} cart=${dto.cartId}`,
    );

    // ----- Pre-transaction fast validations -----
    const existingCart = await this.prisma.cart.findUnique({
      where: { id: dto.cartId },
      select: { id: true, userId: true, status: true },
    });
    if (!existingCart) throw new NotFoundException('Cart not found');
    if (existingCart.userId !== userId)
      throw new ForbiddenException('Access denied');
    if (existingCart.status !== CartStatus.ACTIVE)
      throw new BadRequestException(`Cart is ${existingCart.status}`);

    // ----- Idempotency check (if idempotencyKey provided) -----
    if (dto.idempotencyKey) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: { key: dto.idempotencyKey },
      });
      if (existing && existing.orderId) {
        this.logger.log(
          `[${requestId}] Idempotent request, returning existing order ${existing.orderId}`,
        );
        return this.getOrderSummary(existing.orderId, userId);
      }
    }

    // ----- Precompute time‑based values (constant across retries) -----
    const now = DateTime.now().setZone(this.TIMEZONE);
    const currentMinutes = now.hour * 60 + now.minute;
    const todayWeekday = now.toFormat('cccc');
    const startOfDay = now.startOf('day').toJSDate();
    const endOfDay = now.endOf('day').toJSDate();
    const orderNumber = Helper.generateOrderNumber(); // deterministic, outside loop
    const orderCode = Helper.generate4DigitCode();

    const MAX_RETRIES = 3;
    let lastError: any;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const order = await this.prisma.$transaction(
          async (tx) => {
            // 1. Idempotency record creation (if key provided)
            if (dto.idempotencyKey) {
              await tx.idempotencyRecord.create({
                data: { key: dto.idempotencyKey, status: 'PROCESSING' },
              });
            }

            // 2. Atomic cart lock + mark as CHECKED_OUT
            const lockResult = await tx.cart.updateMany({
              where: { id: dto.cartId, userId, status: CartStatus.ACTIVE },
              data: {
                status: CartStatus.CHECKED_OUT,
                checkedOutAt: new Date(),
              },
            });
            if (lockResult.count === 0) {
              throw new BadRequestException('Cart already being processed');
            }

            // 3. Get cart summary INSIDE transaction
            const cartSummary = await this.cartService.getCartSummary(
              dto.cartId,
              userId,
              undefined,
              tx,
            );
            if (cartSummary.items.length === 0)
              throw new BadRequestException('Cart is empty');

            // 4. Store validation with atomic daily limits
            const storeIds = [
              ...new Set(
                cartSummary.items.map((i) => i.storeId).filter(Boolean),
              ),
            ];
            for (const storeId of storeIds) {
              await this.validateStoreWithAtomicCounter(
                tx,
                storeId as string,
                todayWeekday,
                currentMinutes,
                startOfDay,
                endOfDay,
              );
            }

            // 5. Create order
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
                // pickupLocation: dto.pickupLocation
                //   ? (dto.pickupLocation as Prisma.JsonObject)
                //   : null,
                // dropoffLocation: dto.dropoffLocation
                //   ? (dto.dropoffLocation as Prisma.JsonObject)
                //   : null,
                pickupLocation: dto.pickupLocation
                  ? (dto.pickupLocation as unknown as Prisma.JsonObject)
                  : null,

                dropoffLocation: dto.dropoffLocation
                  ? (dto.dropoffLocation as unknown as Prisma.JsonObject)
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

            // 6. Create order items
            await tx.orderItem.createMany({
              data: cartSummary.items.map((item) => ({
                orderId: newOrder.id,
                itemType: item.itemType as CartItemType,
                productId: item.itemType === 'PRODUCT' ? item.productId : null,
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

            // 7. Update idempotency record if exists
            if (dto.idempotencyKey) {
              await tx.idempotencyRecord.update({
                where: { key: dto.idempotencyKey },
                data: { status: 'COMPLETED', orderId: newOrder.id },
              });
            }

            return newOrder;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 15000,
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
          // No need to reset cart status – transaction rollback already reverted it
          throw err;
        }
        this.logger.warn(
          `[${requestId}] Retrying transaction, attempt ${attempt + 1}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt)); // backoff
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

    // Hours validation (same as before)
    const todayHours = store.operatingHours.find(
      (h) => h.dayOfWeek === todayWeekday,
    );
    if (!todayHours || !todayHours.isOpen)
      throw new BadRequestException(`${store.storeName} is closed today`);
    if (todayHours.closingTime) {
      const closingMinutes = Helper.timeToMinutes(todayHours.closingTime);
      if (currentMinutes >= closingMinutes - 30) {
        throw new BadRequestException(
          `${store.storeName} is no longer accepting orders`,
        );
      }
    }

    // Atomic daily limit using a counter table
    if (store.dailyOrderLimit && store.dailyOrderLimit > 0) {
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      // Use raw SQL for atomic increment with limit check (database specific)
      // This example uses PostgreSQL syntax; adapt for MySQL.
      const result = await tx.$executeRaw`
        UPDATE store_daily_counter
        SET order_count = order_count + 1
        WHERE store_id = ${storeId}
          AND date = ${date}
          AND order_count + 1 <= ${store.dailyOrderLimit}
      `;
      if (result === 0) {
        // Try to insert initial row if not exists
        try {
          await tx.$executeRaw`
            INSERT INTO store_daily_counter (store_id, date, order_count)
            VALUES (${storeId}, ${date}, 1)
          `;
        } catch (e: any) {
          // If unique violation, another transaction inserted it – retry the update
          const retryResult = await tx.$executeRaw`
            UPDATE store_daily_counter
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

  // async createOrderMostRecent(
  //   userId: string,
  //   dto: CreateOrderDto,
  // ): Promise<OrderSummaryDto> {
  //   const requestId = crypto.randomUUID();

  //   this.logger.log(
  //     `[${requestId}] ORDER_CREATE_STARTED user=${userId} cart=${dto.cartId}`,
  //   );

  //   /**
  //    * =========================================================
  //    * STEP 1:
  //    * Validate cart existence + ownership
  //    * =========================================================
  //    */
  //   const existingCart = await this.prisma.cart.findUnique({
  //     where: {
  //       id: dto.cartId,
  //     },
  //     select: {
  //       id: true,
  //       userId: true,
  //       status: true,
  //       checkedOutAt: true,
  //     },
  //   });

  //   this.logger.log(
  //     `[${requestId}] CART_LOOKUP_RESULT ${JSON.stringify(existingCart)}`,
  //   );

  //   if (!existingCart) {
  //     this.logger.warn(`[${requestId}] CART_NOT_FOUND cart=${dto.cartId}`);

  //     throw new NotFoundException('Cart not found');
  //   }

  //   if (existingCart.userId !== userId) {
  //     this.logger.warn(
  //       `[${requestId}] CART_OWNERSHIP_FAILED cart=${dto.cartId} owner=${existingCart.userId} requester=${userId}`,
  //     );

  //     throw new ForbiddenException('You are not allowed to access this cart');
  //   }

  //   if (existingCart.status !== 'ACTIVE') {
  //     this.logger.warn(
  //       `[${requestId}] INVALID_CART_STATUS cart=${dto.cartId} status=${existingCart.status}`,
  //     );

  //     throw new BadRequestException(`Cart is ${existingCart.status}`);
  //   }

  //   /**
  //    * =========================================================
  //    * STEP 2:
  //    * Timezone-safe context
  //    * =========================================================
  //    */
  //   const timezone = 'Africa/Lagos';

  //   const now = DateTime.now().setZone(timezone);

  //   const currentMinutes = now.hour * 60 + now.minute;

  //   const todayWeekday = now.toFormat('cccc');

  //   /**
  //    * =========================================================
  //    * STEP 3:
  //    * Retry-safe serializable transaction
  //    * =========================================================
  //    */
  //   const MAX_RETRIES = 3;

  //   let lastError: any;

  //   for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  //     try {
  //       this.logger.log(`[${requestId}] TRANSACTION_ATTEMPT=${attempt}`);

  //       const order = await this.prisma.$transaction(
  //         async (prisma) => {
  //           /**
  //            * =====================================================
  //            * STEP 4:
  //            * ATOMIC cart lock
  //            * Prevent double checkout
  //            * =====================================================
  //            */
  //           const lockResult = await prisma.cart.updateMany({
  //             where: {
  //               id: dto.cartId,
  //               userId,
  //               status: CartStatus.ACTIVE,
  //             },
  //             data: {
  //               status: CartStatus.CHECKED_OUT,
  //             },
  //           });

  //           this.logger.log(
  //             `[${requestId}] CART_LOCK_RESULT count=${lockResult.count}`,
  //           );

  //           if (lockResult.count === 0) {
  //             this.logger.warn(
  //               `[${requestId}] CART_ALREADY_PROCESSING cart=${dto.cartId}`,
  //             );

  //             throw new BadRequestException('Cart is already being processed');
  //           }

  //           /**
  //            * =====================================================
  //            * STEP 5:
  //            * Recompute cart INSIDE transaction
  //            * =====================================================
  //            */
  //           const cartSummary = await this.cartService.getCartSummary(
  //             dto.cartId,
  //             userId,
  //           );

  //           this.logger.log(
  //             `[${requestId}] CART_SUMMARY subtotal=${cartSummary.subtotal} total=${cartSummary.totalAmount} items=${cartSummary.items.length}`,
  //           );

  //           if (!cartSummary.items.length) {
  //             this.logger.warn(`[${requestId}] EMPTY_CART cart=${dto.cartId}`);

  //             throw new BadRequestException('Cart is empty');
  //           }

  //           /**
  //            * =====================================================
  //            * STEP 6:
  //            * Generate order number
  //            * =====================================================
  //            */
  //           const orderNumber = this.generateOrderNumber();

  //           this.logger.log(
  //             `[${requestId}] ORDER_NUMBER_GENERATED ${orderNumber}`,
  //           );

  //           /**
  //            * =====================================================
  //            * STEP 7:
  //            * Resolve stores
  //            * =====================================================
  //            */
  //           const storeIds = [
  //             ...new Set(
  //               cartSummary.items.map((i) => i.storeId).filter(Boolean),
  //             ),
  //           ];

  //           this.logger.log(
  //             `[${requestId}] STORES_RESOLVED count=${storeIds.length}`,
  //           );

  //           /**
  //            * =====================================================
  //            * STEP 8:
  //            * Store validation
  //            * =====================================================
  //            */
  //           await Promise.all(
  //             storeIds.map(async (storeId) => {
  //               this.logger.log(`[${requestId}] VALIDATING_STORE ${storeId}`);

  //               const store = await prisma.store.findUnique({
  //                 where: {
  //                   id: storeId as string,
  //                 },
  //                 include: {
  //                   operatingHours: true,
  //                 },
  //               });

  //               if (!store) {
  //                 this.logger.warn(
  //                   `[${requestId}] STORE_NOT_FOUND store=${storeId}`,
  //                 );

  //                 throw new NotFoundException('Store not found');
  //               }

  //               /**
  //                * Today's hours
  //                */
  //               const todayHours = store.operatingHours.find(
  //                 (h) => h.dayOfWeek === todayWeekday,
  //               );

  //               if (!todayHours || !todayHours.isOpen) {
  //                 this.logger.warn(
  //                   `[${requestId}] STORE_CLOSED store=${store.storeName}`,
  //                 );

  //                 throw new BadRequestException(
  //                   `${store.storeName} is closed today`,
  //                 );
  //               }

  //               /**
  //                * Closing cutoff
  //                */
  //               if (todayHours.closingTime) {
  //                 const closingMinutes = Helper.timeToMinutes(
  //                   todayHours.closingTime,
  //                 );

  //                 const cutoffMinutes = closingMinutes - 30;

  //                 if (currentMinutes >= cutoffMinutes) {
  //                   this.logger.warn(
  //                     `[${requestId}] STORE_CUTOFF_REACHED store=${store.storeName}`,
  //                   );

  //                   throw new BadRequestException(
  //                     `${store.storeName} is no longer accepting orders`,
  //                   );
  //                 }
  //               }

  //               /**
  //                * Daily order limit
  //                */
  //               if (store.dailyOrderLimit && store.dailyOrderLimit > 0) {
  //                 const startOfDay = new Date();
  //                 startOfDay.setHours(0, 0, 0, 0);

  //                 const endOfDay = new Date();
  //                 endOfDay.setHours(23, 59, 59, 999);

  //                 const todaysOrdersCount = await prisma.order.count({
  //                   where: {
  //                     createdAt: {
  //                       gte: startOfDay,
  //                       lte: endOfDay,
  //                     },
  //                     orderStatus: {
  //                       in: [
  //                         OrderStatus.ORDER_PLACED,
  //                         OrderStatus.CONFIRMED,
  //                         OrderStatus.PROCESSING,
  //                         OrderStatus.DELIVERED,
  //                       ],
  //                     },
  //                     items: {
  //                       some: {
  //                         storeId: store.id,
  //                       },
  //                     },
  //                   },
  //                 });

  //                 this.logger.log(
  //                   `[${requestId}] STORE_DAILY_COUNT store=${store.storeName} count=${todaysOrdersCount}`,
  //                 );

  //                 if (todaysOrdersCount >= store.dailyOrderLimit) {
  //                   this.logger.warn(
  //                     `[${requestId}] STORE_LIMIT_REACHED store=${store.storeName}`,
  //                   );

  //                   throw new BadRequestException(
  //                     `${store.storeName} has reached its daily order limit`,
  //                   );
  //                 }
  //               }
  //             }),
  //           );

  //           /**
  //            * =====================================================
  //            * STEP 9:
  //            * Create order
  //            * =====================================================
  //            */
  //           const newOrder = await prisma.order.create({
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

  //               pickupLocation: dto.pickupLocation
  //                 ? {
  //                     ...dto.pickupLocation,
  //                   }
  //                 : null,

  //               dropoffLocation: dto.dropoffLocation
  //                 ? {
  //                     ...dto.dropoffLocation,
  //                   }
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

  //           this.logger.log(
  //             `[${requestId}] ORDER_CREATED id=${newOrder.id} number=${newOrder.orderNumber}`,
  //           );

  //           /**
  //            * =====================================================
  //            * STEP 10:
  //            * Create order items
  //            * =====================================================
  //            */
  //           await prisma.orderItem.createMany({
  //             data: cartSummary.items.map((item) => ({
  //               orderId: newOrder.id,

  //               itemType: item.itemType as CartItemType,

  //               productId:
  //                 item.itemType === CartItemType.PRODUCT
  //                   ? item.productId
  //                   : null,

  //               packageId:
  //                 item.itemType === CartItemType.PACKAGE ||
  //                 item.itemType === CartItemType.DOCUMENT
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

  //           this.logger.log(
  //             `[${requestId}] ORDER_ITEMS_CREATED count=${cartSummary.items.length}`,
  //           );

  //           /**
  //            * =====================================================
  //            * STEP 11:
  //            * Finalize cart
  //            * =====================================================
  //            */
  //           await prisma.cart.update({
  //             where: {
  //               id: dto.cartId,
  //             },
  //             data: {
  //               status: CartStatus.CHECKED_OUT,
  //               checkedOutAt: new Date(),
  //             },
  //           });

  //           this.logger.log(
  //             `[${requestId}] CART_CHECKED_OUT cart=${dto.cartId}`,
  //           );

  //           return newOrder;
  //         },
  //         {
  //           isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  //         },
  //       );

  //       /**
  //        * =========================================================
  //        * STEP 12:
  //        * Success response
  //        * =========================================================
  //        */
  //       this.logger.log(
  //         `[${requestId}] ORDER_CREATE_SUCCESS order=${order.id}`,
  //       );

  //       return this.getOrderSummary(order.id, userId);
  //     } catch (err: any) {
  //       lastError = err;

  //       this.logger.error(
  //         `[${requestId}] ORDER_CREATE_FAILED attempt=${attempt} error=${err.message}`,
  //         err.stack,
  //       );

  //       /**
  //        * Retry transient transaction failures
  //        */
  //       const isRetryable = err.code === 'P2034' || err.code === 'P2028';

  //       if (!isRetryable || attempt === MAX_RETRIES) {
  //         /**
  //          * IMPORTANT:
  //          * Reset stuck cart status if checkout failed
  //          */
  //         try {
  //           await this.prisma.cart.updateMany({
  //             where: {
  //               id: dto.cartId,
  //               status: CartStatus.CHECKED_OUT,
  //             },
  //             data: {
  //               status: CartStatus.ACTIVE,
  //             },
  //           });

  //           this.logger.warn(
  //             `[${requestId}] CART_STATUS_RESET_TO_ACTIVE cart=${dto.cartId}`,
  //           );
  //         } catch (resetErr) {
  //           this.logger.error(`[${requestId}] FAILED_TO_RESET_CART_STATUS`);
  //         }

  //         throw err;
  //       }

  //       this.logger.warn(
  //         `[${requestId}] RETRYING_TRANSACTION attempt=${attempt}`,
  //       );
  //     }
  //   }

  //   throw lastError;
  // }

  // async createOrderBk(
  //   userId: string,
  //   dto: CreateOrderDto,
  // ): Promise<OrderSummaryDto> {
  //   this.logger.log(`Creating order for user: ${userId}`);

  //   /**
  //    * STEP 1:
  //    * Validate cart ownership
  //    */
  //   const cart = await this.prisma.cart.findUnique({
  //     where: { id: dto.cartId },
  //     select: {
  //       id: true,
  //       userId: true,
  //     },
  //   });

  //   if (!cart) {
  //     throw new NotFoundException('Cart not found');
  //   }

  //   if (cart.userId !== userId) {
  //     throw new ForbiddenException('You are not allowed to access this cart');
  //   }

  //   /**
  //    * STEP 2:
  //    * Cart summary
  //    */
  //   // const cartSummary = await this.cartService.getCartSummary(dto.cartId);
  //   const cartSummary = await this.cartService.getCartSummary(
  //     dto.cartId,
  //     userId,
  //   );

  //   if (!cartSummary.items.length) {
  //     throw new BadRequestException('Cart is empty');
  //   }

  //   /**
  //    * STEP 3:
  //    * Order number
  //    */
  //   const orderNumber = this.generateOrderNumber();

  //   /**
  //    * STEP 4:
  //    * Luxon time context (TIMEZONE SAFE)
  //    */
  //   const timezone = 'Africa/Lagos';

  //   const now = DateTime.now().setZone(timezone);

  //   const currentMinutes = now.hour * 60 + now.minute;

  //   const todayWeekday = now.toFormat('cccc'); // Monday, Tuesday...

  //   /**
  //    * STEP 5:
  //    * Serializable transaction + retry
  //    */
  //   const MAX_RETRIES = 3;

  //   let lastError: any;

  //   for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  //     try {
  //       const order = await this.prisma.$transaction(
  //         async (prisma) => {
  //           /**
  //            * STEP 6:
  //            * Store IDs
  //            */
  //           const storeIds = [
  //             ...new Set(
  //               cartSummary.items.map((i) => i.storeId).filter(Boolean),
  //             ),
  //           ];

  //           /**
  //            * STEP 7:
  //            * BULLETPROOF STORE VALIDATION
  //            */
  //           await Promise.all(
  //             storeIds.map(async (storeId) => {
  //               const store = await prisma.store.findUnique({
  //                 where: { id: storeId as string },
  //                 include: {
  //                   operatingHours: true,
  //                 },
  //               });

  //               if (!store) {
  //                 throw new NotFoundException('Store not found');
  //               }

  //               /**
  //                * STEP 7A:
  //                * Resolve today's operating hours
  //                */
  //               const todayHours = store.operatingHours.find(
  //                 (h) => h.dayOfWeek === todayWeekday,
  //               );

  //               if (!todayHours || !todayHours.isOpen) {
  //                 throw new BadRequestException(
  //                   `${store.storeName} is closed today`,
  //                 );
  //               }

  //               /**
  //                * STEP 7B:
  //                * Closing-time cutoff (30 mins rule)
  //                */
  //               if (todayHours.closingTime) {
  //                 const closingMinutes = Helper.timeToMinutes(
  //                   todayHours.closingTime,
  //                 );

  //                 const cutoffMinutes = closingMinutes - 30;

  //                 if (currentMinutes >= cutoffMinutes) {
  //                   throw new BadRequestException(
  //                     `${store.storeName} is no longer accepting orders (closes at ${todayHours.closingTime})`,
  //                   );
  //                 }
  //               }

  //               /**
  //                * STEP 7C:
  //                * Daily limit check
  //                */
  //               if (store.dailyOrderLimit && store.dailyOrderLimit > 0) {
  //                 const startOfDay = new Date();
  //                 startOfDay.setHours(0, 0, 0, 0);

  //                 const endOfDay = new Date();
  //                 endOfDay.setHours(23, 59, 59, 999);

  //                 const todaysOrdersCount = await prisma.order.count({
  //                   where: {
  //                     createdAt: {
  //                       gte: startOfDay,
  //                       lte: endOfDay,
  //                     },
  //                     orderStatus: {
  //                       in: [
  //                         OrderStatus.PENDING,
  //                         OrderStatus.CONFIRMED,
  //                         OrderStatus.PROCESSING,
  //                         OrderStatus.DELIVERED,
  //                       ],
  //                     },
  //                     items: {
  //                       some: {
  //                         storeId: store.id,
  //                       },
  //                     },
  //                   },
  //                 });

  //                 if (todaysOrdersCount >= store.dailyOrderLimit) {
  //                   throw new BadRequestException(
  //                     `${store.storeName} has reached its daily order limit`,
  //                   );
  //                 }
  //               }
  //             }),
  //           );

  //           /**
  //            * STEP 8:
  //            * Create order (JSON SAFE)
  //            */
  //           const newOrder = await prisma.order.create({
  //             data: {
  //               orderNumber,
  //               userId,

  //               orderType: this.determineOrderType(cartSummary.items),

  //               subtotal: cartSummary.subtotal,
  //               deliveryFee: cartSummary.deliveryFee,
  //               serviceFee: cartSummary.serviceFee,
  //               taxAmount: cartSummary.taxAmount,
  //               totalAmount: cartSummary.totalAmount,

  //               deliveryOptionId: dto.deliveryOptionId,

  //               pickupLocation: dto.pickupLocation
  //                 ? { ...dto.pickupLocation }
  //                 : null,

  //               dropoffLocation: dto.dropoffLocation
  //                 ? { ...dto.dropoffLocation }
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

  //           /**
  //            * STEP 9:
  //            * Bulk insert items
  //            */
  //           await prisma.orderItem.createMany({
  //             data: cartSummary.items.map((item) => ({
  //               orderId: newOrder.id,

  //               itemType: item.itemType as CartItemType,

  //               productId:
  //                 item.itemType === CartItemType.PRODUCT
  //                   ? item.productId
  //                   : null,

  //               packageId:
  //                 item.itemType === CartItemType.PACKAGE ||
  //                 item.itemType === CartItemType.DOCUMENT
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

  //           /**
  //            * STEP 10:
  //            * Clear cart
  //            */
  //           await prisma.cartItem.deleteMany({
  //             where: { cartId: dto.cartId },
  //           });

  //           await prisma.cart.update({
  //             where: { id: dto.cartId },
  //             data: { totalAmount: 0 },
  //           });

  //           return newOrder;
  //         },
  //         {
  //           isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  //         },
  //       );

  //       return this.getOrderSummary(order.id);
  //     } catch (err) {
  //       lastError = err;

  //       const isRetryable = err.code === 'P2034' || err.code === 'P2028';

  //       if (!isRetryable || attempt === MAX_RETRIES) {
  //         throw err;
  //       }
  //     }
  //   }

  //   throw lastError;
  // }

  // async createOrderWithoutOperationTimeCheck(
  //   userId: string,
  //   dto: CreateOrderDto,
  // ): Promise<OrderSummaryDto> {
  //   this.logger.log(`Creating order for user: ${userId}`);

  //   /**
  //    * STEP 1:
  //    * Validate cart ownership
  //    */
  //   const cart = await this.prisma.cart.findUnique({
  //     where: { id: dto.cartId },
  //     select: {
  //       id: true,
  //       userId: true,
  //     },
  //   });

  //   if (!cart) {
  //     throw new NotFoundException('Cart not found');
  //   }

  //   if (cart.userId !== userId) {
  //     throw new ForbiddenException('You are not allowed to access this cart');
  //   }

  //   /**
  //    * STEP 2:
  //    * Get cart summary
  //    */
  //   const cartSummary = await this.cartService.getCartSummary(dto.cartId);

  //   if (!cartSummary.items.length) {
  //     throw new BadRequestException('Cart is empty');
  //   }

  //   /**
  //    * STEP 3:
  //    * Generate order number
  //    */
  //   const orderNumber = this.generateOrderNumber();

  //   /**
  //    * STEP 4:
  //    * UTC-safe day boundaries
  //    */
  //   const now = new Date();

  //   const startOfDay = new Date(
  //     Date.UTC(
  //       now.getUTCFullYear(),
  //       now.getUTCMonth(),
  //       now.getUTCDate(),
  //       0,
  //       0,
  //       0,
  //       0,
  //     ),
  //   );

  //   const endOfDay = new Date(
  //     Date.UTC(
  //       now.getUTCFullYear(),
  //       now.getUTCMonth(),
  //       now.getUTCDate(),
  //       23,
  //       59,
  //       59,
  //       999,
  //     ),
  //   );

  //   /**
  //    * STEP 5:
  //    * Retry wrapper for SERIALIZABLE transaction
  //    */
  //   const MAX_RETRIES = 3;
  //   let lastError: any;

  //   for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  //     try {
  //       const order = await this.prisma.$transaction(
  //         async (prisma) => {
  //           /**
  //            * STEP 6:
  //            * Extract store IDs
  //            */
  //           const storeIds = [
  //             ...new Set(
  //               cartSummary.items.map((i) => i.storeId).filter(Boolean),
  //             ),
  //           ];

  //           /**
  //            * STEP 7:
  //            * Parallel store validation (performance fix)
  //            */
  //           await Promise.all(
  //             storeIds.map(async (storeId) => {
  //               const store = await prisma.store.findUnique({
  //                 where: { id: storeId as string },
  //                 select: {
  //                   id: true,
  //                   storeName: true,
  //                   dailyOrderLimit: true,
  //                 },
  //               });

  //               if (!store) {
  //                 throw new NotFoundException('Store not found');
  //               }

  //               if (!store.dailyOrderLimit || store.dailyOrderLimit <= 0) {
  //                 return;
  //               }

  //               const todaysOrdersCount = await prisma.order.count({
  //                 where: {
  //                   createdAt: {
  //                     gte: startOfDay,
  //                     lte: endOfDay,
  //                   },
  //                   orderStatus: {
  //                     in: [
  //                       OrderStatus.PENDING,
  //                       OrderStatus.CONFIRMED,
  //                       OrderStatus.PROCESSING,
  //                       OrderStatus.DELIVERED,
  //                     ],
  //                   },
  //                   items: {
  //                     some: {
  //                       storeId: store.id,
  //                     },
  //                   },
  //                 },
  //               });

  //               if (todaysOrdersCount >= store.dailyOrderLimit) {
  //                 throw new BadRequestException(
  //                   `${store.storeName} has reached its daily order limit`,
  //                 );
  //               }
  //             }),
  //           );

  //           /**
  //            * STEP 8:
  //            * Create order
  //            */
  //           const newOrder = await prisma.order.create({
  //             data: {
  //               orderNumber,
  //               userId,

  //               orderType: this.determineOrderType(cartSummary.items),

  //               subtotal: cartSummary.subtotal,
  //               deliveryFee: cartSummary.deliveryFee,
  //               serviceFee: cartSummary.serviceFee,
  //               taxAmount: cartSummary.taxAmount,
  //               totalAmount: cartSummary.totalAmount,

  //               deliveryOptionId: dto.deliveryOptionId,

  //               pickupLocation: dto.pickupLocation
  //                 ? JSON.stringify(dto.pickupLocation)
  //                 : null,

  //               dropoffLocation: dto.dropoffLocation
  //                 ? { ...dto.dropoffLocation } // JSON-safe
  //                 : null,

  //               recipientName: dto.recipientName,
  //               recipientPhone: dto.recipientPhone,

  //               deliveryInstructions: dto.deliveryInstructions,

  //               paymentStatus: PaymentStatus.PENDING,
  //               orderStatus: OrderStatus.PENDING,

  //               /**
  //                * JSON-safe status history
  //                */
  //               statusHistory: [
  //                 {
  //                   status: OrderStatus.PENDING,
  //                   timestamp: new Date().toISOString(),
  //                   note: 'Order created',
  //                 },
  //               ],
  //             },
  //           });

  //           /**
  //            * STEP 9:
  //            * Bulk insert order items
  //            */
  //           await prisma.orderItem.createMany({
  //             data: cartSummary.items.map((item) => ({
  //               orderId: newOrder.id,

  //               itemType: item.itemType as CartItemType,

  //               productId:
  //                 item.itemType === CartItemType.PRODUCT
  //                   ? item.productId
  //                   : null,

  //               packageId:
  //                 item.itemType === CartItemType.PACKAGE ||
  //                 item.itemType === CartItemType.DOCUMENT
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

  //           /**
  //            * STEP 10:
  //            * Clear cart
  //            */
  //           await prisma.cartItem.deleteMany({
  //             where: { cartId: dto.cartId },
  //           });

  //           await prisma.cart.update({
  //             where: { id: dto.cartId },
  //             data: { totalAmount: 0 },
  //           });

  //           return newOrder;
  //         },
  //         {
  //           isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  //         },
  //       );

  //       /**
  //        * SUCCESS
  //        */
  //       return this.getOrderSummary(order.id);
  //     } catch (err) {
  //       lastError = err;

  //       const isRetryable = err.code === 'P2034' || err.code === 'P2028';

  //       if (!isRetryable || attempt === MAX_RETRIES) {
  //         throw err;
  //       }
  //     }
  //   }

  //   throw lastError;
  // }

  // async createOrderbk(
  //   userId: string,
  //   dto: CreateOrderDto,
  // ): Promise<OrderSummaryDto> {
  //   this.logger.log(`Creating order for user: ${userId}`);

  //   /**
  //    * STEP 1:
  //    * Get cart summary
  //    */
  //   const cart = await this.prisma.cart.findUnique({
  //     where: { id: dto.cartId },
  //     select: {
  //       id: true,
  //       userId: true,
  //     },
  //   });

  //   if (!cart) {
  //     throw new NotFoundException('Cart not found');
  //   }

  //   if (cart.userId !== userId) {
  //     throw new ForbiddenException('You are not allowed to access this cart');
  //   }

  //   const cartSummary = await this.cartService.getCartSummary(dto.cartId);

  //   if (!cartSummary.items.length) {
  //     throw new BadRequestException('Cart is empty');
  //   }

  //   /**
  //    * STEP 2:
  //    * Generate unique order number
  //    */
  //   const orderNumber = this.generateOrderNumber();

  //   /**
  //    * STEP 3:
  //    * Create order inside transaction
  //    */
  //   const order = await this.prisma.$transaction(async (prisma) => {
  //     /**
  //      * STEP 4:
  //      * Extract unique store IDs from cart
  //      */
  //     const storeIds = [
  //       ...new Set(
  //         cartSummary.items.map((item) => item.storeId).filter(Boolean),
  //       ),
  //     ];

  //     /**
  //      * STEP 5:
  //      * Daily order limit validation
  //      */

  //     // Start of current day
  //     const startOfDay = new Date();
  //     startOfDay.setHours(0, 0, 0, 0);

  //     // End of current day
  //     const endOfDay = new Date();
  //     endOfDay.setHours(23, 59, 59, 999);

  //     for (const storeId of storeIds) {
  //       /**
  //        * Fetch store
  //        */
  //       const store = await prisma.store.findUnique({
  //         where: { id: storeId as string },
  //         select: {
  //           id: true,
  //           storeName: true,
  //           dailyOrderLimit: true,
  //         },
  //       });

  //       if (!store) {
  //         throw new NotFoundException('Store not found');
  //       }

  //       /**
  //        * Skip validation if no limit configured
  //        */
  //       if (store.dailyOrderLimit == null || store.dailyOrderLimit <= 0) {
  //         continue;
  //       }

  //       /**
  //        * Count today's ACTIVE orders for this store
  //        *
  //        * NOTE:
  //        * We count ORDERS not ORDER ITEMS
  //        * to avoid multiple products from the same
  //        * order being counted multiple times.
  //        */
  //       const todaysOrdersCount = await prisma.order.count({
  //         where: {
  //           createdAt: {
  //             gte: startOfDay,
  //             lte: endOfDay,
  //           },

  //           orderStatus: {
  //             in: ['PENDING', 'CONFIRMED', 'PROCESSING', 'DELIVERED'],
  //           },

  //           items: {
  //             some: {
  //               storeId: store.id,
  //             },
  //           },
  //         },
  //       });

  //       /**
  //        * Prevent store from exceeding daily capacity
  //        */
  //       if (todaysOrdersCount >= store.dailyOrderLimit) {
  //         throw new BadRequestException(
  //           `${store.storeName} has reached its daily order limit`,
  //         );
  //       }
  //     }

  //     /**
  //      * STEP 6:
  //      * Create order
  //      */
  //     const newOrder = await prisma.order.create({
  //       data: {
  //         orderNumber,
  //         userId,

  //         orderType: this.determineOrderType(cartSummary.items),

  //         subtotal: cartSummary.subtotal,
  //         deliveryFee: cartSummary.deliveryFee,
  //         serviceFee: cartSummary.serviceFee,
  //         taxAmount: cartSummary.taxAmount,
  //         totalAmount: cartSummary.totalAmount,

  //         deliveryOptionId: dto.deliveryOptionId,

  //         pickupLocation: dto.pickupLocation
  //           ? JSON.stringify(dto.pickupLocation)
  //           : null,

  //         dropoffLocation: JSON.stringify(dto.dropoffLocation),

  //         recipientName: dto.recipientName,
  //         recipientPhone: dto.recipientPhone,

  //         deliveryInstructions: dto.deliveryInstructions,

  //         paymentStatus: PaymentStatus.PENDING,
  //         orderStatus: OrderStatus.PENDING,

  //         statusHistory: JSON.stringify([
  //           {
  //             status: 'PENDING',
  //             timestamp: new Date().toISOString(),
  //             note: 'Order created',
  //           },
  //         ]),
  //       },
  //     });

  //     /**
  //      * STEP 7:
  //      * Create order items
  //      */
  //     for (const item of cartSummary.items) {
  //       await prisma.orderItem.create({
  //         data: {
  //           orderId: newOrder.id,

  //           itemType: item.itemType as CartItemType,

  //           productId:
  //             item.itemType === CartItemType.PRODUCT ? item.productId : null,

  //           packageId:
  //             item.itemType === CartItemType.PACKAGE ||
  //             item.itemType === CartItemType.DOCUMENT
  //               ? item.packageId
  //               : null,

  //           /**
  //            * IMPORTANT:
  //            * Save storeId directly for efficient queries
  //            */
  //           storeId: item.storeId || null,

  //           variantId: item.variantId || null,

  //           selectedAddons: item.selectedAddons || [],

  //           quantity: item.quantity,
  //           unitPrice: item.unitPrice,
  //           totalPrice: item.totalPrice,

  //           specialInstructions: item.specialInstructions || null,
  //         },
  //       });
  //     }

  //     /**
  //      * STEP 8:
  //      * Clear cart items
  //      */
  //     await prisma.cartItem.deleteMany({
  //       where: {
  //         cartId: dto.cartId,
  //       },
  //     });

  //     /**
  //      * STEP 9:
  //      * Reset cart total
  //      */
  //     await prisma.cart.update({
  //       where: {
  //         id: dto.cartId,
  //       },
  //       data: {
  //         totalAmount: 0,
  //       },
  //     });

  //     return newOrder;
  //   });

  //   /**
  //    * STEP 10:
  //    * Return order summary
  //    */
  //   return this.getOrderSummary(order.id);
  // }

  // async createOrderWithoutlimitCheck(
  //   userId: string,
  //   dto: CreateOrderDto,
  // ): Promise<OrderSummaryDto> {
  //   this.logger.log(`Creating order for user: ${userId}`);

  //   // Get cart summary
  //   const cartSummary = await this.cartService.getCartSummary(dto.cartId);

  //   if (cartSummary.items.length === 0) {
  //     throw new BadRequestException('Cart is empty');
  //   }

  //   // Generate unique order number
  //   const orderNumber = this.generateOrderNumber();

  //   // Create order
  //   const order = await this.prisma.$transaction(async (prisma) => {
  //     // Create the order
  //     const newOrder = await prisma.order.create({
  //       data: {
  //         orderNumber,
  //         userId,
  //         orderType: this.determineOrderType(cartSummary.items),
  //         subtotal: cartSummary.subtotal,
  //         deliveryFee: cartSummary.deliveryFee,
  //         serviceFee: cartSummary.serviceFee,
  //         taxAmount: cartSummary.taxAmount,
  //         totalAmount: cartSummary.totalAmount,
  //         deliveryOptionId: dto.deliveryOptionId,
  //         dropoffLocation: JSON.stringify(dto.dropoffLocation),
  //         recipientName: dto.recipientName,
  //         recipientPhone: dto.recipientPhone,
  //         deliveryInstructions: dto.deliveryInstructions,
  //         paymentStatus: 'PENDING',
  //         orderStatus: 'PENDING',
  //         statusHistory: JSON.stringify([
  //           {
  //             status: 'PENDING',
  //             timestamp: new Date().toISOString(),
  //             note: 'Order created',
  //           },
  //         ]),
  //       },
  //     });

  //     // Create order items from cart items
  //     for (const item of cartSummary.items) {
  //       await prisma.orderItem.create({
  //         data: {
  //           orderId: newOrder.id,
  //           itemType: item.itemType as any,
  //           // productId: item.itemType === 'PRODUCT' ? item.id : undefined,
  //           // packageId: item.itemType !== 'PRODUCT' ? item.id : undefined,
  //           // productId: item.itemType === 'PRODUCT' ? item.id : null,
  //           // packageId:
  //           //   item.itemType === 'PACKAGE' || item.itemType === 'DOCUMENT'
  //           //     ? item.id
  //           //     : null,
  //           productId: item.itemType === 'PRODUCT' ? item.productId : null,

  //           packageId:
  //             item.itemType === 'PACKAGE' || item.itemType === 'DOCUMENT'
  //               ? item.packageId
  //               : null,
  //           selectedAddons: item.selectedAddons || [],
  //           quantity: item.quantity,
  //           unitPrice: item.unitPrice,
  //           totalPrice: item.totalPrice,
  //           specialInstructions: item.specialInstructions,
  //         },
  //       });
  //     }

  //     // Clear the cart
  //     await prisma.cartItem.deleteMany({
  //       where: { cartId: dto.cartId },
  //     });

  //     await prisma.cart.update({
  //       where: { id: dto.cartId },
  //       data: { totalAmount: 0 },
  //     });

  //     return newOrder;
  //   });

  //   return this.getOrderSummary(order.id);
  // }

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
      serviceFee: order.serviceFee,
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
            baseFee: order.deliveryOption.baseFee,
            estimatedDays: order.deliveryOption.estimatedDays,
            description: order.deliveryOption.description,
          }
        : null,
    };
  }

  // async getOrderSummaryRecent(orderId: string): Promise<OrderSummaryDto> {
  //   const order = await this.prisma.order.findUnique({
  //     where: { id: orderId },
  //     include: {
  //       items: true,
  //       deliveryOption: true,
  //     },
  //   });

  //   if (!order) {
  //     throw new NotFoundException('Order not found');
  //   }

  //   return {
  //     orderId: order.id,
  //     orderNumber: order.orderNumber,
  //     items: order.items,
  //     subtotal: order.subtotal,
  //     deliveryFee: order.deliveryFee,
  //     serviceFee: order.serviceFee,
  //     taxAmount: order.taxAmount,
  //     totalAmount: order.totalAmount,
  //     dropoffLocation: order.dropoffLocation as unknown as DropoffLocationDto,
  //     pickupLocation: order.pickupLocation as unknown as PickupLocationDto,
  //     recipientName: order.recipientName,
  //     recipientPhone: order.recipientPhone,
  //     paymentStatus: order.paymentStatus,
  //     orderStatus: order.orderStatus,
  //     createdAt: order.createdAt,
  //     updatedAt: order.updatedAt,
  //   };
  // }

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

  // Private helper methods
  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `ORD-${timestamp}-${random}`;
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
    filters: { status?: string; page?: number; limit?: number },
  ) {
    const stores = await this.prisma.store.findMany({
      where: { userId: vendorId },
      select: { id: true },
    });
    const storeIds = stores.map((s) => s.id);
    if (!storeIds.length) return { data: [], total: 0 };

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);
    const where: any = { items: { some: { storeId: { in: storeIds } } } };
    if (filters.status) where.orderStatus = filters.status;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: { include: { store: true, product: true } },
          user: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
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

    const existingAction = await this.prisma.vendorOrderAction.findUnique({
      where: { orderId },
    });
    if (existingAction?.status !== VendorActionStatus.PENDING) {
      throw new ForbiddenException('Order already responded to');
    }

    if (dto.action === 'ACCEPT') {
      // Update vendor action
      await this.prisma.vendorOrderAction.update({
        where: { orderId },
        data: { status: VendorActionStatus.ACCEPTED, respondedAt: new Date() },
      });
      // Transition order to ACCEPTED
      // await this.orderStatus.transition(orderId, OrderStatus.ORDER_ACCEPTED, {
      await this.transition(orderId, OrderStatus.ORDER_ACCEPTED, {
        actorId: vendorId,
        actorRole: Role.VENDOR,
      });
      // Initiate driver search (background)
      // const pickupLocation = JSON.parse(order.pickupLocation || '{}');
      const pickupLocation = (order.pickupLocation as any) || {};
      await this.driverAssignment.initiateDriverSearch(orderId, pickupLocation);
    } else {
      // DECLINE
      await this.prisma.vendorOrderAction.update({
        where: { orderId },
        data: {
          status: VendorActionStatus.DECLINED,
          reason: dto.reason,
          respondedAt: new Date(),
        },
      });
      await this.transition(orderId, OrderStatus.CANCELLED, {
        actorId: vendorId,
        actorRole: Role.VENDOR,
        reason: dto.reason,
      });
      await this.notification.sendOrderCancelled(
        order.userId,
        order.orderNumber,
        dto.reason,
      );
    }

    return { success: true };
  }
}
