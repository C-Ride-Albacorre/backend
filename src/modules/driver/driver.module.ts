import { forwardRef, Module } from '@nestjs/common';
import { DriverService } from './driver.service';
import { DriverController } from './driver.controller';
import { UserModule } from '../user/user.module';
import { BullModule } from '@nestjs/bullmq';
import { OrderModule } from '../order/order.module';
import { NotificationModule } from '../notification/notification.module';
import { DriverAssignmentService } from './driver-assignment.service';
import { DriverOrderService } from './driver-order.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'order-events' },
      { name: 'driver-notification' },
      { name: 'driver-assignment' },
    ),
    forwardRef(() => OrderModule),
    forwardRef(() => UserModule),
    NotificationModule,
  ],
  controllers: [DriverController],
  providers: [DriverService, DriverAssignmentService, DriverOrderService],
  exports: [DriverService, DriverAssignmentService, DriverOrderService],
})
export class DriverModule {}
