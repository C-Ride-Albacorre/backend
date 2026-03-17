// src/payment/payment.module.ts
import { Module } from '@nestjs/common';
import { MonnifyService } from './monnify.service';

@Module({
  providers: [MonnifyService],
  exports: [MonnifyService], // export so other modules can use it
})
export class PaymentModule {}
