// src/payment/payment.module.ts
import { forwardRef, Module } from '@nestjs/common';
import { MonnifyService } from './monnify.service';
import { PaymentController } from './payment.controller';
import { OrderModule } from '../order/order.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    forwardRef(() => OrderModule), // 👈 important if circular
    NotificationModule,
  ],
  providers: [MonnifyService],
  controllers: [PaymentController],
  exports: [MonnifyService], // export so other modules can use it
})
export class PaymentModule {}
