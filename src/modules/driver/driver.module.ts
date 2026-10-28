import { forwardRef, Module } from '@nestjs/common';
import { DriverService } from './driver.service';
import { DriverController, DriverEarningsController, DriverWalletController, VehicleTypeController } from './driver.controller';
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
import { QUEUES } from '../../shared/constants';
import { VehicleTypeService } from './vehicle-type.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUES.ORDER_EVENTS },
      { name: QUEUES.DRIVER_NOTIFICATION },
      { name: QUEUES.DRIVER_ASSIGNMENT }
    ),
    forwardRef(() => OrderModule),
    forwardRef(() => UserModule),
    forwardRef(() => NotificationModule),
    forwardRef(() => AuthModule),
    forwardRef(() => RatingModule),
    PaymentModule,
  ],
  controllers: [DriverController, DriverEarningsController,
    DriverWalletController, VehicleTypeController],
  providers: [DriverService, DriverAssignmentService, DriverOrderService, DriverGateway, DriverOnlineHoursService, DriverAssignmentProcessor, DriverNotificationProcessor, DriverEarningsService,
    WalletService, VehicleTypeService],
  exports: [DriverService, DriverAssignmentService, DriverOrderService, DriverGateway, DriverOnlineHoursService, DriverEarningsService,
    WalletService, VehicleTypeService],
})
export class DriverModule { }
