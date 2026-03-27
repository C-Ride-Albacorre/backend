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
  async getStores(params: {
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

    const safePage = Number(page) || 1;
    const safeLimit = Number(limit) || 20;
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

      if (savedLocation) {
        userLocation = {
          lat: Number(savedLocation.latitude),
          lng: Number(savedLocation.longitude),
        };
      }
    }

    // ✅ Build dynamic WHERE clause
    const where: any = {
      storeCategory: categoryId,
      status: 'ACTIVE',
      latitude: { not: null },
      longitude: { not: null },
    };

    // ✅ Subcategory filter (optional)
    if (subcategoryId) {
      where.storeSubcategories = {
        some: {
          subcategoryId,
        },
      };
    }

    // ✅ Search filter (DB level)
    if (search && search.trim().length > 0) {
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

    // ✅ Fetch from DB
    const stores = await this.prisma.store.findMany({
      where,
      include: {
        storeSubcategories: { include: { subcategory: true } },
        operatingHours: true,
        products: {
          take: 4,
          where: { productStatus: 'ACTIVE' },
          include: {
            productImages: { take: 1, where: { isPrimary: true } },
          },
        },
      },
    });

    // ✅ Map + distance
    let results = stores.map((store) => {
      let distance: number | null = null;

      if (userLocation) {
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
        products: store.products,
      };
    });

    // ✅ Radius filter
    if (userLocation && radiusKm != null) {
      results = results.filter(
        (s) => s.distance != null && s.distance <= radiusKm,
      );
    }

    // ✅ Sorting
    if (userLocation) {
      results.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    } else {
      results.sort((a, b) => a.storeName.localeCompare(b.storeName));
    }

    // ✅ Pagination
    const paginated = results.slice(skip, skip + safeLimit);

    return {
      data: paginated,
      meta: {
        total: results.length,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(results.length / safeLimit),
      },
    };
  }

  async getStoresByCategoryLatest(params: {
    categoryId: string;
    customerId?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { categoryId, customerId, lat, lng, radiusKm, page, limit, search } =
      params;

    // 1️⃣ Normalize inputs
    const safePage = Number(page) || 1;
    const safeLimit = Number(limit) || 20;
    const safeRadiusKm = radiusKm !== undefined ? Number(radiusKm) : null;
    const skip = (safePage - 1) * safeLimit;

    this.logger.log(
      `Fetching stores | category=${categoryId} | user=${customerId}`,
    );

    // 2️⃣ Resolve user location
    let userLocation: { lat: number; lng: number } | null = null;
    if (lat != null && lng != null) {
      userLocation = { lat: Number(lat), lng: Number(lng) };
    } else if (customerId) {
      const savedLocation = await this.prisma.customerLocation.findFirst({
        where: { userId: customerId, isDefault: true },
        select: { latitude: true, longitude: true },
      });

      if (savedLocation?.latitude != null && savedLocation?.longitude != null) {
        userLocation = {
          lat: Number(savedLocation.latitude),
          lng: Number(savedLocation.longitude),
        };
      }
    }

    // 3️⃣ Fetch all stores in the category
    const stores = await this.prisma.store.findMany({
      where: {
        storeCategory: categoryId,
        status: 'ACTIVE',
        latitude: { not: null },
        longitude: { not: null },
      },
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

    if (stores.length === 0) {
      console.warn('⚠️ No stores found for this category');
    }

    // 4️⃣ Map stores and calculate distance
    let results = stores.map((store) => {
      let distance: number | null = null;
      if (userLocation) {
        const storeLat = Number(store.latitude);
        const storeLng = Number(store.longitude);
        if (!isNaN(storeLat) && !isNaN(storeLng)) {
          distance = this.calculateHaversineDistance(userLocation, {
            lat: storeLat,
            lng: storeLng,
          });
        }
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
        products: store.products.map((p) => ({
          id: p.id,
          productName: p.productName,
          description: p.description,
          productImages: p.productImages.map((img) => ({
            id: img.id,
            imageUrl: img.imageUrl,
            isPrimary: img.isPrimary,
          })),
        })),
      };
    });

    // 5️⃣ Apply search filter (storeName, storeAddress, productName)
    if (search && search.trim().length > 0) {
      const searchLower = search.toLowerCase();
      results = results.filter(
        (store) =>
          store.storeName.toLowerCase().includes(searchLower) ||
          store.storeAddress?.toLowerCase().includes(searchLower) ||
          store.products.some(
            (p) =>
              p.productName.toLowerCase().includes(searchLower) ||
              p.description.toLowerCase().includes(searchLower),
          ),
      );
    }

    // 6️⃣ Apply radius filter if user location exists
    if (userLocation && safeRadiusKm != null) {
      results = results.filter(
        (store) => store.distance != null && store.distance <= safeRadiusKm,
      );
    }

    // 7️⃣ Sort stores
    if (userLocation) {
      results.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    } else {
      results.sort((a, b) => a.storeName.localeCompare(b.storeName));
    }

    // 8️⃣ Apply pagination
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

    // ✅ 1. Normalize inputs
    const safePage = Number(page) || 1;
    const safeLimit = Number(limit) || 20;
    const safeRadiusKm = radiusKm !== undefined ? Number(radiusKm) : null;
    const skip = (safePage - 1) * safeLimit;

    // ✅ 2. Resolve user location
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

    // ✅ 3. Fetch stores by subcategory + category
    const stores = await this.prisma.store.findMany({
      where: {
        storeCategory: categoryId,
        status: 'ACTIVE',
        latitude: { not: null },
        longitude: { not: null },
        storeSubcategories: {
          some: {
            subcategoryId: subcategoryId,
          },
        },
      },
      include: {
        storeSubcategories: {
          include: { subcategory: true },
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

    // ✅ 4. Map + distance
    let results = stores.map((store) => {
      let distance: number | null = null;

      if (userLocation) {
        const storeLat = Number(store.latitude);
        const storeLng = Number(store.longitude);

        if (!isNaN(storeLat) && !isNaN(storeLng)) {
          distance = this.calculateHaversineDistance(userLocation, {
            lat: storeLat,
            lng: storeLng,
          });
        }
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
        products: store.products.map((p) => ({
          id: p.id,
          productName: p.productName,
          productImages: p.productImages,
        })),
      };
    });

    // ✅ 5. Search filter
    if (search && search.trim().length > 0) {
      const searchLower = search.toLowerCase();

      results = results.filter((store) => {
        const productMatch = store.products.some((p) =>
          p.productName.toLowerCase().includes(searchLower),
        );

        return (
          store.storeName.toLowerCase().includes(searchLower) ||
          store.storeAddress?.toLowerCase().includes(searchLower) ||
          productMatch
        );
      });
    }

    // ✅ 6. Radius filter
    if (userLocation && safeRadiusKm != null) {
      results = results.filter(
        (store) => store.distance != null && store.distance <= safeRadiusKm,
      );
    }

    // ✅ 7. Sorting
    if (userLocation) {
      results.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    } else {
      results.sort((a, b) => a.storeName.localeCompare(b.storeName));
    }

    // ✅ 8. Pagination
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

    // ✅ 1. Normalize inputs
    const safePage = Number(page) || 1;
    const safeLimit = Number(limit) || 20;
    const safeRadiusKm = radiusKm !== undefined ? Number(radiusKm) : null;

    const skip = (safePage - 1) * safeLimit;

    this.logger.log(
      `Fetching stores | category=${categoryId} | user=${customerId}`,
    );

    console.log('🔍 INPUT DEBUG', {
      categoryId,
      customerId,
      lat,
      lng,
      safeRadiusKm,
      safePage,
      safeLimit,
      skip,
    });

    // ✅ 2. Resolve user location
    let userLocation: { lat: number; lng: number } | null = null;

    if (lat != null && lng != null) {
      userLocation = {
        lat: Number(lat),
        lng: Number(lng),
      };
    } else if (customerId) {
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
          lat: Number(savedLocation.latitude),
          lng: Number(savedLocation.longitude),
        };
      }
    }

    // ✅ 3. Fetch ALL stores (NO pagination here)
    const stores = await this.prisma.store.findMany({
      where: {
        storeCategory: categoryId,
        status: 'ACTIVE',
        latitude: { not: null },
        longitude: { not: null },
      },
      include: {
        storeSubcategories: {
          include: { subcategory: true },
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

    console.log('store', stores);

    if (stores.length === 0) {
      console.warn('⚠️ No stores found for this category');
    }

    // ✅ 4. Map + distance calculation
    const results = stores.map((store) => {
      let distance: number | null = null;

      if (userLocation) {
        const storeLat = Number(store.latitude);
        const storeLng = Number(store.longitude);

        if (!isNaN(storeLat) && !isNaN(storeLng)) {
          distance = this.calculateHaversineDistance(userLocation, {
            lat: storeLat,
            lng: storeLng,
          });

          if (isNaN(distance)) {
            console.warn('❌ NaN distance detected', {
              storeId: store.id,
              storeLat,
              storeLng,
              userLocation,
            });
            distance = null;
          }
        }
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

    // ✅ 5. Filter + sort
    let finalResults = results;

    if (userLocation) {
      // Optional radius filtering
      if (safeRadiusKm != null) {
        finalResults = finalResults.filter(
          (store) => store.distance != null && store.distance <= safeRadiusKm,
        );
      }

      // Sort by proximity
      finalResults.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    } else {
      // Fallback sorting
      finalResults.sort((a, b) => a.storeName.localeCompare(b.storeName));
    }

    // ✅ 6. Apply pagination AFTER sorting
    const paginatedResults = finalResults.slice(skip, skip + safeLimit);

    // (Optional but recommended)
    return {
      data: paginatedResults,
      meta: {
        total: finalResults.length,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(finalResults.length / safeLimit),
      },
    };
  }

  async getStoresByCategoryByProximity(params: {
    categoryId: string;
    customerId?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    page?: number;
    limit?: number;
  }) {
    const { categoryId, customerId, lat, lng, radiusKm, page, limit } = params;

    // ✅ 1. Normalize numbers (CRITICAL FIX)
    const safePage = Number(page) || 1;
    const safeLimit = Number(limit) || 20;
    const safeRadiusKm = radiusKm !== undefined ? Number(radiusKm) : null;

    const skip = (safePage - 1) * safeLimit;

    this.logger.log(
      `Fetching stores | category=${categoryId} | user=${customerId}`,
    );

    console.log('🔍 INPUT DEBUG', {
      categoryId,
      customerId,
      lat,
      lng,
      safeRadiusKm,
      safePage,
      safeLimit,
      skip,
    });

    // ✅ 2. Resolve user location
    let userLocation: { lat: number; lng: number } | null = null;

    if (lat != null && lng != null) {
      userLocation = {
        lat: Number(lat),
        lng: Number(lng),
      };
    } else if (customerId) {
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
          lat: Number(savedLocation.latitude),
          lng: Number(savedLocation.longitude),
        };
      }
    }

    // ✅ 3. Fetch stores (BASE QUERY)
    const stores = await this.prisma.store.findMany({
      where: {
        storeCategory: categoryId,
        status: 'ACTIVE',
        latitude: { not: null },
        longitude: { not: null },
      },
      skip,
      take: safeLimit,
      include: {
        storeSubcategories: {
          include: { subcategory: true },
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

    if (stores.length === 0) {
      console.warn('⚠️ No stores found for this category');
    }

    // ✅ 4. Map + SAFE distance calculation
    const results = stores.map((store) => {
      let distance: number | null = null;

      if (userLocation) {
        const storeLat = Number(store.latitude);
        const storeLng = Number(store.longitude);

        if (!isNaN(storeLat) && !isNaN(storeLng)) {
          distance = this.calculateHaversineDistance(userLocation, {
            lat: storeLat,
            lng: storeLng,
          });

          if (isNaN(distance)) {
            console.warn('❌ NaN distance detected', {
              storeId: store.id,
              storeLat,
              storeLng,
              userLocation,
            });
            distance = null;
          }
        }
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

    // ✅ 5. Filtering + sorting
    let finalResults = results;

    if (userLocation) {
      // Apply radius ONLY if provided and greater than 0
      if (safeRadiusKm != null && safeRadiusKm > 0) {
        finalResults = finalResults.filter(
          (store) => store.distance != null && store.distance <= safeRadiusKm,
        );
      }

      // Sort by distance
      finalResults.sort(
        (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      );
    } else {
      // Sort alphabetically if no user location
      finalResults.sort((a, b) => a.storeName.localeCompare(b.storeName));
    }

    // ✅ Apply pagination AFTER sorting if needed
    // const paginatedResults = finalResults.slice(skip, skip + safeLimit);

    return finalResults;
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
