// src/customer/services/order.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { CreateOrderDto, OrderSummaryDto } from './dto/order.dto';
// import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../shared/services/prisma.service';
import { OrderType } from '@prisma/client';

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
            productId: item.itemType === 'PRODUCT' ? item.id : undefined,
            packageId: item.itemType !== 'PRODUCT' ? item.id : undefined,
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
      // Adjust the mapping below to match your OrderType enum or union
      return type === 'PRODUCT' ? ('VENDOR' as OrderType) : (type as OrderType);
    }

    return 'MIXED' as OrderType;
  }
}
