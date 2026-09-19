import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WalletService } from '../../../modules/wallet/wallet.service';
import { PrismaService } from '../../../shared/services/prisma.service';
import { EarningStatus } from '@prisma/client';

@Injectable()
export class ClearMatureDriverEarningCron {
  private readonly logger = new Logger(ClearMatureDriverEarningCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService, // Replace 'any' with the actual type of your WalletService
  ) {}
  
@Cron('0 3 * * *')   // daily 03:00
async clearMaturedDriverEarnings() {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);   // 48h hold

  const batch = await this.prisma.driverEarning.findMany({
    where: { status: EarningStatus.EARNED, clearedAt: null, earnedAt: { lte: cutoff } },
    select: { id: true, walletTxId: true, driverId: true, totalAmount: true },
  });
  if (batch.length === 0) return;

  let cleared = 0;
  for (const e of batch) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.walletService.clearPendingCredit(e.walletTxId);
        await tx.driverEarning.update({
          where: { id: e.id },
          data: { status: EarningStatus.CLEARED, clearedAt: new Date() },
        });
      });
      cleared++;
    } catch (err) {
      this.logger.error(`Failed to clear earning ${e.id}`, err);
    }
  }

  this.logger.log(`Cleared ${cleared}/${batch.length} driver earnings`);
}

}