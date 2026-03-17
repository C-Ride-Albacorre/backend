// src/customer/services/customer.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SaveLocationDto } from './dto/location.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { CartItemSummaryDto, CartSummaryDto } from './dto/cart-summary.dto';
import { DeliveryOptionDto } from './dto/delivery-option.dto';

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save customer location (prompted at first login)
   */
  async saveLocation(userId: string, dto: SaveLocationDto) {
    this.logger.log(`Saving location for user: ${userId}`);

    // If this is set as default, unset any existing default
    if (dto.isDefault) {
      await this.prisma.customerLocation.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const location = await this.prisma.customerLocation.create({
      data: {
        userId,
        ...dto,
      },
    });

    return {
      success: true,
      message: 'Location saved successfully',
      location,
    };
  }

  /**
   * Get customer's saved locations
   */
  async getUserLocations(userId: string) {
    return this.prisma.customerLocation.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Get all active categories
   */
  async getCategories() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      include: {
        subcategories: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  /**
   * Get packages (for package/document orders)
   */
  async getPackages(type?: 'PACKAGE' | 'DOCUMENT') {
    const where: any = { isActive: true };
    if (type) {
      where.type = type;
    }

    return this.prisma.package.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get delivery options
   */
  async getDeliveryOptions() {
    return this.prisma.deliveryOption.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getVendorAddressByStore(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        storeName: true,
        user: {
          select: {
            id: true,
            businessInfo: {
              select: {
                address: true,
                city: true,
                state: true,
                businessName: true,
                businessPhone: true,
                businessEmail: true,
              },
            },
          },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    if (!store.user?.businessInfo) {
      throw new NotFoundException('Vendor business info not found');
    }

    const info = store.user.businessInfo;

    return {
      storeId: store.id,
      storeName: store.storeName,

      vendorId: store.user.id,
      businessName: info.businessName,

      address: {
        street: info.address,
        city: info.city,
        state: info.state,
      },

      contact: {
        phone: info.businessPhone,
        email: info.businessEmail,
      },
    };
  }
  ////////////////

  // Step 1: Add/Update delivery option to cart
  async addDeliveryOptionToCart(
    cartId: string,
    deliveryOptionDto: DeliveryOptionDto,
  ) {
    this.logger.log(`Adding delivery option to cart: ${cartId}`);

    // Validate delivery option exists and is available
    const deliveryOption = await this.prisma.deliveryOption.findUnique({
      where: { id: deliveryOptionDto.deliveryOptionId },
    });

    if (!deliveryOption) {
      throw new NotFoundException('Delivery option not found');
    }

    // Update order with delivery details
    const updatedCart = await this.prisma.order.update({
      where: { id: cartId },
      data: {
        deliveryOptionId: deliveryOptionDto.deliveryOptionId,
        dropoffLocation: JSON.stringify(deliveryOptionDto.dropoffLocation),
        recipientName: deliveryOptionDto.recipientName,
        recipientPhone: deliveryOptionDto.recipientPhone,
        deliveryInstructions: deliveryOptionDto.deliveryInstructions,
      },
    });

    return {
      message: 'Delivery option added successfully',
      cartId: updatedCart.id,
      deliveryOption: deliveryOptionDto,
    };
  }

  // Step 2: Get comprehensive cart summary with all details
  // async getCartSummaryWithDetails(cartId: string): Promise<CartSummaryDto> {
  //   this.logger.log(`Fetching cart summary with details: ${cartId}`);

  //   const cart = await this.prisma.order.findUnique({
  //     where: { id: cartId },
  //     include: {
  //       items: {
  //         include: {
  //           product: {
  //             include: {
  //               store: true,
  //             },
  //           },
  //           // package: {
  //           //   include: {
  //           //     store: true,
  //           //   },
  //           // },
  //         },
  //       },
  //       deliveryOption: true,
  //     },
  //   });

  //   if (!cart) {
  //     throw new NotFoundException('Cart not found');
  //   }

  //   // Group items by store
  //   const storeMap = new Map();
  //   const items = [];

  //   for (const item of cart.items) {
  //     const store = item.product?.store || item.package?.store;
  //     const itemDetails = this.mapCartItemToSummary(item);

  //     items.push(itemDetails);

  //     if (store) {
  //       if (!storeMap.has(store.id)) {
  //         storeMap.set(store.id, {
  //           storeId: store.id,
  //           storeName: store.name,
  //           items: [],
  //           subtotal: 0,
  //           deliveryFee: store.deliveryFee || 0,
  //           serviceFee: store.serviceFee || 0,
  //           taxAmount: 0,
  //           storeTotal: 0,
  //         });
  //       }

  //       const storeData = storeMap.get(store.id);
  //       storeData.items.push(itemDetails);
  //       storeData.subtotal += itemDetails.totalPrice;
  //       storeData.taxAmount += itemDetails.totalPrice * 0.08; // Calculate tax
  //       storeData.storeTotal =
  //         storeData.subtotal +
  //         storeData.deliveryFee +
  //         storeData.serviceFee +
  //         storeData.taxAmount;
  //     }
  //   }

  //   const stores = Array.from(storeMap.values());

  //   // Calculate totals
  //   const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  //   const deliveryFee = stores.reduce(
  //     (sum, store) => sum + store.deliveryFee,
  //     0,
  //   );
  //   const serviceFee = stores.reduce((sum, store) => sum + store.serviceFee, 0);
  //   const taxAmount = stores.reduce((sum, store) => sum + store.taxAmount, 0);
  //   const totalAmount = subtotal + deliveryFee + serviceFee + taxAmount;

  //   // Parse delivery option if exists
  //   let selectedDeliveryOption = null;
  //   if (cart.deliveryOptionId && cart.dropoffLocation) {
  //     selectedDeliveryOption = {
  //       deliveryOptionId: cart.deliveryOptionId,
  //       dropoffLocation: JSON.parse(cart.dropoffLocation as string),
  //       recipientName: cart.recipientName,
  //       recipientPhone: cart.recipientPhone,
  //       deliveryInstructions: cart.deliveryInstructions,
  //     };
  //   }

  //   return {
  //     cartId: cart.id,
  //     stores,
  //     items,
  //     totalItems: items.length,
  //     subtotal,
  //     deliveryFee,
  //     serviceFee,
  //     taxAmount,
  //     totalAmount,
  //     selectedDeliveryOption,
  //     expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), // 30 minutes from now
  //   };
  // }

  // private mapCartItemToSummary(item: any): CartItemSummaryDto {
  //   const product = item.product;
  //   const package_item = item.package;

  //   return {
  //     id: item.id,
  //     itemType: item.itemType,
  //     name: product?.name || package_item?.name || 'Item',
  //     quantity: item.quantity,
  //     unitPrice: Number(item.unitPrice),
  //     totalPrice: Number(item.totalPrice),
  //     specialInstructions: item.specialInstructions,
  //     selectedAddons: item.selectedAddons,
  //     image: product?.images?.[0] || package_item?.image,
  //   };
  // }
}
