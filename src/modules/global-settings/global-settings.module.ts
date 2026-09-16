import { Module } from '@nestjs/common';
import { GlobalSettingsService } from './global-settings.service';
import { GlobalSettingsController } from './global-settings.controller';

@Module({
  controllers: [GlobalSettingsController],
  providers: [GlobalSettingsService],
})
export class GlobalSettingsModule {}
