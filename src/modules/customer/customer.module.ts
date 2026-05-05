// src/customer/customer.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { StoreModule } from '../store/store.module';
import { OrderModule } from '../order/order.module';
import { PaymentModule } from '../payment/payment.module';
import { CartService } from '../cart/cart.service';

@Module({
  imports: [StoreModule, forwardRef(() => OrderModule), PaymentModule],
  controllers: [CustomerController],
  providers: [CustomerService, CartService],
  exports: [CartService, CustomerService], // ✅ export CartService
})
export class CustomerModule {}
