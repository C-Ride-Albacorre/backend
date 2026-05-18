// src/drivers/driver.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  Req,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { Request } from 'express';

import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  // ApiConsumes,
  // ApiBody,
  ApiResponse,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/role.guard';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { Roles } from 'src/common/decorators/role.decorator';
import { UserRole } from 'src/shared/enums';
import { DriverService } from './driver.service';
// import { DriverStep1Dto } from './dto/step1-driver.dto';
// import { DriverStep2Dto } from './dto/step2-driver.dto';
// import { DriverStep4Dto } from './dto/step4-driver.dto';
import { DriverOnboardingDto } from './dto/driver-onboarding.dto';
import { DriverDocumentMetadataDto } from './dto/driver-document-metadata.dto';

@ApiTags('driver')
@Controller('driver')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class DriverController {
  constructor(private readonly driverOnboardingService: DriverService) {}

  // /**
  //  * ================================
  //  * ONBOARDING STEP ENDPOINTS
  //  * ================================
  //  */

  // @Post('/onboarding/:step')
  // @HttpCode(HttpStatus.OK)
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles(UserRole.DISPATCHER)
  // @ApiBearerAuth()
  // async saveDriverOnboardingStep(
  //   @Param('step', ParseIntPipe) step: number,
  //   @Body() dto: Partial<DriverOnboardingDto>,
  //   @Req() req: Request,
  // ) {
  //   const driverId = (req.user as any).id;

  //   if (step < 1 || step > 2) {
  //     throw new BadRequestException('Step must be between 1 and 2');
  //   }

  //   return this.driverOnboardingService.saveDriverOnboardingStep(
  //     driverId,
  //     step,
  //     dto,
  //   );
  // }

  // @Post('/onboarding/submit')
  // @HttpCode(HttpStatus.OK)
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles(UserRole.DISPATCHER)
  // @ApiBearerAuth()
  // @UseInterceptors(FilesInterceptor('documents', 5))
  // async submitDriverOnboarding(
  //   @UploadedFiles() files: Express.Multer.File[],
  //   @Req() req: Request,
  // ) {
  //   const driverId = (req.user as any).id;

  //   return this.driverOnboardingService.submitDriverOnboarding(driverId, files);
  // }

  // ================================
  // DRIVER ONBOARDING CONTROLLER
  // ================================

  @Post('/driver/onboarding/:step')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DISPATCHER)
  @ApiOperation({
    summary: 'Save driver onboarding step (1–2)',
    description:
      'Saves onboarding progress for the specified step. Steps must be completed sequentially.',
  })
  @ApiParam({
    name: 'step',
    type: Number,
    example: 1,
    description: 'Onboarding step number (1–2)',
  })
  @ApiResponse({
    status: 200,
    description: 'Step saved successfully',
  })
  @ApiBody({
    description: `
STEP 1 – Personal Information
--------------------------------
{
  "fullName": "John Doe",
  "phoneNumber": "+2348012345678",
  "email": "john@example.com",
  "address": "123 Main St",
  "city": "Lagos",
  "state": "Lagos"
}

STEP 2 – Vehicle Information
--------------------------------
{
  "vehicleType": "CAR",
  "vehicleMake": "Toyota",
  "vehicleModel": "Corolla",
  "year": 2020,
  "licensePlate": "ABC123XY"
}

STEP 3 – Final Step: Review (Optional save before uploads)
--------------------------------
{
  "notes": "Any additional info or review comments"
}
`,
    schema: {
      type: 'object',
      properties: {
        // STEP 1
        // fullName: { type: 'string' },
        // phoneNumber: { type: 'string' },
        // email: { type: 'string' },
        address: { type: 'string' },
        city: { type: 'string' },
        state: { type: 'string' },

        // STEP 2
        vehicleType: { type: 'string', enum: ['EV', 'CAR'] },
        vehicleMake: { type: 'string' },
        vehicleModel: { type: 'string' },
        year: { type: 'integer' },
        licensePlate: { type: 'string' },

        // STEP 3 optional notes
        notes: { type: 'string' },
      },
    },
  })
  async saveDriverOnboardingStep(
    @Param('step', ParseIntPipe) step: number,
    @Body() dto: Partial<DriverOnboardingDto>,
    @Req() req: Request,
  ) {
    const driverId = (req.user as any).id;

    if (step < 1 || step > 2) {
      throw new BadRequestException('Step must be between 1 and 2');
    }

    return this.driverOnboardingService.saveDriverOnboardingStep(
      driverId,
      step,
      dto,
    );
  }
  // ================================
  // DRIVER DOCUMENT UPLOAD (STEP 3)
  // ================================
  @Post('/onboarding/submit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DISPATCHER)
  @ApiOperation({
    summary: 'Submit final driver onboarding (Step 3 - Upload Documents)',
    description:
      'Uploads required driver documents (license, insurance, registration) and submits for admin review.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('documents', 10))
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        documentsMetadata: {
          type: 'string',
          description:
            'JSON string array describing each uploaded document. Example: [{"documentType":"DRIVER_LICENSE","description":"Driver license"}]',
          example:
            '[{"documentType":"DRIVER_LICENSE","description":"Driver license"},{"documentType":"VEHICLE_INSURANCE","description":"Vehicle insurance"}]',
        },
        documents: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Driver document files',
        },
      },
      required: ['documentsMetadata', 'documents'],
    },
  })
  async submitDriverOnboarding(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('documentsMetadata') documentsMetadataRaw: string,
    @Req() req: Request,
  ) {
    const driverId = (req.user as any).id;

    let metadata: DriverDocumentMetadataDto[];

    try {
      metadata = JSON.parse(documentsMetadataRaw);
    } catch (error) {
      throw new BadRequestException('Invalid documentsMetadata JSON format');
    }

    return this.driverOnboardingService.submitDriverOnboarding(
      driverId,
      files,
      metadata,
    );
  }
  // async submitDriverOnboarding(
  //   @UploadedFiles() files: Express.Multer.File[],
  //   @Req() req: Request,
  // ) {
  //   const driverId = (req.user as any).id;

  //   return this.driverOnboardingService.submitDriverOnboarding(driverId, files);
  // }

  @Get('/onboarding/state')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current driver onboarding state',
    description:
      'Returns onboardingStatus, onboardingStep, and account status for redirect logic.',
  })
  @ApiResponse({
    status: 200,
    description: 'Onboarding state retrieved successfully',
  })
  async getDriverOnboardingState(@Req() req: Request) {
    const driverId = (req.user as any).id;

    return this.driverOnboardingService.getDriverOnboardingState(driverId);
  }
  ////////////////////////////////////

  // @Post('/onboarding/step1')
  // @Roles(UserRole.DISPATCHER)
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Step 1: Personal Information' })
  // @ApiResponse({ status: 200, description: 'Step 1 completed successfully' })
  // async saveStep1(@Req() req, @Body() dto: DriverStep1Dto) {
  //   const driverId = req.user.id;
  //   return this.driverOnboardingService.saveStep1(driverId, dto);
  // }

  // @Post('/onboarding/step2')
  // @Roles(UserRole.DISPATCHER)
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Step 2: Vehicle Information' })
  // @ApiResponse({ status: 200, description: 'Step 2 completed successfully' })
  // async saveStep2(@Req() req, @Body() dto: DriverStep2Dto) {
  //   const driverId = req.user.id;
  //   return this.driverOnboardingService.saveStep2(driverId, dto);
  // }

  // @Post('/onboarding/step3')
  // @Roles(UserRole.DISPATCHER)
  // @HttpCode(HttpStatus.OK)
  // @ApiConsumes('multipart/form-data')
  // @UseInterceptors(
  //   FileFieldsInterceptor([
  //     { name: 'driverLicense', maxCount: 1 },
  //     { name: 'vehicleInsurance', maxCount: 1 },
  //     { name: 'vehicleRegistration', maxCount: 1 },
  //   ]),
  // )
  // @ApiOperation({ summary: 'Step 3: Document Uploads' })
  // @ApiBody({
  //   schema: {
  //     type: 'object',
  //     properties: {
  //       driverLicense: {
  //         type: 'string',
  //         format: 'binary',
  //         description: 'Driver license image (PDF, JPG, PNG)',
  //       },
  //       vehicleInsurance: {
  //         type: 'string',
  //         format: 'binary',
  //         description: 'Vehicle insurance document',
  //       },
  //       vehicleRegistration: {
  //         type: 'string',
  //         format: 'binary',
  //         description: 'Vehicle registration document',
  //       },
  //     },
  //   },
  // })
  // @ApiResponse({ status: 200, description: 'Step 3 completed successfully' })
  // async saveStep3(
  //   @Req() req,
  //   @UploadedFiles()
  //   files: {
  //     driverLicense?: Express.Multer.File[];
  //     vehicleInsurance?: Express.Multer.File[];
  //     vehicleRegistration?: Express.Multer.File[];
  //   },
  // ) {
  //   const driverId = req.user.id;

  //   // Validate at least one file is uploaded
  //   if (
  //     !files.driverLicense &&
  //     !files.vehicleInsurance &&
  //     !files.vehicleRegistration
  //   ) {
  //     throw new BadRequestException('At least one document must be uploaded');
  //   }

  //   return this.driverOnboardingService.saveStep3(driverId, files);
  // }

  // @Post('/onboarding/step4')
  // @Roles(UserRole.DISPATCHER)
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Step 4: Review and Submit' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Onboarding completed successfully',
  // })
  // async saveStep4(@Req() req, @Body() dto: DriverStep4Dto) {
  //   const driverId = req.user.id;
  //   return this.driverOnboardingService.saveStep4(driverId, dto);
  // }

  /**
   * ================================
   * GET ONBOARDING STATE
   * ================================
   */
  // @Get('/onboarding/state')
  // @Roles(UserRole.DISPATCHER)
  // @ApiOperation({ summary: 'Get current driver onboarding state' })
  // @ApiResponse({ status: 200, description: 'Onboarding state retrieved' })
  // async getOnboardingState(@Req() req) {
  //   const driverId = req.user.id;
  //   return this.driverOnboardingService.getOnboardingState(driverId);
  // }

  /**
   * ================================
   * DISPATCHER DASHBOARD (After Approval)
   * ================================
   */
  @Get('/dashboard')
  @Roles(UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Get driver dashboard' })
  @ApiResponse({ status: 200, description: 'Dashboard data retrieved' })
  async getDashboard(@Req() req) {
    const driverId = req.user.id;
    return this.driverOnboardingService.getDriverDashboard(driverId);
  }
}
