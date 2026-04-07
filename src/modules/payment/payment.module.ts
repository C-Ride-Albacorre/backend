// src/payment/payment.module.ts
import { Module } from '@nestjs/common';
import { MonnifyService } from './monnify.service';
import { PaymentController } from './payment.controller';

@Module({
  providers: [MonnifyService],
  controllers: [PaymentController],
  exports: [MonnifyService], // export so other modules can use it
})
export class PaymentModule {}
