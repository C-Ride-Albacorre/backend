import { forwardRef, Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController, AdminDispatchController, AdminWalletController, DriverPayoutController } from './admin.controller';
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
import { AdminDispatchService } from './admin-dispatch.service';
import { DriverModule } from '../driver/driver.module';
import { NotificationModule } from '../notification/notification.module';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '../../shared/constants';

@Module({
  controllers: [AdminController, AdminWalletController, DriverPayoutController, AdminDispatchController],
  imports: [VerificationModule, AuthModule, OrderModule, WalletModule, PaymentModule,
    forwardRef(() => DriverModule),
    forwardRef(() => NotificationModule),
    BullModule.registerQueue({
      name: QUEUES.NOTIFICATION,
    }),
  ],
  providers: [
    AdminService,
    UserService,
    {
      provide: AbstractUserRepository,
      useClass: PrismaUserRepository,
    },
    VerificationService,
    DriverPayoutService,
    AdminDispatchService
  ],
  exports: [UserService, AbstractUserRepository, VerificationService, DriverPayoutService, AdminDispatchService],
})
export class AdminModule { }
