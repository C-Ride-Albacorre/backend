import {
  Body,
  Controller,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';

import { PushNotificationService } from './push-notification.service';
import { RegisterDeviceDto } from './dto/register.dto';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../../common/guards/auth.guard';

@Controller('notification')
@ApiTags('notification')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly pushService: PushNotificationService,
  ) { }


  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('device/register')
  @ApiOperation({
    summary: 'Register FCM token for push notifications',
  })
  @ApiBody({
    description: 'Device token payload',
    type: RegisterDeviceDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Device token registered successfully',
  })
  async registerToken(
    @Req() req,
    @Body() body: RegisterDeviceDto,
  ) {
    return this.pushService.registerToken(
      req.user.id,
      body.token,
      body.deviceType,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('device/unregister')
  @ApiOperation({
    summary: 'Remove FCM token (logout or uninstall)',
  })
  @ApiResponse({
    status: 201,
    description: 'Device token removed successfully',
  })
  async unregisterToken(@Req() req) {
    return this.pushService.unregisterToken(req.user.id);
  }
}

