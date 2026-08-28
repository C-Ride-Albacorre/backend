import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../modules/redis/redis.provider';
import { DriverStatus } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CurrentSessionResponseDto } from './dto/current-session-response.dto';
import { DriverHoursResponseDto } from './dto/driver-hours-response.dto';

@Injectable()
export class DriverOnlineHoursService implements OnModuleDestroy {
    private readonly logger = new Logger(DriverOnlineHoursService.name);
    private readonly SESSION_KEY_PREFIX = 'driver:active:session:';
    private readonly SESSION_TTL = 60 * 60 * 24; // 24h

    constructor(
        private prisma: PrismaService,
        @Inject(REDIS_CLIENT) public redis: Redis,
    ) { }

    
  /**
   * Get active hours for a driver on a specific date.
   * @param driverId - Driver ID
   * @param dateStr - ISO date string (YYYY-MM-DD); defaults to today
   * @returns DTO with hours, seconds, and date
   */
  async getDriverHoursForDate(
    driverId: string,
    dateStr?: string,
  ): Promise<DriverHoursResponseDto> {
    const effectiveDateStr = dateStr || new Date().toISOString().split('T')[0];
    const date = new Date(effectiveDateStr);
    date.setHours(0, 0, 0, 0);

    const hours = await this.getActiveHours(driverId, date);
    const seconds = Math.round(hours * 3600);

    return {
      driverId,
      date: effectiveDateStr,
      hours,
      seconds,
    };
  }

  /**
   * Get current active session duration and start time.
   * @param driverId - Driver ID
   * @returns DTO with duration (seconds) and startedAt (ISO string or null)
   */
  async getCurrentSessionInfo(
    driverId: string,
  ): Promise<CurrentSessionResponseDto> {
    const key = this.SESSION_KEY_PREFIX + driverId;
    const startTimeStr = await this.redis.get(key);

    if (!startTimeStr) {
      return {
        driverId,
        durationSeconds: null,
        startedAt: null,
      };
    }

    const startTime = parseInt(startTimeStr, 10);
    const now = Date.now();
    const durationSeconds = (now - startTime) / 1000;

    return {
      driverId,
      durationSeconds,
      startedAt: new Date(startTime).toISOString(),
    };
  }

    /**
     * Called whenever a driver's status changes.
     * We only care about transitions involving OFFLINE.
     */
    async onDriverStatusChange(
        driverId: string,
        oldStatus: DriverStatus,
        newStatus: DriverStatus,
    ): Promise<void> {
        // If driver goes OFFLINE -> end session
        if (newStatus === DriverStatus.OFFLINE && oldStatus !== DriverStatus.OFFLINE) {
            await this.endActiveSession(driverId);
            return;
        }

        // If driver goes from OFFLINE to any active state -> start session
        if (oldStatus === DriverStatus.OFFLINE && newStatus !== DriverStatus.OFFLINE) {
            await this.startActiveSession(driverId);
            return;
        }

        // Otherwise, status changed between ONLINE and BUSY (or other non-OFFLINE states)
        // Timer continues – nothing to do.
    }

    /**
     * Start a new active session.
     * Uses Redis SET NX to prevent double starts.
     */
    private async startActiveSession(driverId: string): Promise<void> {
        const key = this.SESSION_KEY_PREFIX + driverId;
        const now = Date.now();

        const set = await this.redis.set(key, now.toString(), 'EX', this.SESSION_TTL, 'NX');
        if (set === 'OK') {
            this.logger.log(`Started active session for driver ${driverId} at ${new Date(now).toISOString()}`);
            // Optionally create a DB session record for audit
            // await this.prisma.driverSession.create({ data: { driverId, startedAt: new Date(now) } });
        } else {
            this.logger.debug(`Active session already exists for driver ${driverId}`);
        }
    }

