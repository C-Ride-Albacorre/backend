import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from '../../modules/user/user.service';
import { PrismaService } from '../../shared/services/prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../../common/strategies/jwt.strategy';
// import { LocalStrategy } from './local.strategy';
import { GoogleStrategy } from '../../common/strategies/google.strategy';
import { AuthController } from './auth.controller';
import { MailGunService } from '../../shared/services/mailgun.service';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get('JWT_SECRET'),
        signOptions: { expiresIn: cfg.get('JWT_EXPIRES_IN') || '3600s' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UserService,
    PrismaService,
    JwtStrategy,
    // LocalStrategy,
    GoogleStrategy,
    MailGunService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
