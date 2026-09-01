// import { Controller } from '@nestjs/common';
// import { WaitlistService } from './waitlist.service';

// @Controller('waitlist')
// export class WaitlistController {
//   constructor(private readonly waitlistService: WaitlistService) { }
// }
// src/waitlist/waitlist.controller.ts
import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiCreatedResponse, ApiBadRequestResponse } from '@nestjs/swagger';
import { WaitlistService } from './waitlist.service';
import { CreateVendorWaitlistDto } from './dto/create-vendor-waitlist.dto';
import { CreateDriverWaitlistDto } from './dto/create-driver-waitlist.dto';

@ApiTags('Waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Post('vendor')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a vendor to the waitlist' })
  @ApiCreatedResponse({ description: 'Vendor successfully added to waitlist.' })
  @ApiBadRequestResponse({ description: 'Invalid input data.' })
  async addVendor(@Body() dto: CreateVendorWaitlistDto) {
    return this.waitlistService.addVendor(dto);
  }

  @Post('driver')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a driver to the waitlist' })
  @ApiCreatedResponse({ description: 'Driver successfully added to waitlist.' })
  @ApiBadRequestResponse({ description: 'Invalid input data.' })
  async addDriver(@Body() dto: CreateDriverWaitlistDto) {
    return this.waitlistService.addDriver(dto);
  }
}