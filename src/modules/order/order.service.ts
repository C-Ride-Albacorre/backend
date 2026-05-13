// src/customer/services/order.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { CreateOrderDto, OrderSummaryDto } from '../customer/dto/order.dto';
import {
  CartItemType,
  OrderStatus,
  OrderType,
  PaymentStatus,
} from '@prisma/client';
import { CartService } from '../cart/cart.service';
// import { CartService } from '../customer/cart.service.old';
// import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
  ) {}

  /**
   * Create order from cart
   */
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<OrderSummaryDto> {
    this.logger.log(`Creating order for user: ${userId}`);

    /**
     * STEP 1:
     * Get cart summary
     */
    const cartSummary = await this.cartService.getCartSummary(dto.cartId);

    if (!cartSummary.items.length) {
      throw new BadRequestException('Cart is empty');
    }

    /**
     * STEP 2:
     * Generate unique order number
     */
    const orderNumber = this.generateOrderNumber();

    /**
     * STEP 3:
     * Create order inside transaction
     */
    const order = await this.prisma.$transaction(async (prisma) => {
      /**
       * STEP 4:
       * Extract unique store IDs from cart
       */
      const storeIds = [
        ...new Set(
          cartSummary.items.map((item) => item.storeId).filter(Boolean),
        ),
      ];

      /**
       * STEP 5:
       * Daily order limit validation
       */

      // Start of current day
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      // End of current day
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);

      for (const storeId of storeIds) {
        /**
         * Fetch store
         */
        const store = await prisma.store.findUnique({
          where: { id: storeId as string },
          select: {
            id: true,
            storeName: true,
            dailyOrderLimit: true,
          },
        });

        if (!store) {
          throw new NotFoundException('Store not found');
        }

        /**
         * Skip validation if no limit configured
         */
        if (store.dailyOrderLimit == null || store.dailyOrderLimit <= 0) {
          continue;
        }

        /**
         * Count today's ACTIVE orders for this store
         *
         * NOTE:
         * We count ORDERS not ORDER ITEMS
         * to avoid multiple products from the same
         * order being counted multiple times.
         */
        const todaysOrdersCount = await prisma.order.count({
          where: {
            createdAt: {
              gte: startOfDay,
              lte: endOfDay,
            },

            orderStatus: {
              in: ['PENDING', 'CONFIRMED', 'PROCESSING', 'DELIVERED'],
            },

            items: {
              some: {
                storeId: store.id,
              },
            },
          },
        });

        /**
         * Prevent store from exceeding daily capacity
         */
        if (todaysOrdersCount >= store.dailyOrderLimit) {
          throw new BadRequestException(
            `${store.storeName} has reached its daily order limit`,
          );
        }
      }

      /**
       * STEP 6:
       * Create order
       */
      const newOrder = await prisma.order.create({
        data: {
          orderNumber,
          userId,

          orderType: this.determineOrderType(cartSummary.items),

          subtotal: cartSummary.subtotal,
          deliveryFee: cartSummary.deliveryFee,
          serviceFee: cartSummary.serviceFee,
          taxAmount: cartSummary.taxAmount,
          totalAmount: cartSummary.totalAmount,

          deliveryOptionId: dto.deliveryOptionId,

          pickupLocation: dto.pickupLocation
            ? JSON.stringify(dto.pickupLocation)
            : null,

          dropoffLocation: JSON.stringify(dto.dropoffLocation),

          recipientName: dto.recipientName,
          recipientPhone: dto.recipientPhone,

          deliveryInstructions: dto.deliveryInstructions,

          paymentStatus: PaymentStatus.PENDING,
          orderStatus: OrderStatus.PENDING,

          statusHistory: JSON.stringify([
            {
              status: 'PENDING',
              timestamp: new Date().toISOString(),
              note: 'Order created',
            },
          ]),
        },
      });

      /**
       * STEP 7:
       * Create order items
       */
      for (const item of cartSummary.items) {
        await prisma.orderItem.create({
          data: {
            orderId: newOrder.id,

            itemType: item.itemType as any,

            productId:
              item.itemType === CartItemType.PRODUCT ? item.productId : null,

            packageId:
              item.itemType === CartItemType.PACKAGE ||
              item.itemType === CartItemType.DOCUMENT
                ? item.packageId
                : null,

            /**
             * IMPORTANT:
             * Save storeId directly for efficient queries
             */
            storeId: item.storeId || null,

            variantId: item.variantId || null,

            selectedAddons: item.selectedAddons || [],

            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,

            specialInstructions: item.specialInstructions || null,
          },
        });
      }

      /**
       * STEP 8:
       * Clear cart items
       */
      await prisma.cartItem.deleteMany({
        where: {
          cartId: dto.cartId,
        },
      });

      /**
       * STEP 9:
       * Reset cart total
       */
      await prisma.cart.update({
        where: {
          id: dto.cartId,
        },
        data: {
          totalAmount: 0,
        },
      });

      return newOrder;
    });

    /**
     * STEP 10:
     * Return order summary
     */
    return this.getOrderSummary(order.id);
  }

  async createOrderWithoutlimitCheck(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<OrderSummaryDto> {
    this.logger.log(`Creating order for user: ${userId}`);

    // Get cart summary
    const cartSummary = await this.cartService.getCartSummary(dto.cartId);

    if (cartSummary.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Generate unique order number
    const orderNumber = this.generateOrderNumber();

    // Create order
    const order = await this.prisma.$transaction(async (prisma) => {
      // Create the order
      const newOrder = await prisma.order.create({
        data: {
          orderNumber,
          userId,
          orderType: this.determineOrderType(cartSummary.items),
          subtotal: cartSummary.subtotal,
          deliveryFee: cartSummary.deliveryFee,
          serviceFee: cartSummary.serviceFee,
          taxAmount: cartSummary.taxAmount,
          totalAmount: cartSummary.totalAmount,
          deliveryOptionId: dto.deliveryOptionId,
          dropoffLocation: JSON.stringify(dto.dropoffLocation),
          recipientName: dto.recipientName,
          recipientPhone: dto.recipientPhone,
          deliveryInstructions: dto.deliveryInstructions,
          paymentStatus: 'PENDING',
          orderStatus: 'PENDING',
          statusHistory: JSON.stringify([
            {
              status: 'PENDING',
              timestamp: new Date().toISOString(),
              note: 'Order created',
            },
          ]),
        },
      });

      // Create order items from cart items
      for (const item of cartSummary.items) {
        await prisma.orderItem.create({
          data: {
            orderId: newOrder.id,
            itemType: item.itemType as any,
            // productId: item.itemType === 'PRODUCT' ? item.id : undefined,
            // packageId: item.itemType !== 'PRODUCT' ? item.id : undefined,
            // productId: item.itemType === 'PRODUCT' ? item.id : null,
            // packageId:
            //   item.itemType === 'PACKAGE' || item.itemType === 'DOCUMENT'
            //     ? item.id
            //     : null,
            productId: item.itemType === 'PRODUCT' ? item.productId : null,

            packageId:
              item.itemType === 'PACKAGE' || item.itemType === 'DOCUMENT'
                ? item.packageId
                : null,
            selectedAddons: item.selectedAddons || [],
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            specialInstructions: item.specialInstructions,
          },
        });
      }

      // Clear the cart
      await prisma.cartItem.deleteMany({
        where: { cartId: dto.cartId },
      });

      await prisma.cart.update({
        where: { id: dto.cartId },
        data: { totalAmount: 0 },
      });

      return newOrder;
    });

    return this.getOrderSummary(order.id);
  }

  /**
   * Get order summary
   */
  async getOrderSummary(orderId: string): Promise<OrderSummaryDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        deliveryOption: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      items: order.items,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      serviceFee: order.serviceFee,
      taxAmount: order.taxAmount,
      totalAmount: order.totalAmount,
      dropoffLocation: JSON.parse(order.dropoffLocation as string),
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      createdAt: order.createdAt,
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
}
