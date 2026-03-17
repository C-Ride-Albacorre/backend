// src/order/order.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { CustomerModule } from '../customer/customer.module';

@Module({
  imports: [
    forwardRef(() => CustomerModule), // ✅ handle circular dependency
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
