import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController, AdminWalletController, DriverPayoutController } from './admin.controller';
import { AbstractUserRepository } from '../user/repositories/abstract-user.repository';
import { PrismaUserRepository } from '../user/repositories/prisma-user.repository';
import { UserService } from '../user/user.service';
import { VerificationService } from '../verification/verification.service';
import { VerificationModule } from '../verification/verification.module';
import { AuthModule } from '../auth/auth.module';
import { OrderModule } from '../order/order.module';
import { WalletModule } from '../wallet/wallet.module';
import { DriverPayoutService } from './driver-payout.service';
import { PaymentModule } from '../payment/payment.module';

@Module({
  controllers: [AdminController, AdminWalletController, DriverPayoutController],
  imports: [VerificationModule, AuthModule, OrderModule, WalletModule, PaymentModule],
  providers: [
    AdminService,
    UserService,
    {
      provide: AbstractUserRepository,
      useClass: PrismaUserRepository,
    },
    VerificationService,
    DriverPayoutService
  ],
  exports: [UserService, AbstractUserRepository, VerificationService, DriverPayoutService],
})
export class AdminModule {}
