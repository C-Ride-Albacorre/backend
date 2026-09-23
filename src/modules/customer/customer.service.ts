import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SaveLocationDto } from './dto/location.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { DeliveryOptionDto } from './dto/delivery-option.dto';
import Helper from '../../shared/utils/helpers';

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save customer location (prompted at first login)
   */
  async saveLocation(userId: string, dto: SaveLocationDto) {
  this.logger.log(`Saving location for user: ${userId}`);

  // 1️⃣ Build a clean full address (fallback country if missing)
  const parts = [
    dto.address,
    dto.city,
    dto.state,
    dto.country || 'Nigeria', // fallback for Nigerian addresses
  ].filter(Boolean);
  const fullAddress = parts.join(', ');

  // 2️⃣ Try geocoding if latitude/longitude not provided
  if (!dto.latitude || !dto.longitude) {
    const geo = await Helper.geocodeAddress(fullAddress);

    if (geo) {
      dto.latitude = geo.lat;  // use correct field names
      dto.longitude = geo.lng;
      this.logger.log(`Coordinates found: ${dto.latitude}, ${dto.longitude}`);
    } else {
      this.logger.warn(`Could not resolve coordinates for: ${fullAddress}`);
    }
  }

  // 3️⃣ Handle default location: unset previous default if needed
  if (dto.isDefault) {
    await this.prisma.customerLocation.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  // 4️⃣ Upsert the location: create if new, update if same address exists
  const location = await this.prisma.customerLocation.upsert({
    where: {
      userId_address: {
        userId,
        address: dto.address,
      },
    },
    update: {
      latitude: dto.latitude,
      longitude: dto.longitude,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      postalCode: dto.postalCode,
      label: dto.label,
      isDefault: dto.isDefault,
    },
    create: {
      userId,
      ...dto,
    },
  });

  // 5️⃣ Return consistent response
  return {
    success: true,
    message: dto.latitude && dto.longitude
      ? 'Location saved' //with coordinates'
      : 'Location saved', //(coordinates unavailable)',
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
      _count: {
        select: {
          stores: true, // works because Store.categoryId exists
        },
      },
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

 
}
