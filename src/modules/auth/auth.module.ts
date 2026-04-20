// eslint-disable-next-line prettier/prettier
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../shared/services/prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../../common/strategies/jwt.strategy';
import { GoogleStrategy } from '../../common/strategies/google.stategy';
import { AuthController } from './auth.controller';
import { GoogleAuthGuard } from '../../common/guards/google-auth.guard';
import { UserModule } from '../user/user.module';
import { VerificationCacheService } from '../verification/verification-cache.service';

@Module({
  imports: [
    ConfigModule,
    UserModule,
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
    PrismaService,
    JwtStrategy,
    GoogleAuthGuard,
    GoogleStrategy,
    VerificationCacheService,
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
