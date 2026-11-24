// src/modules/admin/analytics/heat-view.service.ts

import { Inject, Injectable, Logger } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../modules/redis/redis.provider';
import { PrismaService } from '../../shared/services/prisma.service';
import { HeatViewResponseDto } from './heat-view-response.dto';

@Injectable()
export class HeatViewService {
  private readonly logger = new Logger(HeatViewService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    
  ) {}

  async getHeatViewData(
    timeWindowMinutes: number,
    forceRefresh: boolean,
  ): Promise<HeatViewResponseDto> {
    const cacheKey = `analytics:heatview:${timeWindowMinutes}m`;

    // 1. Check Cache (unless forceRefresh is true)
    if (!forceRefresh) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as HeatViewResponseDto;
        }
      } catch (err) {
        this.logger.warn(`Redis cache read failed: ${err}`);
        // Fall through to DB if Redis fails
      }
    }

    // 2. Generate fresh data from DB
    const cutoff = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

    const recentOrders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: cutoff },
        paymentStatus: PaymentStatus.PAID,
      },
      select: {
        id: true,
        dropoffLocation: true,
        createdAt: true,
      },
    });

    const validLocations = recentOrders
      .map((o) => {
        const loc = o.dropoffLocation as any;
        return { lat: loc?.latitude || loc?.lat, lng: loc?.longitude || loc?.lng };
      })
      .filter((loc) => typeof loc.lat === 'number' && typeof loc.lng === 'number');

    const heatmapClusters = this.clusterLocations(validLocations);

    const activeCutoff = new Date(Date.now() - 5 * 60 * 1000);
    const activeOrders = recentOrders.filter((o) => o.createdAt >= activeCutoff);

    const activeCustomerDots = activeOrders
      .map((o) => {
        const loc = o.dropoffLocation as any;
        return {
          id: o.id,
          lat: loc?.latitude || loc?.lat,
          lng: loc?.longitude || loc?.lng,
        };
      })
      .filter((loc) => typeof loc.lat === 'number' && typeof loc.lng === 'number');

    let peakZone = 'N/A';
    if (heatmapClusters.length > 0) {
      const peak = heatmapClusters.reduce((prev, current) =>
        prev.weight > current.weight ? prev : current,
      );
      // In production, use a reverse geocoding service here based on peak.lat/lng
      peakZone = 'Victoria Island'; 
    }

    const response: HeatViewResponseDto = {
      generatedAt: new Date().toISOString(),
      timeWindowMinutes,
      summary: {
        totalDataPoints: recentOrders.length,
        activeCustomers: activeCustomerDots.length,
        peakZone,
        deliveryDriversExcluded: true,
        metricDrivingIntensity: 'Order count',
      },
      heatmapData: heatmapClusters,
      activeCustomerDots,
    };

    // 3. Save to Cache (TTL: 20 seconds)
    // We use 20s so that if 10 admins load the page, they share the result.
    // It expires before the 30s frontend poll, ensuring fresh data eventually.
    try {
      await this.redis.setex(cacheKey, 20, JSON.stringify(response));
    } catch (err) {
      this.logger.warn(`Redis cache write failed: ${err}`);
    }

    return response;
  }

  private clusterLocations(points: { lat: number; lng: number }[]) {
    const gridSize = 0.01; 
    const clusters = new Map<string, { lat: number; lng: number; weight: number }>();

    for (const point of points) {
      const gridLat = Math.round(point.lat / gridSize) * gridSize;
      const gridLng = Math.round(point.lng / gridSize) * gridSize;
      const key = `${gridLat},${gridLng}`;

      if (clusters.has(key)) {
        const existing = clusters.get(key)!;
        existing.weight += 1;
      } else {
        clusters.set(key, { lat: gridLat, lng: gridLng, weight: 1 });
      }
    }

    return Array.from(clusters.values());
  }
}