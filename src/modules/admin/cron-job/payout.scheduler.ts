import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DriverPayoutService } from '../driver-payout.service';

@Injectable()
export class PayoutScheduler {
  private readonly logger = new Logger(PayoutScheduler.name);

  constructor(private readonly payoutService: DriverPayoutService) {}

  // Every Monday at 00:00 — adjust timezone to Africa/Lagos
  // @Cron('0 0 0 * * 1', {
  //   name: 'weekly-payout-generation',
  //   timeZone: 'Africa/Lagos',
  // })
  @Cron('*/1 * * * *', {
  name: 'weekly-payout-generation',
  timeZone: 'Africa/Lagos',
})
  async handleWeeklyPayouts() {
    this.logger.log('Running weekly payout generation...');

    // Period = previous 7 days (Mon → Sun)
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() - 7);

    try {
      const result = await this.payoutService.generate(
        {
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
        },
        'SYSTEM', // adminId — use a system user ID
      );
      this.logger.log(`Weekly payouts generated: ${result.data.length}`);
    } catch (error) {
      this.logger.error(`Weekly payout generation failed: ${error}`);
    }
  }
}


//////Important for multi-instance deployments: Add a Redis-based distributed lock so only one server runs the cron /////
// @Cron('0 0 0 * * 1', { name: 'weekly-payout-generation', timeZone: 'Africa/Lagos' })
// async handleWeeklyPayouts() {
//   const lockKey = 'cron:payout:weekly';
//   const acquired = await this.redis.set(lockKey, '1', 'EX', 300, 'NX');
//   if (!acquired) {
//     this.logger.debug('Another instance is running payout generation');
//     return;
//   }
//   try {
//     // ... generate payouts
//   } finally {
//     await this.redis.del(lockKey);
//   }
// }