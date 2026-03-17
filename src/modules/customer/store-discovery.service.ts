// src/customer/services/store-discovery.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StoreWithDetailsDto } from './dto/store.dto';
import { PrismaService } from '../../shared/services/prisma.service';

@Injectable()
export class StoreDiscoveryService {
  private readonly logger = new Logger(StoreDiscoveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get stores by category
   */
  async getStoresByCategory(categoryId: string, customerLocation?: any) {
    this.logger.log(`Fetching stores for category: ${categoryId}`);

    const stores = await this.prisma.store.findMany({
      where: {
        storeCategory: categoryId,
        status: 'ACTIVE',
      },
      include: {
        storeSubcategories: {
          include: {
            subcategory: true,
          },
        },
        operatingHours: true,
        products: {
          take: 4, // Preview products
          where: { productStatus: 'ACTIVE' },
          include: {
            productImages: {
              take: 1,
              where: { isPrimary: true },
            },
          },
        },
      },
    });

    // Calculate distance and open status for each store
    const storesWithDetails: StoreWithDetailsDto[] = stores.map((store) => ({
      id: store.id,
      storeName: store.storeName,
      storeCategory: store.storeCategory,
      subcategories: store.storeSubcategories.map((ss) => ss.subcategory.name),
      storeDescription: store.storeDescription,
      storeAddress: store.storeAddress,
      phoneNumber: store.phoneNumber,
      minimumOrder: store.minimumOrder,
      preparationTime: store.preparationTime,
      storeLogo: store.storeLogo,
      isOpen: this.isStoreOpen(store.operatingHours),
      // Calculate distance if location provided
      distance: customerLocation
        ? this.calculateDistance(store, customerLocation)
        : undefined,
    }));

    return storesWithDetails;
  }

  /**
   * Get subcategories by category
   */
  async getSubcategoriesByCategory(categoryId: string) {
    return this.prisma.subcategory.findMany({
      where: {
        categoryId,
        isActive: true,
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  /**
   * Get subcategories with store counts
   */
  async getSubcategoriesWithStoreCount(categoryId: string) {
    const subcategories = await this.prisma.subcategory.findMany({
      where: {
        categoryId,
        isActive: true,
      },
      include: {
        storeSubcategories: {
          where: {
            store: {
              status: 'ACTIVE',
            },
          },
        },
      },
    });

    return subcategories.map((sub) => ({
      id: sub.id,
      name: sub.name,
      description: sub.description,
      storeCount: sub.storeSubcategories.length,
    }));
  }

  /**
   * Get store details with products
   */
  async getStoreWithProducts(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        storeSubcategories: {
          include: { subcategory: true },
        },
        operatingHours: true,
        products: {
          where: { productStatus: 'ACTIVE' },
          include: {
            productImages: {
              orderBy: { displayOrder: 'asc' },
            },
            variants: {
              where: { stockStatus: { not: 'OUT_OF_STOCK' } },
            },
            addons: {
              where: { isAvailable: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    return store;
  }

  /**
   * Get product details
   */
  async getProductDetails(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        productImages: {
          orderBy: { displayOrder: 'asc' },
        },
        variants: {
          where: { stockStatus: { not: 'OUT_OF_STOCK' } },
        },
        addons: {
          where: { isAvailable: true },
        },
        store: {
          select: {
            id: true,
            storeName: true,
            minimumOrder: true,
            preparationTime: true,
          },
        },
      },
    });

    if (!product || product.productStatus !== 'ACTIVE') {
      throw new NotFoundException('Product not available');
    }

    return product;
  }

  /**
   * Check if store is open
   */
  private isStoreOpen(operatingHours: any[]): boolean {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

    const todayHours = operatingHours.find((h) => h.dayOfWeek === dayOfWeek);

    if (!todayHours || !todayHours.isOpen) {
      return false;
    }

    return (
      currentTime >= todayHours.openingTime &&
      currentTime <= todayHours.closingTime
    );
  }

  /**
   * Calculate distance between store and customer (simplified)
   * In production, use a proper geolocation library
   */
  private calculateDistance(store: any, customerLocation: any): number {
    // Simplified - in production, use proper distance calculation
    // based on latitude/longitude
    return Math.random() * 10; // Mock distance in km
  }
}
