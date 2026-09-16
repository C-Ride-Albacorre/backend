import { Controller, Get, Post, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CreateGlobalSettingsDto } from './dto/create-settings.dto';
import { UpdateGlobalSettingsDto } from './dto/update-settings.dto';
import { GlobalSettingsService } from './global-settings.service';
import { Roles } from '../../common/decorators/role.decorator';
import { RolesGuard } from '../../common/guards/role.guard';
import { UserRole } from '../../shared/enums';
import { JwtAuthGuard } from '../../common/guards/auth.guard';



@ApiTags('Global Settings')
@Controller('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class GlobalSettingsController {
  constructor(private readonly settingsService: GlobalSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get global site settings' })
  @ApiResponse({ status: 200, description: 'Returns the global system preferences.' })
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Post()
  @ApiOperation({ summary: 'Initialize global settings (Create)' })
  @ApiResponse({ status: 201, description: 'Settings successfully initialized.' })
  createSettings(@Body() createDto: CreateGlobalSettingsDto) {
    return this.settingsService.saveSettings(createDto);
  }

  @Patch()
  @ApiOperation({ summary: 'Update global settings' })
  @ApiResponse({ status: 200, description: 'Settings successfully updated.' })
  updateSettings(@Body() updateDto: UpdateGlobalSettingsDto) {
    return this.settingsService.saveSettings(updateDto);
  }
}