import { Module } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VerificationController } from './verification.controller';
import { ZohoEmailProvider } from './providers/zoho-email.provider';
import { TermiiSmsProvider } from './providers/termii-sms.provider';
import {
  ConsoleEmailProvider,
  ConsoleSmsProvider,
} from './providers/console.provider';
import { VerificationCacheService } from './verification-cache.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule], // for ConfigService
  controllers: [VerificationController],
  providers: [
    VerificationService,
    VerificationCacheService,
    ZohoEmailProvider,
    TermiiSmsProvider,
    ConsoleEmailProvider,
    ConsoleSmsProvider,
  ],
  exports: [
    VerificationService,
    VerificationCacheService,
    ZohoEmailProvider,
    TermiiSmsProvider,
    ConsoleEmailProvider,
    ConsoleSmsProvider,
  ],
})
export class VerificationModule {}
