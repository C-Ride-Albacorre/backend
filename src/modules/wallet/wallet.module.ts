import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { ConfigModule } from '@nestjs/config';
import { PaymentModule } from '../payment/payment.module';


@Module({
  imports: [
    ConfigModule,
    PaymentModule
  ],
  controllers: [WalletController],
  providers: [
    WalletService,
  ],
})
export class WalletModule {}