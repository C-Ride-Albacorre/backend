import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { VendorSettlementService } from '../vendor-settlement.service';

@Injectable()
export class VendorSettlementCron {
  private readonly logger = new Logger(VendorSettlementCron.name);

  constructor(
    private readonly settlementService: VendorSettlementService,
  ) {}

  @Cron('0 2 * * 1', { name: 'weekly-settlements' })
  async generateWeekly() {
    const now = new Date();

    const periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() - 1);
    periodEnd.setHours(23, 59, 59, 999);

    const periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() - 6);
    periodStart.setHours(0, 0, 0, 0);

    this.logger.log(
      `Generating settlements for ${periodStart.toISOString()} → ${periodEnd.toISOString()}`,
    );

    await this.settlementService.generateForPeriod(
      periodStart,
      periodEnd,
    );
  }
}
