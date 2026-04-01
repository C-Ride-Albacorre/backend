// src/drivers/driver.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/role.guard';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { Roles } from 'src/common/decorators/role.decorator';
import { UserRole } from 'src/shared/enums';
import { DriverService } from './driver.service';
import { DriverStep1Dto } from './dto/step1-driver.dto';
import { DriverStep2Dto } from './dto/step2-driver.dto';
import { DriverStep4Dto } from './dto/step4-driver.dto';

@ApiTags('driver')
@Controller('driver')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class DriverController {
  constructor(private readonly driverOnboardingService: DriverService) {}

  /**
   * ================================
   * ONBOARDING STEP ENDPOINTS
   * ================================
   */

  @Post('/onboarding/step1')
  @Roles(UserRole.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 1: Personal Information' })
  @ApiResponse({ status: 200, description: 'Step 1 completed successfully' })
  async saveStep1(@Request() req, @Body() dto: DriverStep1Dto) {
    const driverId = req.user.id;
    return this.driverOnboardingService.saveStep1(driverId, dto);
  }

  @Post('/onboarding/step2')
  @Roles(UserRole.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 2: Vehicle Information' })
  @ApiResponse({ status: 200, description: 'Step 2 completed successfully' })
  async saveStep2(@Request() req, @Body() dto: DriverStep2Dto) {
    const driverId = req.user.id;
    return this.driverOnboardingService.saveStep2(driverId, dto);
  }

  @Post('/onboarding/step3')
  @Roles(UserRole.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'driverLicense', maxCount: 1 },
      { name: 'vehicleInsurance', maxCount: 1 },
      { name: 'vehicleRegistration', maxCount: 1 },
    ]),
  )
  @ApiOperation({ summary: 'Step 3: Document Uploads' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        driverLicense: {
          type: 'string',
          format: 'binary',
          description: 'Driver license image (PDF, JPG, PNG)',
        },
        vehicleInsurance: {
          type: 'string',
          format: 'binary',
          description: 'Vehicle insurance document',
        },
        vehicleRegistration: {
          type: 'string',
          format: 'binary',
          description: 'Vehicle registration document',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Step 3 completed successfully' })
  async saveStep3(
    @Request() req,
    @UploadedFiles()
    files: {
      driverLicense?: Express.Multer.File[];
      vehicleInsurance?: Express.Multer.File[];
      vehicleRegistration?: Express.Multer.File[];
    },
  ) {
    const driverId = req.user.id;

    // Validate at least one file is uploaded
    if (
      !files.driverLicense &&
      !files.vehicleInsurance &&
      !files.vehicleRegistration
    ) {
      throw new BadRequestException('At least one document must be uploaded');
    }

    return this.driverOnboardingService.saveStep3(driverId, files);
  }

  @Post('/onboarding/step4')
  @Roles(UserRole.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 4: Review and Submit' })
  @ApiResponse({
    status: 200,
    description: 'Onboarding completed successfully',
  })
  async saveStep4(@Request() req, @Body() dto: DriverStep4Dto) {
    const driverId = req.user.id;
    return this.driverOnboardingService.saveStep4(driverId, dto);
  }

  /**
   * ================================
   * GET ONBOARDING STATE
   * ================================
   */
  @Get('/onboarding/state')
  @Roles(UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Get current driver onboarding state' })
  @ApiResponse({ status: 200, description: 'Onboarding state retrieved' })
  async getOnboardingState(@Request() req) {
    const driverId = req.user.id;
    return this.driverOnboardingService.getOnboardingState(driverId);
  }

  /**
   * ================================
   * DISPATCHER DASHBOARD (After Approval)
   * ================================
   */
  @Get('/dashboard')
  @Roles(UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Get driver dashboard' })
  @ApiResponse({ status: 200, description: 'Dashboard data retrieved' })
  async getDashboard(@Request() req) {
    const driverId = req.user.id;
    return this.driverOnboardingService.getDriverDashboard(driverId);
  }
}
