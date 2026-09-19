import { forwardRef, Module } from '@nestjs/common';
import { DriverService } from './driver.service';
import { DriverController, DriverEarningsController, DriverWalletController } from './driver.controller';
import { UserModule } from '../user/user.module';
import { BullModule } from '@nestjs/bullmq';
import { OrderModule } from '../order/order.module';
import { NotificationModule } from '../notification/notification.module';
import { DriverAssignmentService } from './driver-assignment.service';
import { DriverOrderService } from './driver-order.service';
import { DriverGateway } from '../../common/map-gateway/driver.gateway';
import { AuthModule } from '../auth/auth.module';
import { DriverAssignmentProcessor } from './processor/driver-assignment.processor';
import { RatingModule } from '../rating/rating.module';
import { DriverNotificationProcessor } from './processor/driver-notification.processor';
import { DriverOnlineHoursService } from './driver-online-hours-service';
import { WalletService } from '../wallet/wallet.service';
import { DriverEarningsService } from './driver-earnings-service';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'order-events' },
      { name: 'driver-notification' },
      { name: 'driver-assignment' },
    ),
    forwardRef(() => OrderModule),
    forwardRef(() => UserModule),
    forwardRef(() => NotificationModule),
    forwardRef(() => AuthModule),
    forwardRef(() => RatingModule),
    PaymentModule
  ],
  controllers: [DriverController, DriverEarningsController,
    DriverWalletController,],
  providers: [DriverService, DriverAssignmentService, DriverOrderService, DriverGateway, DriverOnlineHoursService, DriverAssignmentProcessor, DriverNotificationProcessor, DriverEarningsService,
    WalletService],
  exports: [DriverService, DriverAssignmentService, DriverOrderService, DriverGateway, DriverOnlineHoursService, DriverEarningsService,
    WalletService],
})
export class DriverModule { }
