// src/customer/services/store-discovery.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StoreWithDetailsDto } from './dto/store.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import axios from 'axios';

@Injectable()
export class StoreDiscoveryService {
  private readonly logger = new Logger(StoreDiscoveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get stores by category
   */
  async getStoresByCategoryNew(params: {
    categoryId: string;
    customerId?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    page?: number;
    limit?: number;
  }) {
    const {
      categoryId,
      customerId,
      lat,
      lng,
      radiusKm = 10,
      page = 1,
      limit = 20,
    } = params;

    this.logger.log(
      `Fetching stores | category=${categoryId} | user=${customerId}`,
    );

    // 1️⃣ Resolve user location (priority-based)
    let userLocation: { lat: number; lng: number } | null = null;

    if (lat != null && lng != null) {
      userLocation = { lat, lng };
    } else if (customerId) {
      const savedLocation = await this.prisma.customerLocation.findFirst({
        where: { userId: customerId, isDefault: true },
        select: { latitude: true, longitude: true },
      });
      if (savedLocation?.latitude != null && savedLocation?.longitude != null) {
        userLocation = {
          lat: savedLocation.latitude,
          lng: savedLocation.longitude,
        };
      }
    }

    // 2️⃣ Pagination
    const skip = (page - 1) * limit;

    // 3️⃣ Fetch stores (no bounding box)
    const stores = await this.prisma.store.findMany({
      where: {
        storeCategory: categoryId,
        status: 'ACTIVE',
        latitude: { not: null },
        longitude: { not: null },
      },
      skip,
      take: limit,
      include: {
        storeSubcategories: { include: { subcategory: true } },
        operatingHours: true,
        products: {
          take: 4,
          where: { productStatus: 'ACTIVE' },
          include: { productImages: { take: 1, where: { isPrimary: true } } },
        },
      },
    });

    // 4️⃣ Map + compute distance
    const results = stores.map((store) => {
      let distance: number | null = null;
      if (userLocation && store.latitude != null && store.longitude != null) {
        distance = this.calculateHaversineDistance(userLocation, {
          lat: Number(store.latitude),
          lng: Number(store.longitude),
        });
      }

      return {
        id: store.id,
        storeName: store.storeName,
        storeCategory: store.storeCategory,
        subcategories: store.storeSubcategories.map((s) => s.subcategory.name),
        storeDescription: store.storeDescription,
        storeAddress: store.storeAddress,
        phoneNumber: store.phoneNumber,
        minimumOrder: store.minimumOrder,
        preparationTime: store.preparationTime,
        storeLogo: store.storeLogo,
        isOpen: this.isStoreOpen(store.operatingHours),
        distance,
      };
    });

    // 5️⃣ Filter by distance + sort
    let filteredResults = results;

    if (userLocation) {
      filteredResults = results
        .filter((store) => store.distance != null && store.distance <= radiusKm)
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    } else {
      filteredResults = results.sort((a, b) =>
        a.storeName.localeCompare(b.storeName),
      );
    }

    return filteredResults;
  }
  async getStoresByCategory00(params: {
    categoryId: string;
    customerId?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    page?: number;
    limit?: number;
  }) {
    const {
      categoryId,
      customerId,
      lat,
      lng,
      radiusKm = 10,
      page = 1,
      limit = 20,
    } = params;

    this.logger.log(
      `Fetching stores | category=${categoryId} | user=${customerId}`,
    );

    // 1️⃣ Resolve user location (priority-based)
    let userLocation: { lat: number; lng: number } | null = null;

    if (lat != null && lng != null) {
      userLocation = { lat, lng };
    } else if (customerId) {
      const savedLocation = await this.prisma.customerLocation.findFirst({
        where: { userId: customerId, isDefault: true },
        select: { latitude: true, longitude: true },
      });
      if (savedLocation?.latitude != null && savedLocation?.longitude != null) {
        userLocation = {
          lat: savedLocation.latitude,
          lng: savedLocation.longitude,
        };
      }
    }

    // 2️⃣ Pagination
    const skip = (page - 1) * limit;

    // 3️⃣ Base query
    const where: any = {
      storeCategory: categoryId,
      status: 'ACTIVE',
    };

    // 4️⃣ Apply bounding box if userLocation exists
    if (userLocation) {
      // Convert radius to degrees
      const latDelta = radiusKm / 111; // ~1 deg lat = 111km
      const lngDelta =
        radiusKm / (111 * Math.cos((userLocation.lat * Math.PI) / 180));

      where.latitude = {
        gte: userLocation.lat - latDelta,
        lte: userLocation.lat + latDelta,
      };
      where.longitude = {
        gte: userLocation.lng - lngDelta,
        lte: userLocation.lng + lngDelta,
      };
    }

    // 5️⃣ Fetch stores
    const stores = await this.prisma.store.findMany({
      where,
      skip,
      take: limit,
      include: {
        storeSubcategories: { include: { subcategory: true } },
        operatingHours: true,
        products: {
          take: 4,
          where: { productStatus: 'ACTIVE' },
          include: { productImages: { take: 1, where: { isPrimary: true } } },
        },
      },
    });

    // 6️⃣ Map + compute distance
    const results = stores.map((store) => {
      let distance: number | null = null;
      if (userLocation && store.latitude != null && store.longitude != null) {
        distance = this.calculateHaversineDistance(userLocation, {
          lat: Number(store.latitude),
          lng: Number(store.longitude),
        });
      }
      return {
        id: store.id,
        storeName: store.storeName,
        storeCategory: store.storeCategory,
        subcategories: store.storeSubcategories.map((s) => s.subcategory.name),
        storeDescription: store.storeDescription,
        storeAddress: store.storeAddress,
        phoneNumber: store.phoneNumber,
        minimumOrder: store.minimumOrder,
        preparationTime: store.preparationTime,
        storeLogo: store.storeLogo,
        isOpen: this.isStoreOpen(store.operatingHours),
        distance,
      };
    });

    // 7️⃣ Final filtering + sorting
    let filteredResults = results;

    if (userLocation) {
      filteredResults = results
        .filter((store) => store.distance != null && store.distance <= radiusKm)
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    } else {
      filteredResults = results.sort((a, b) =>
        a.storeName.localeCompare(b.storeName),
      );
    }

    return filteredResults;
  }

  async getStoresByCategorySS(params: {
    categoryId: string;
    customerId?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    page?: number;
    limit?: number;
  }) {
    const { categoryId, customerId, lat, lng, radiusKm, page, limit } = params;

    this.logger.log(
      `Fetching stores | category=${categoryId} | user=${customerId}`,
    );

    // ✅ 1. Resolve user location (priority-based)
    let userLocation: { lat: number; lng: number } | null = null;

    // Priority 1: live GPS
    if (lat != null && lng != null) {
      userLocation = { lat, lng };
    }

    // Priority 2: default saved location
    if (!userLocation && customerId) {
      const savedLocation = await this.prisma.customerLocation.findFirst({
        where: {
          userId: customerId,
          isDefault: true,
        },
        select: {
          latitude: true,
          longitude: true,
        },
      });

      if (savedLocation?.latitude != null && savedLocation?.longitude != null) {
        userLocation = {
          lat: savedLocation.latitude,
          lng: savedLocation.longitude,
        };
      }
    }

    // ✅ 2. Pagination
    const skip = (page - 1) * limit;

    // ✅ 3. Base query
    const where: any = {
      storeCategory: categoryId,
      status: 'ACTIVE',
    };

    console.log('userLocation', userLocation);

    // ✅ 4. Apply bounding box (DB-level filtering)
    if (userLocation) {
      const latDelta = radiusKm / 111;

      const lngDelta =
        radiusKm / (111 * Math.cos((userLocation.lat * Math.PI) / 180));

      where.latitude = {
        gte: userLocation.lat - latDelta,
        lte: userLocation.lat + latDelta,
      };

      where.longitude = {
        gte: userLocation.lng - lngDelta,
        lte: userLocation.lng + lngDelta,
      };
    }

    // ✅ 5. Fetch stores
    const stores = await this.prisma.store.findMany({
      where,
      skip,
      take: limit,
      include: {
        storeSubcategories: {
          include: {
            subcategory: true,
          },
        },
        operatingHours: true,
        products: {
          take: 4,
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

    // ✅ 6. Map + compute distance
    let results = stores.map((store) => {
      let distance: number | null = null;

      if (userLocation && store.latitude != null && store.longitude != null) {
        distance = this.calculateHaversineDistance(userLocation, {
          lat: store.latitude,
          lng: store.longitude,
        });
      }

      return {
        id: store.id,
        storeName: store.storeName,
        storeCategory: store.storeCategory,
        subcategories: store.storeSubcategories.map((s) => s.subcategory.name),
        storeDescription: store.storeDescription,
        storeAddress: store.storeAddress,
        phoneNumber: store.phoneNumber,
        minimumOrder: store.minimumOrder,
        preparationTime: store.preparationTime,
        storeLogo: store.storeLogo,
        isOpen: this.isStoreOpen(store.operatingHours),
        distance,
      };
    });

    // ✅ 7. Final filtering + sorting
    if (userLocation) {
      results = results
        .filter((store) => store.distance != null && store.distance <= radiusKm)
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    } else {
      // fallback when no location
      results = results.sort((a, b) => a.storeName.localeCompare(b.storeName));
    }

    return results;
  }

  async getStoresByCategoryOld1(categoryId: string, customerId?: string) {
    this.logger.log(
      `Fetching stores for category: ${categoryId}, ${customerId}`,
    );

    // ✅ 1. Get customer location from DB
    let customerLocation: { lat: number; lng: number } | null = null;

    if (customerId) {
      const customer = await this.prisma.customerLocation.findFirst({
        where: { userId: customerId },
        select: { latitude: true, longitude: true },
      });

      console.log('customer', customer);

      //this.logger.log(`customer, ${customer.latitude}, ${customer.longitude}`);

      if (customer?.latitude != null && customer?.longitude != null) {
        customerLocation = {
          lat: customer.latitude,
          lng: customer.longitude,
        };
      }
    }

    // ✅ 2. Fetch stores
    const stores = await this.prisma.store.findMany({
      where: {
        storeCategory: categoryId,
        status: 'ACTIVE',

        // ✅ Only fetch geocoded stores if user has location
        ...(customerLocation && {
          latitude: { not: null },
          longitude: { not: null },
        }),
      },
      include: {
        storeSubcategories: {
          include: {
            subcategory: true,
          },
        },
        operatingHours: true,
        products: {
          take: 4,
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

    // ✅ 3. Map + calculate distance
    let storesWithDetails = stores.map((store) => {
      let distance: number | undefined;

      if (
        customerLocation &&
        store.latitude != null &&
        store.longitude != null
      ) {
        distance = this.calculateHaversineDistance(customerLocation, {
          lat: store.latitude,
          lng: store.longitude,
        });
      }

      return {
        id: store.id,
        storeName: store.storeName,
        storeCategory: store.storeCategory,
        subcategories: store.storeSubcategories.map(
          (ss) => ss.subcategory.name,
        ),
        storeDescription: store.storeDescription,
        storeAddress: store.storeAddress,
        phoneNumber: store.phoneNumber,
        minimumOrder: store.minimumOrder,
        preparationTime: store.preparationTime,
        storeLogo: store.storeLogo,
        isOpen: this.isStoreOpen(store.operatingHours),
        distance,
      };
    });

    // ✅ 4. Sort by nearest (only if location exists)
    if (customerLocation) {
      storesWithDetails.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );

      // ✅ 5. Filter within radius (10km)
      const MAX_DISTANCE_KM = 10;

      storesWithDetails = storesWithDetails.filter(
        (store) =>
          store.distance !== undefined && store.distance <= MAX_DISTANCE_KM,
      );
    }

    return storesWithDetails;
  }

  async getStoresByCategorybk1(
    categoryId: string,
    customerLocation?: { lat: number; lng: number },
  ) {
    this.logger.log(`Fetching stores for category: ${categoryId}`);
    console.log('customerLocation', customerLocation);
    const stores = await this.prisma.store.findMany({
      where: {
        storeCategory: categoryId,
        status: 'ACTIVE',
        // ✅ Only fetch geocoded stores if location is provided
        ...(customerLocation && {
          latitude: { not: null },
          longitude: { not: null },
        }),
      },
      include: {
        storeSubcategories: {
          include: {
            subcategory: true,
          },
        },
        operatingHours: true,
        products: {
          take: 4,
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

    let storesWithDetails = stores.map((store) => {
      let distance: number | undefined;

      if (customerLocation && store.latitude && store.longitude) {
        distance = this.calculateHaversineDistance(customerLocation, {
          lat: store.latitude,
          lng: store.longitude,
        });
      }

      return {
        id: store.id,
        storeName: store.storeName,
        storeCategory: store.storeCategory,
        subcategories: store.storeSubcategories.map(
          (ss) => ss.subcategory.name,
        ),
        storeDescription: store.storeDescription,
        storeAddress: store.storeAddress,
        phoneNumber: store.phoneNumber,
        minimumOrder: store.minimumOrder,
        preparationTime: store.preparationTime,
        storeLogo: store.storeLogo,
        isOpen: this.isStoreOpen(store.operatingHours),
        distance,
      };
    });

    // ✅ Sort by nearest
    if (customerLocation) {
      storesWithDetails.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    }

    // ✅ Optional: filter within radius (e.g. 10km)
    if (customerLocation) {
      const MAX_DISTANCE_KM = 10;

      storesWithDetails = storesWithDetails.filter(
        (store) =>
          store.distance !== undefined && store.distance <= MAX_DISTANCE_KM,
      );
    }

    return storesWithDetails;
  }

  async getStoresByCategoryold(
    categoryId: string,
    customerLocation?: { lat: number; lng: number },
  ) {
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
          take: 4,
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

    let storesWithDetails = await Promise.all(
      stores.map(async (store) => {
        let distance: number | undefined;

        if (customerLocation && store.latitude && store.longitude) {
          distance = await this.calculateDistanceWithGoogle(customerLocation, {
            lat: store.latitude,
            lng: store.longitude,
          });
        }

        return {
          id: store.id,
          storeName: store.storeName,
          storeCategory: store.storeCategory,
          subcategories: store.storeSubcategories.map(
            (ss) => ss.subcategory.name,
          ),
          storeDescription: store.storeDescription,
          storeAddress: store.storeAddress,
          phoneNumber: store.phoneNumber,
          minimumOrder: store.minimumOrder,
          preparationTime: store.preparationTime,
          storeLogo: store.storeLogo,
          isOpen: this.isStoreOpen(store.operatingHours),
          distance,
        };
      }),
    );

    // ✅ Sort by nearest distance
    if (customerLocation) {
      storesWithDetails = storesWithDetails.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    }

    return storesWithDetails;
  }

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

  private async calculateDistanceWithGoogle(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ): Promise<number> {
    try {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;

      const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;

      const response = await axios.get(url, {
        params: {
          origins: `${origin.lat},${origin.lng}`,
          destinations: `${destination.lat},${destination.lng}`,
          key: apiKey,
        },
      });

      const element = response.data.rows[0].elements[0];

      if (element.status === 'OK') {
        // distance in meters → convert to km
        return element.distance.value / 1000;
      }

      return Infinity;
    } catch (error) {
      this.logger.error('Distance calculation failed', error);
      return Infinity;
    }
  }

  private calculateHaversineDistance(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ): number {
    const R = 6371; // km

    console.log('destination', destination);

    const dLat = this.toRad(destination.lat - origin.lat);
    const dLng = this.toRad(destination.lng - origin.lng);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(origin.lat)) *
        Math.cos(this.toRad(destination.lat)) *
        Math.sin(dLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  private toRad(value: number): number {
    return (value * Math.PI) / 180;
  }

  async getStoresByCategorybk(categoryId: string, customerLocation?: any) {
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
