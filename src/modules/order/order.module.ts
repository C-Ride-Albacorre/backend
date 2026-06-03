// src/order/order.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { CustomerModule } from '../customer/customer.module';
import { BullModule } from '@nestjs/bullmq';
import { RedisModule } from '../redis/redis.module';
import { VendorNotificationGateway } from 'src/common/map-gateway/vendor-notification.gateway';
import { DriverModule } from '../driver/driver.module';
import { NotificationModule } from '../notification/notification.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [
    RedisModule,
    BullModule.registerQueue(
      { name: 'order-events' },
      { name: 'notification' },
      { name: 'assignment' },
    ),
    forwardRef(() => CustomerModule), // ✅ handle circular dependency
    forwardRef(() => DriverModule), // ✅ REQUIRED
    forwardRef(() => PaymentModule),
    NotificationModule,
  ],
  controllers: [OrderController],
  providers: [OrderService, VendorNotificationGateway],
  exports: [OrderService],
})
export class OrderModule { }
