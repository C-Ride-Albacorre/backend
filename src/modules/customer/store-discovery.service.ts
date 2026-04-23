import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import Helper from '../../shared/utils/helpers';
import { StoreStatus } from 'src/shared/enums';

@Injectable()
export class StoreDiscoveryService {
  private readonly logger = new Logger(StoreDiscoveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get stores by category
   */
  async getStores(params: {
    categoryId: string;
    subcategoryId?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const {
      categoryId,
      subcategoryId,
      lat,
      lng,
      radiusKm,
      search,
      page,
      limit,
    } = params;

    const safePage = Number(page) || 1;
    const safeLimit = Number(limit) || 20;
    const safeRadiusKm = radiusKm !== undefined ? Number(radiusKm) : null;

    const skip = (safePage - 1) * safeLimit;

    // ✅ Only use location if user explicitly provides it
    let userLocation: { lat: number; lng: number } | null = null;

    if (lat != null && lng != null) {
      userLocation = {
        lat: Number(lat),
        lng: Number(lng),
      };
    }

    const where: any = {
      categoryId,
      status: 'ACTIVE',
      // latitude: { not: null },
      // longitude: { not: null },
    };

    const cleanSearch = search?.trim();

    if (cleanSearch) {
      where.OR = [
        { storeName: { startsWith: cleanSearch, mode: 'insensitive' } },
        { storeName: { contains: cleanSearch, mode: 'insensitive' } },
        { storeAddress: { contains: cleanSearch, mode: 'insensitive' } },
        { storeDescription: { contains: cleanSearch, mode: 'insensitive' } },
        {
          products: {
            some: {
              productStatus: 'ACTIVE',
              OR: [
                { productName: { contains: cleanSearch, mode: 'insensitive' } },
                { description: { contains: cleanSearch, mode: 'insensitive' } },
                {
                  subcategory: {
                    name: { contains: cleanSearch, mode: 'insensitive' },
                  },
                },
              ],
            },
          },
        },
      ];
    }

    if (subcategoryId) {
      where.products = {
        some: {
          subcategoryId,
          productStatus: 'ACTIVE',
        },
      };
    }

    const stores = await this.prisma.store.findMany({
      where,
      skip,
      take: safeLimit,
      include: {
        category: true,
        operatingHours: true,
        products: {
          take: 4,
          where: { productStatus: 'ACTIVE' },
          include: {
            productImages: {
              take: 1,
              where: { isPrimary: true },
            },
            subcategory: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const total = await this.prisma.store.count({ where });

    let results = stores.map((store) => {
      let distance: number | null = null;

      if (userLocation) {
        const storeLat = Number(store.latitude);
        const storeLng = Number(store.longitude);

        if (!isNaN(storeLat) && !isNaN(storeLng)) {
          distance = Helper.calculateHaversineDistance(userLocation, {
            lat: storeLat,
            lng: storeLng,
          });
        }
      }

      return {
        id: store.id,
        storeName: store.storeName,
        categoryId: store.categoryId,
        storeCategory: store.category?.name,
        storeDescription: store.storeDescription,
        storeAddress: store.storeAddress,
        phoneNumber: store.phoneNumber,
        minimumOrder: store.minimumOrder,
        preparationTime: store.preparationTime,
        storeLogo: store.storeLogo,
        isOpen: Helper.isStoreOpen(store.operatingHours),
        distance: userLocation ? distance : null,
        subcategories: [
          ...new Set(
            store.products.map((p) => p.subcategory?.name).filter(Boolean),
          ),
        ],

        products: store.products,
      };
    });

    // ✅ Only apply radius filter if location exists
    if (userLocation && safeRadiusKm != null) {
      results = results.filter(
        (s) => s.distance != null && s.distance <= safeRadiusKm,
      );
    }

    // ✅ Only sort if location exists
    if (userLocation) {
      results.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    }

    return {
      data: results,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getStoresWithAuth(params: {
    categoryId: string;
    subcategoryId?: string;
    customerId?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const {
      categoryId,
      subcategoryId,
      customerId,
      lat,
      lng,
      radiusKm,
      search,
      page,
      limit,
    } = params;

    // ✅ Normalize inputs
    const safePage = Number(page) || 1;
    const safeLimit = Number(limit) || 20;
    const safeRadiusKm = radiusKm !== undefined ? Number(radiusKm) : null;

    const skip = (safePage - 1) * safeLimit;

    // ✅ Resolve user location
    let userLocation: { lat: number; lng: number } | null = null;

    if (lat != null && lng != null) {
      userLocation = { lat: Number(lat), lng: Number(lng) };
    } else if (customerId) {
      const savedLocation = await this.prisma.customerLocation.findFirst({
        where: { userId: customerId, isDefault: true },
        select: { latitude: true, longitude: true },
      });

      if (savedLocation?.latitude && savedLocation?.longitude) {
        userLocation = {
          lat: Number(savedLocation.latitude),
          lng: Number(savedLocation.longitude),
        };
      }
    }

    // ✅ Base WHERE clause
    const where: any = {
      categoryId: categoryId,
      status: 'ACTIVE',
      latitude: { not: null },
      longitude: { not: null },
    };

    const cleanSearch = search?.trim();

    if (cleanSearch && cleanSearch.length > 0) {
      where.OR = [
        // Store name (startsWith OR contains)
        { storeName: { startsWith: cleanSearch, mode: 'insensitive' } },
        { storeName: { contains: cleanSearch, mode: 'insensitive' } },

        // Store fields
        { storeAddress: { contains: cleanSearch, mode: 'insensitive' } },
        { storeDescription: { contains: cleanSearch, mode: 'insensitive' } },

        // Product search
        {
          products: {
            some: {
              productStatus: 'ACTIVE',
              OR: [
                {
                  productName: { startsWith: cleanSearch, mode: 'insensitive' },
                },
                { productName: { contains: cleanSearch, mode: 'insensitive' } },
                { description: { contains: cleanSearch, mode: 'insensitive' } },
                {
                  subcategory: {
                    name: { contains: cleanSearch, mode: 'insensitive' },
                  },
                },
              ],
            },
          },
        },
      ];
    }

    // ✅ Subcategory filter (via products)
    if (subcategoryId) {
      where.products = {
        some: {
          subcategoryId: subcategoryId,
          productStatus: 'ACTIVE',
        },
      };
    }

    // ✅ Fetch from DB (with pagination)
    const stores = await this.prisma.store.findMany({
      where,
      skip,
      take: safeLimit,
      include: {
        category: true,
        operatingHours: true,
        products: {
          take: 4,
          where: { productStatus: 'ACTIVE' },
          include: {
            productImages: {
              take: 1,
              where: { isPrimary: true },
            },
            subcategory: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // fallback ordering
      },
    });

    // ✅ Count total (for pagination meta)
    const total = await this.prisma.store.count({ where });

    // ✅ Map + distance
    let results = stores.map((store) => {
      let distance: number | null = null;

      if (userLocation) {
        const storeLat = Number(store.latitude);
        const storeLng = Number(store.longitude);

        if (!isNaN(storeLat) && !isNaN(storeLng)) {
          distance = Helper.calculateHaversineDistance(userLocation, {
            lat: storeLat,
            lng: storeLng,
          });
        }
      }

      return {
        id: store.id,
        storeName: store.storeName,
        categoryId: store.categoryId, // required by StoreResponseDto
        storeCategory: store.category?.name, // ✅ FIXED
        storeDescription: store.storeDescription,
        storeAddress: store.storeAddress,
        phoneNumber: store.phoneNumber,
        minimumOrder: store.minimumOrder,
        preparationTime: store.preparationTime,
        storeLogo: store.storeLogo,
        isOpen: Helper.isStoreOpen(store.operatingHours),
        distance,

        // ✅ derive subcategories from products
        subcategories: [
          ...new Set(
            store.products.map((p) => p.subcategory?.name).filter(Boolean),
          ),
        ],

        products: store.products,
      };
    });

    // ✅ Radius filter (after fetch)
    if (userLocation && safeRadiusKm != null) {
      results = results.filter(
        (s) => s.distance != null && s.distance <= safeRadiusKm,
      );
    }

    // ✅ Sort by distance if available
    if (userLocation) {
      results.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    }

    return {
      data: results,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getNearbyStores(params: {
    customerId?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    search?: string;
  }) {
    const { customerId, lat, lng, radiusKm, search } = params;

    // ✅ Resolve user location
    let userLocation: { lat: number; lng: number } | null = null;

    if (lat != null && lng != null) {
      userLocation = { lat: Number(lat), lng: Number(lng) };
    } else if (customerId) {
      const savedLocation = await this.prisma.customerLocation.findFirst({
        where: { userId: customerId, isDefault: true },
        select: { latitude: true, longitude: true },
      });

      if (savedLocation?.latitude && savedLocation?.longitude) {
        userLocation = {
          lat: Number(savedLocation.latitude),
          lng: Number(savedLocation.longitude),
        };
      }
    }

    // ✅ Base WHERE clause: only active stores with coordinates
    const where: any = {
      status: StoreStatus.ACTIVE,
      latitude: { not: null },
      longitude: { not: null },
    };

    // ✅ Optional search filter
    const cleanSearch = search?.trim();
    if (cleanSearch) {
      where.OR = [
        { storeName: { contains: cleanSearch, mode: 'insensitive' } },
        { storeAddress: { contains: cleanSearch, mode: 'insensitive' } },
        { storeDescription: { contains: cleanSearch, mode: 'insensitive' } },
        {
          products: {
            some: {
              productStatus: 'ACTIVE',
              OR: [
                { productName: { contains: cleanSearch, mode: 'insensitive' } },
                { description: { contains: cleanSearch, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    // ✅ Fetch all matching stores
    const stores = await this.prisma.store.findMany({
      where,
      include: {
        category: true,
        operatingHours: true,
        products: {
          take: 4,
          where: { productStatus: 'ACTIVE' },
          include: {
            productImages: { take: 1, where: { isPrimary: true } },
            subcategory: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // ✅ Map + distance calculation
    let results = stores.map((store) => {
      let distance: number | null = null;

      if (userLocation) {
        const storeLat = Number(store.latitude);
        const storeLng = Number(store.longitude);
        if (!isNaN(storeLat) && !isNaN(storeLng)) {
          distance = Helper.calculateHaversineDistance(userLocation, {
            lat: storeLat,
            lng: storeLng,
          });
        }
      }

      return {
        id: store.id,
        storeName: store.storeName,
        storeCategory: store.category?.name || null,
        storeDescription: store.storeDescription,
        storeAddress: store.storeAddress,
        phoneNumber: store.phoneNumber,
        minimumOrder: store.minimumOrder,
        preparationTime: store.preparationTime,
        storeLogo: store.storeLogo,
        isOpen: Helper.isStoreOpen(store.operatingHours),
        distance,
        subcategories: [
          ...new Set(
            store.products.map((p) => p.subcategory?.name).filter(Boolean),
          ),
        ],
        products: store.products,
      };
    });

    // ✅ Radius filter if provided
    if (userLocation && radiusKm != null) {
      results = results.filter(
        (s) => s.distance != null && s.distance <= radiusKm,
      );
    }

    // ✅ Sort by distance if available
    if (userLocation) {
      results.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    }

    // ✅ Return with meta, same as getStores
    const total = results.length;

    return {
      data: results,
      meta: {
        total,
        page: 1,
        limit: total,
        totalPages: 1,
      },
    };
  }

  async getStoresBySubcategory(params: {
    categoryId: string;
    subcategoryId: string;
    customerId?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const {
      categoryId,
      subcategoryId,
      customerId,
      lat,
      lng,
      radiusKm,
      page,
      limit,
      search,
    } = params;

    const safePage = Number(page) || 1;
    const safeLimit = Number(limit) || 20;
    const safeRadiusKm = radiusKm !== undefined ? Number(radiusKm) : null;
    const skip = (safePage - 1) * safeLimit;

    // ✅ Resolve user location
    let userLocation: { lat: number; lng: number } | null = null;

    if (lat != null && lng != null) {
      userLocation = { lat: Number(lat), lng: Number(lng) };
    } else if (customerId) {
      const savedLocation = await this.prisma.customerLocation.findFirst({
        where: { userId: customerId, isDefault: true },
        select: { latitude: true, longitude: true },
      });

      if (savedLocation?.latitude && savedLocation?.longitude) {
        userLocation = {
          lat: Number(savedLocation.latitude),
          lng: Number(savedLocation.longitude),
        };
      }
    }

    // ✅ WHERE
    const where: any = {
      categoryId,
      status: 'ACTIVE',
      latitude: { not: null },
      longitude: { not: null },
      products: {
        some: {
          subcategoryId,
          productStatus: 'ACTIVE',
        },
      },
    };

    // ✅ Search in DB
    if (search && search.trim()) {
      where.OR = [
        { storeName: { contains: search, mode: 'insensitive' } },
        { storeAddress: { contains: search, mode: 'insensitive' } },
        {
          products: {
            some: {
              productName: { contains: search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const stores = await this.prisma.store.findMany({
      where,
      skip,
      take: safeLimit,
      include: {
        category: true,
        operatingHours: true,
        products: {
          take: 4,
          where: { productStatus: 'ACTIVE' },
          include: {
            subcategory: true,
            productImages: {
              take: 1,
              where: { isPrimary: true },
            },
          },
        },
      },
    });

    const total = await this.prisma.store.count({ where });

    let results = stores.map((store) => {
      let distance: number | null = null;

      if (userLocation) {
        const storeLat = Number(store.latitude);
        const storeLng = Number(store.longitude);

        if (!isNaN(storeLat) && !isNaN(storeLng)) {
          distance = Helper.calculateHaversineDistance(userLocation, {
            lat: storeLat,
            lng: storeLng,
          });
        }
      }

      return {
        id: store.id,
        storeName: store.storeName,
        storeCategory: store.category?.name,
        storeDescription: store.storeDescription,
        storeAddress: store.storeAddress,
        phoneNumber: store.phoneNumber,
        minimumOrder: store.minimumOrder,
        preparationTime: store.preparationTime,
        storeLogo: store.storeLogo,
        isOpen: Helper.isStoreOpen(store.operatingHours),
        distance,
        subcategories: [
          ...new Set(
            store.products.map((p) => p.subcategory?.name).filter(Boolean),
          ),
        ],
        products: store.products,
      };
    });

    if (userLocation && safeRadiusKm != null) {
      results = results.filter(
        (s) => s.distance != null && s.distance <= safeRadiusKm,
      );
    }

    if (userLocation) {
      results.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    }

    return {
      data: results,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getStoresByCategory(params: {
    categoryId: string;
    customerId?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    page?: number;
    limit?: number;
  }) {
    const { categoryId, customerId, lat, lng, radiusKm, page, limit } = params;

    const safePage = Number(page) || 1;
    const safeLimit = Number(limit) || 20;
    const safeRadiusKm = radiusKm !== undefined ? Number(radiusKm) : null;
    const skip = (safePage - 1) * safeLimit;

    let userLocation: { lat: number; lng: number } | null = null;

    if (lat != null && lng != null) {
      userLocation = { lat: Number(lat), lng: Number(lng) };
    } else if (customerId) {
      const savedLocation = await this.prisma.customerLocation.findFirst({
        where: { userId: customerId, isDefault: true },
        select: { latitude: true, longitude: true },
      });

      if (savedLocation?.latitude && savedLocation?.longitude) {
        userLocation = {
          lat: Number(savedLocation.latitude),
          lng: Number(savedLocation.longitude),
        };
      }
    }

    const stores = await this.prisma.store.findMany({
      where: {
        categoryId,
        status: 'ACTIVE',
        latitude: { not: null },
        longitude: { not: null },
      },
      include: {
        category: true,
        operatingHours: true,
        products: {
          take: 4,
          where: { productStatus: 'ACTIVE' },
          include: {
            subcategory: true,
            productImages: {
              take: 1,
              where: { isPrimary: true },
            },
          },
        },
      },
    });

    let results = stores.map((store) => {
      let distance: number | null = null;

      if (userLocation) {
        const storeLat = Number(store.latitude);
        const storeLng = Number(store.longitude);

        if (!isNaN(storeLat) && !isNaN(storeLng)) {
          distance = Helper.calculateHaversineDistance(userLocation, {
            lat: storeLat,
            lng: storeLng,
          });
        }
      }

      return {
        id: store.id,
        storeName: store.storeName,
        storeCategory: store.category?.name,
        categoryId: store.categoryId, // required by StoreResponseDto
        storeDescription: store.storeDescription,
        storeAddress: store.storeAddress,
        phoneNumber: store.phoneNumber,
        minimumOrder: store.minimumOrder,
        preparationTime: store.preparationTime,
        storeLogo: store.storeLogo,
        isOpen: Helper.isStoreOpen(store.operatingHours),
        distance,
        subcategories: [
          ...new Set(
            store.products.map((p) => p.subcategory?.name).filter(Boolean),
          ),
        ],
      };
    });

    if (userLocation && safeRadiusKm != null) {
      results = results.filter(
        (s) => s.distance != null && s.distance <= safeRadiusKm,
      );
    }

    if (userLocation) {
      results.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    } else {
      results.sort((a, b) => a.storeName.localeCompare(b.storeName));
    }

    const paginatedResults = results.slice(skip, skip + safeLimit);

    return {
      data: paginatedResults,
      meta: {
        total: results.length,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(results.length / safeLimit),
      },
    };
  }

  // private async calculateDistanceWithGoogle(
  //   origin: { lat: number; lng: number },
  //   destination: { lat: number; lng: number },
  // ): Promise<number> {
  //   try {
  //     const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  //     const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;

  //     const response = await axios.get(url, {
  //       params: {
  //         origins: `${origin.lat},${origin.lng}`,
  //         destinations: `${destination.lat},${destination.lng}`,
  //         key: apiKey,
  //       },
  //     });

  //     const element = response.data.rows[0].elements[0];

  //     if (element.status === 'OK') {
  //       // distance in meters → convert to km
  //       return element.distance.value / 1000;
  //     }

  //     return Infinity;
  //   } catch (error) {
  //     this.logger.error('Distance calculation failed', error);
  //     return Infinity;
  //   }
  // }

  // private calculateHaversineDistance(
  //   origin: { lat: number; lng: number },
  //   destination: { lat: number; lng: number },
  // ): number {
  //   const R = 6371; // km

  //   console.log('destination', destination);

  //   const dLat = this.toRad(destination.lat - origin.lat);
  //   const dLng = this.toRad(destination.lng - origin.lng);

  //   const a =
  //     Math.sin(dLat / 2) ** 2 +
  //     Math.cos(this.toRad(origin.lat)) *
  //       Math.cos(this.toRad(destination.lat)) *
  //       Math.sin(dLng / 2) ** 2;

  //   const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  //   return R * c;
  // }

  // private toRad(value: number): number {
  //   return (value * Math.PI) / 180;
  // }

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
    // Get all subcategories
    const subcategories = await this.prisma.subcategory.findMany({
      where: {
        categoryId,
        isActive: true,
      },
      orderBy: { displayOrder: 'asc' },
    });

    // Count stores per subcategory
    const results = await Promise.all(
      subcategories.map(async (sub) => {
        const storeCount = await this.prisma.store.count({
          where: {
            status: 'ACTIVE',
            products: {
              some: {
                subcategoryId: sub.id,
                productStatus: 'ACTIVE',
              },
            },
          },
        });

        return {
          id: sub.id,
          name: sub.name,
          description: sub.description,
          storeCount,
        };
      }),
    );

    return results;
  }

  /**
   * Get store details with products
   */
  async getStoreWithProducts(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        category: true, // store category
        operatingHours: true,
        products: {
          where: { productStatus: 'ACTIVE' },
          include: {
            subcategory: true, // product subcategory
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
  // private isStoreOpen(operatingHours: any[]): boolean {
  //   const now = new Date();
  //   const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  //   const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

  //   const todayHours = operatingHours.find((h) => h.dayOfWeek === dayOfWeek);

  //   if (!todayHours || !todayHours.isOpen) {
  //     return false;
  //   }

  //   return (
  //     currentTime >= todayHours.openingTime &&
  //     currentTime <= todayHours.closingTime
  //   );
  // }

  /**
   * Calculate distance between store and customer (simplified)
   * In production, use a proper geolocation library
   */
  // private calculateDistance(store: any, customerLocation: any): number {
  //   // Simplified - in production, use proper distance calculation
  //   // based on latitude/longitude
  //   return Math.random() * 10; // Mock distance in km
  // }
}
