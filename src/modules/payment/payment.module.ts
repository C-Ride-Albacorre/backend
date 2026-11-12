// src/payment/payment.module.ts
import { forwardRef, Module } from '@nestjs/common';
import { MonnifyService } from './monnify.service';
import { PaymentController } from './payment.controller';
import { OrderModule } from '../order/order.module';
import { NotificationModule } from '../notification/notification.module';
import { WalletModule } from '../wallet/wallet.module';
import { QUEUES } from '../../shared/constants';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    forwardRef(() => OrderModule), // 👈 important if circular
    forwardRef(() => WalletModule),
    NotificationModule,
    BullModule.registerQueue(
          { name: QUEUES.CUSTOMER_NOTIFICATION },
          { name: QUEUES.VENDOR_NOTIFICATION },
    ),
  ],
  providers: [MonnifyService],
  controllers: [PaymentController],
  exports: [MonnifyService], // export so other modules can use it
})
export class PaymentModule {}
