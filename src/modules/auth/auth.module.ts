// eslint-disable-next-line prettier/prettier
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../../common/strategies/jwt.strategy';
import { GoogleStrategy } from '../../common/strategies/google.stategy';
import { AuthController } from './auth.controller';
import { GoogleAuthGuard } from '../../common/guards/google-auth.guard';
import { UserModule } from '../user/user.module';
import { VerificationCacheService } from '../verification/verification-cache.service';
import { CartModule } from '../cart/cart.module';

@Module({
  imports: [
    ConfigModule,
    UserModule,
    CartModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get('JWT_SECRET'),
        signOptions: { expiresIn: cfg.get('JWT_EXPIRES_IN') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],

  providers: [
    AuthService,
    JwtStrategy,
    GoogleAuthGuard,
    GoogleStrategy,
    VerificationCacheService,
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
