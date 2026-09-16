// import { Injectable } from '@nestjs/common';

// @Injectable()
// export class GlobalSettingsService {}
import { Injectable } from '@nestjs/common';
import { CreateGlobalSettingsDto } from './dto/create-settings.dto';
import { UpdateGlobalSettingsDto } from './dto/update-settings.dto';
import { PrismaService } from '../../shared/services/prisma.service';

@Injectable()
export class GlobalSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // Upsert handles both Create and Update gracefully for global settings
  async saveSettings(dto: CreateGlobalSettingsDto | UpdateGlobalSettingsDto) {
    return this.prisma.globalSetting.upsert({
      where: { id: 'global' },
      update: dto,
      create: {
        id: 'global',
        timezone: dto.timezone || 'UTC',
        currency: dto.currency || 'USD',
        defaultLanguage: dto.defaultLanguage || 'English',
        dateFormat: dto.dateFormat || 'DD/MM/YYYY',
        taxRate: dto.taxRate ?? 0,
        supportEmail: dto.supportEmail || 'support@example.com',
        supportPhone: dto.supportPhone || '+1 000 000 0000',
        openingTime: dto.openingTime || '08:00 AM',
        closingTime: dto.closingTime || '05:00 PM',
      },
    });
  }

  async getSettings() {
    const settings = await this.prisma.globalSetting.findUnique({
      where: { id: 'global' },
    });

    // Return empty or default structure if not yet initialized
    if (!settings) {
      return {
        timezone: 'Africa/Lagos (WAT)',
        currency: 'Nigerian Naira (₦)',
        defaultLanguage: 'English',
        dateFormat: 'DD/MM/YYYY',
        taxRate: 7.5,
        supportEmail: 'support@c-ride.co',
        supportPhone: '+234 800 000 0000',
        openingTime: '08:00 AM',
        closingTime: '10:00 PM',
        isNew: true,
      };
    }

    return settings;
  }
}