    /**
     * End the current active session.
     * - Retrieve start time from Redis.
     * - Calculate duration.
     * - Add to daily stats.
     * - Delete Redis key.
     */
    private async endActiveSession(driverId: string): Promise<void> {
        const key = this.SESSION_KEY_PREFIX + driverId;
        const startTimeStr = await this.redis.get(key);
        if (!startTimeStr) {
            this.logger.warn(`No active session found for driver ${driverId} on end`);
            return;
        }

        const startTime = parseInt(startTimeStr, 10);
        const now = Date.now();
        const durationSeconds = Math.floor((now - startTime) / 1000);

        if (durationSeconds <= 0) {
            this.logger.warn(`Non-positive duration (${durationSeconds}s) for driver ${driverId}, skipping`);
            await this.redis.del(key);
            return;
        }

        // Atomic update of daily stats
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        await this.prisma.$transaction(async (tx) => {
            await tx.driverDailyStats.upsert({
                where: {
                    driverId_date: { driverId, date: today },
                },
                update: {
                    activeSeconds: { increment: durationSeconds },
                },
                create: {
                    driverId,
                    date: today,
                    activeSeconds: durationSeconds,
                },
            });

            // Optionally update session record
            const session = await tx.driverSession.findFirst({
              where: { driverId, endedAt: null },
              orderBy: { startedAt: 'desc' },
            });
            if (session) {
              await tx.driverSession.update({
                where: { id: session.id },
                data: { endedAt: new Date(now), duration: durationSeconds },
              });
            }
        });

        await this.redis.del(key);
        this.logger.log(`Ended active session for driver ${driverId} – +${durationSeconds}s`);
    }

    /**
     * Get total online (active) hours for a driver on a given date.
     */
    async getActiveHours(driverId: string, date: Date): Promise<number> {
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);

        const stats = await this.prisma.driverDailyStats.findUnique({
            where: {
                driverId_date: { driverId, date: dayStart },
            },
        });

        return stats ? stats.activeSeconds / 3600 : 0;
    }

    /**
     * Get current active session duration (if any).
     */
    async getCurrentActiveDuration(driverId: string): Promise<number | null> {
        const key = this.SESSION_KEY_PREFIX + driverId;
        const startTimeStr = await this.redis.get(key);
        if (!startTimeStr) return null;

        const startTime = parseInt(startTimeStr, 10);
        const now = Date.now();
        return (now - startTime) / 1000; // seconds
    }

    /**
     * Periodically flush active sessions to DB to prevent data loss.
     * Called every hour (cron job).
     */
    @Cron(CronExpression.EVERY_HOUR)
    async flushActiveSessions(): Promise<void> {
        const keys = await this.redis.keys(`${this.SESSION_KEY_PREFIX}*`);
        for (const key of keys) {
            const driverId = key.replace(this.SESSION_KEY_PREFIX, '');
            // Check if driver is still active (not OFFLINE)
            const driver = await this.prisma.driverProfile.findUnique({
                where: { userId: driverId },
                select: { status: true },
            });
            if (driver?.status === DriverStatus.OFFLINE) {
                // Driver is offline, but session key still exists – force end
                await this.endActiveSession(driverId);
            } else {
                // Driver is still active – we can optionally checkpoint partial hours
                // by ending and restarting the session to persist accumulated time.
                // However, this could cause double-counting if not careful.
                // For safety, we only flush if the session has been running for > X hours.
                const startTimeStr = await this.redis.get(key);
                if (startTimeStr) {
                    const startTime = parseInt(startTimeStr, 10);
                    const now = Date.now();
                    const hours = (now - startTime) / (1000 * 60 * 60);
                    if (hours >= 1) {
                        // End and immediately restart to persist the accumulated time
                        await this.endActiveSession(driverId);
                        await this.startActiveSession(driverId);
                    }
                }
            }
        }
    }

    /**
     * On app shutdown, flush all remaining sessions.
     */
    async onModuleDestroy() {
        await this.flushActiveSessions();
    }
}