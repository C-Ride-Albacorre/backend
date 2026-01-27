import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './shared/services/prisma.service';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { MenusModule } from './modules/menu/menus.module';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { JwtStrategy } from './common/strategies/jwt.strategy';
// import { VerificationModule } from './modules/verification/verification.module';
import { RedisModule } from './modules/redis/redis.module';

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
    MenusModule,
    HealthModule,
    RedisModule,
    // VerificationModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService, JwtStrategy,
],
  exports: [PrismaService],
})
export class AppModule {}
