// src/modules/driver/driver-heartbeat.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../shared/services/prisma.service';
import { GodViewGateway } from '../web-socket/god-view.gateway';
import { DispatchGateway } from '../web-socket/dispatch.gateway';

@Injectable()
export class DriverHeartbeatService {
  private readonly logger = new Logger(DriverHeartbeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly godViewGateway: GodViewGateway,
    private readonly dispatchGateway: DispatchGateway,
  ) {}

  @Cron('*/1 * * * *') // every minute
  async markStaleDriversOffline() {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000); // 2 min stale

    const stale = await this.prisma.driverProfile.findMany({
      where: {
        activityStatus: { not: 'NOT_AVAILABLE' },
        locationUpdatedAt: { lt: cutoff },
      },
      select: { userId: true },
    });

    for (const d of stale) {
      await this.prisma.driverProfile.update({
        where: { userId: d.userId },
        data: {
          activityStatus: 'NOT_AVAILABLE',
          status: 'OFFLINE',
        },
      });

      this.godViewGateway.emitDriverStatusChange({
        driverId: d.userId,
        activityStatus: 'NOT_AVAILABLE',
        updatedAt: new Date().toISOString(),
      });
      this.dispatchGateway.emitDriverStatusChange({
        driverId: d.userId,
        status: 'OFFLINE',
        updatedAt: new Date().toISOString(),
      });

      this.logger.warn(`Driver ${d.userId} marked NOT_AVAILABLE (heartbeat missed)`);
    }
  }
}