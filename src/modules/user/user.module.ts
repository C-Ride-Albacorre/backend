import { forwardRef, Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaService } from '../../shared/services/prisma.service';
import { AbstractUserRepository } from './repositories/abstract-user.repository';
import { PrismaUserRepository } from './repositories/prisma-user.repository';
import { VerificationService } from '../verification/verification.service';
import { VerificationCacheService } from '../verification/verification-cache.service';
import {
  ConsoleEmailProvider,
  ConsoleSmsProvider,
} from '../verification/providers/console.provider';
import { ZohoEmailProvider } from '../verification/providers/zoho-email.provider';
import { TermiiSmsProvider } from '../verification/providers/termii-sms.provider';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { CustomerModule } from '../customer/customer.module';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    CustomerModule,
  ],
  controllers: [UserController],
  providers: [
    UserService,
    PrismaService,
    VerificationService,
    VerificationCacheService,
    ZohoEmailProvider,
    TermiiSmsProvider,
    ConsoleEmailProvider,
    ConsoleSmsProvider,
    AuthService,
    {
      provide: AbstractUserRepository,
      useClass: PrismaUserRepository,
    },
  ],
  exports: [
    UserService,
    VerificationService,
    AbstractUserRepository,
    AuthService,
    ZohoEmailProvider,
  ],
})
export class UserModule {}
