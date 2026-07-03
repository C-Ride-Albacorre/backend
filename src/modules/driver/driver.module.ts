import { forwardRef, Module } from '@nestjs/common';
import { DriverService } from './driver.service';
import { DriverController } from './driver.controller';
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
  ],
  controllers: [DriverController],
  providers: [DriverService, DriverAssignmentService, DriverOrderService, DriverGateway, DriverAssignmentProcessor],
  exports: [DriverService, DriverAssignmentService, DriverOrderService, DriverGateway],
})
export class DriverModule {}
