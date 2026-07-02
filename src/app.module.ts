import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { JwtStrategy } from './common/strategies/jwt.strategy';
import { StoreModule } from './modules/store/store.module';
import { ProductModule } from './modules/product/product.module';
import { AdminModule } from './modules/admin/admin.module';
import { CustomerModule } from './modules/customer/customer.module';
import { PaymentModule } from './modules/payment/payment.module';
import { OrderModule } from './modules/order/order.module';
import { GeocodeModule } from './geocode/geocode.module';
import { QueueModule } from './queue/queue.module';
import { DriverModule } from './modules/driver/driver.module';
import { CartModule } from './modules/cart/cart.module';
import { NotificationModule } from './modules/notification/notification.module';
import { BullModule } from '@nestjs/bullmq';
import { ChatModule } from './modules/chat/chat.module';
import { RatingModule } from './modules/rating/rating.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: (() => {
        switch (process.env.NODE_ENV) {
          case 'production':
            return '.env.production';
          case 'staging':
            return '.env.staging';
          default:
            return '.env';
        }
      })(),
    }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL,
      },
    }),

    SharedModule,
    AuthModule,
    UserModule,
    HealthModule,
    StoreModule,
    ProductModule,
    AdminModule,
    CustomerModule,
    PaymentModule,
    OrderModule,
    GeocodeModule,
    QueueModule,
    DriverModule,
    CartModule,
    NotificationModule,
    ChatModule,
    RatingModule,
  ],
  controllers: [AppController],
  providers: [AppService, JwtStrategy],
})
export class AppModule {}
