import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
// import { PrismaService } from './shared/services/prisma.service';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
// import { MenusModule } from './modules/menu/menus.module';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { JwtStrategy } from './common/strategies/jwt.strategy';
// import { VerificationModule } from './modules/verification/verification.module';
import { RedisModule } from './modules/redis/redis.module';
import { StoreModule } from './modules/store/store.module';
import { ProductModule } from './modules/product/product.module';
import { AdminModule } from './modules/admin/admin.module';
import { CustomerModule } from './modules/customer/customer.module';
import { PaymentModule } from './modules/payment/payment.module';
import { OrderModule } from './modules/order/order.module';

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
    SharedModule,
    AuthModule,
    UserModule,
    // MenusModule,
    HealthModule,
    // RedisModule,
    StoreModule,
    ProductModule,
    AdminModule,
    CustomerModule,
    PaymentModule,
    OrderModule,
    // VerificationModule,
  ],
  controllers: [AppController],
  providers: [AppService, JwtStrategy],
  // exports: [PrismaService],
})
export class AppModule {}
