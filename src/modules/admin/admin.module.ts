import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController, AdminWalletController } from './admin.controller';
import { AbstractUserRepository } from '../user/repositories/abstract-user.repository';
import { PrismaUserRepository } from '../user/repositories/prisma-user.repository';
import { UserService } from '../user/user.service';
import { VerificationService } from '../verification/verification.service';
import { VerificationModule } from '../verification/verification.module';
import { AuthModule } from '../auth/auth.module';
import { OrderModule } from '../order/order.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  controllers: [AdminController, AdminWalletController],
  imports: [VerificationModule, AuthModule, OrderModule, WalletModule],
  providers: [
    AdminService,
    UserService,
    {
      provide: AbstractUserRepository,
      useClass: PrismaUserRepository,
    },
    VerificationService,
  ],
  exports: [UserService, AbstractUserRepository, VerificationService],
})
export class AdminModule {}
