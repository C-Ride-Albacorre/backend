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
  Query,
  ConflictException,
} from '@nestjs/common';
import { Request } from 'express';

import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiConsumes,
  ApiBody,
  ApiConflictResponse,
  ApiQuery,
  ApiOkResponse,
} from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/role.guard';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { Roles } from 'src/common/decorators/role.decorator';
import { UserRole } from 'src/shared/enums';
import { DriverService } from './driver.service';
import { DriverOnboardingDto } from './dto/driver-onboarding.dto';
import { DriverDocumentMetadataDto } from './dto/driver-document-metadata.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { OrderStatus, User } from '@prisma/client';
import { DriverOrderService } from './driver-order.service';
import { DriverAssignmentService } from './driver-assignment.service';
import { UpdateDriverLocationDto } from './dto/update-driver-location.dto';
import { DriverStatusResponseDto } from './dto/driver-status-response.dto';
import { UpdateDriverStatusDto } from './dto/update-driver-status.dto';
import { OrderService } from '../order/order.service';

@ApiTags('Dispatcher')
@Controller('driver')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class DriverController {
  constructor(
    private readonly driverService: DriverService,
    private readonly driverOrderService: DriverOrderService,
    private readonly driverAssignmentService: DriverAssignmentService,
    private readonly orderService: OrderService,
  ) { }

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

    return this.driverService.saveDriverOnboardingStep(driverId, step, dto);
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

    return this.driverService.submitDriverOnboarding(driverId, files, metadata);
  }

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

    return this.driverService.getDriverOnboardingState(driverId);
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
  async getDashboard(@Req() req) {
    const driverId = req.user.id;
    return this.driverService.getDriverDashboard(driverId);
  }

  //////////// DRIVER ASSIGNMENT AND TRACKING ////////////////////

  @Get('available-orders')
  @ApiOperation({
    summary: 'Get available nearby orders for driver',
    description: 'Returns a list of available orders near the driver location.',
  })
  @ApiQuery({
    name: 'lat',
    type: Number,
    required: true,
    example: 6.5244,
    description: 'Driver latitude',
  })
  @ApiQuery({
    name: 'lng',
    type: Number,
    required: true,
    example: 3.3792,
    description: 'Driver longitude',
  })
  @ApiResponse({
    status: 200,
    description: 'Available orders fetched successfully',
  })
  // async getAvailableOrders(
  //   @GetUser() driver: User,
  //   @Query('lat') lat: number,
  //   @Query('lng') lng: number,
  // ) {
  //   return this.driverService.findAvailableOrders(driver.id, lat, lng);
  // }
  async getAvailableOrders(
    @GetUser() driver: User,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    // @Query('radius') radius?: string,
  ) {
    const driverLat = parseFloat(lat);
    const driverLng = parseFloat(lng);
    const radiusKm = 10 // radius ? parseFloat(radius) : 10;

    return this.driverService.findAvailableOrders(
      driver.id,   // Pass driver ID for TTL renewal
      driverLat,
      driverLng,
      radiusKm,
    );

    // return {
    //   status: 'success',
    //   data: orders,
    //   meta: {
    //     count: orders.length,
    //     radiusKm,
    //   }
    // };
  }

  @Get('available-order/:orderId')
  @ApiOperation({
    summary: 'Get available order details',
    description:
      'Returns details of a specific available order for the driver.',
  })
  @ApiParam({
    name: 'orderId',
    type: String,
    example: 'f4d5f8f8-4b98-4a4c-b9d2-6e5a5e1f5d3a',
    description: 'Order ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Order details fetched successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Order not found',
  })
  async getAvailableOrder(
    @GetUser() driver: any,
    @Param('orderId') orderId: string,
  ) {
    return this.driverService.findAvailableOrder(orderId);
  }

  @Post(':orderId/accept')
  @ApiOperation({
    summary: 'Accept an order',
    description: 'Allows a driver to accept an available order.',
  })
  @ApiParam({
    name: 'orderId',
    type: String,
    example: 'clx123abc456',
    description: 'Order ID',
  })
  @ApiResponse({
    status: 201,
    description: 'Order assigned successfully',
    schema: {
      example: {
        message: 'Order assigned to you',
      },
    },
  })
  @ApiConflictResponse({
    description: 'Order already assigned',
  })
  async acceptOrder(
    @Param('orderId') orderId: string,
    @GetUser() driver: User,
  ) {
    const success = await this.driverOrderService.acceptOrder(
      orderId,
      driver.id,
    );

    if (!success) {
      throw new ConflictException('Order already assigned');
    }

    return { message: 'Order assigned to you' };
  }

  @Post(':orderId/decline')
  @ApiOperation({
    summary: 'Decline an order',
    description: 'Allows a driver to decline an order assignment.',
  })
  @ApiParam({
    name: 'orderId',
    type: String,
    example: 'clx123abc456',
    description: 'Order ID',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          example: 'Too far from current location',
        },
      },
      required: ['reason'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Order declined successfully',
    schema: {
      example: {
        message: 'Declined',
      },
    },
  })
  async declineOrder(
    @Param('orderId') orderId: string,
    @Body('reason') reason: string,
    @GetUser() driver: User,
  ) {
    await this.driverService.declineOrder(orderId, driver.id, reason);

    return { message: 'Declined' };
  }

  @Post(':orderId/pickup')
  @ApiOperation({
    summary: 'Confirm order pickup',
    description: 'Allows the assigned driver to confirm pickup of the order.',
  })
  @ApiParam({
    name: 'orderId',
    type: String,
    example: 'clx123abc456',
    description: 'Order ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Order pickup confirmed successfully',
  })
  async pickupOrder(
    @Param('orderId') orderId: string,
    @GetUser() driver: User,
  ) {
    return this.driverOrderService.confirmPickup(orderId, driver.id);
  }

  @Post(':orderId/deliver')
  @ApiOperation({
    summary: 'Confirm order delivery',
    description: 'Allows the assigned driver to confirm successful delivery.',
  })
  @ApiParam({
    name: 'orderId',
    type: String,
    example: 'clx123abc456',
    description: 'Order ID',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        orderCode: {
          type: 'string',
          example: 'ORD123456',
          description: 'Order code provided to the customer for verification',
        },
      },
      required: ['orderCode'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Order delivered successfully',
  })
  async deliverOrder(
    @Param('orderId') orderId: string,
    @Body('orderCode') orderCode: string,
    @GetUser() driver: User,
  ) {
    return this.driverService.confirmDelivery(orderId, driver.id, orderCode);
  }


  // @Get('by-code/:code')
  // @ApiOperation({ summary: 'Get order details by confirmation code', description: 'Returns full order details for the driver assigned to this order.' })
  // @ApiParam({ name: 'code', type: String, example: 'ORD-123456' })
  // @ApiResponse({ status: 200, description: 'Order details retrieved' })
  // async getOrderByCode(
  //   @Param('code') code: string,
  //   @GetUser() driver: User,
  // ) {
  //   return this.driverService.getOrderDetailsByCode(code, driver.id);
  // }


  @Post('location')
  @ApiOperation({
    summary: 'Update driver location',
    description:
      'Stores the latest driver location in Redis and broadcasts it to the customer via WebSocket.',
  })
  @ApiBody({
    type: UpdateDriverLocationDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Driver location updated successfully',
    schema: {
      example: {
        success: true,
      },
    },
  })
  async updateLocation(
    @Body() dto: UpdateDriverLocationDto,
  ) {
    await this.driverAssignmentService.updateDriverLocation(
      dto.driverId,
      dto.orderId,
      dto.lat,
      dto.lng,
      dto.heading,
    );

    return { success: true };
  }

  @Post('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set driver online/offline status' })
  @ApiResponse({
    status: 200,
    description: 'Driver status updated successfully',
    type: DriverStatusResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid status transition (e.g., offline while busy)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateStatus(
    @Req() req,
    @Body() dto: UpdateDriverStatusDto,
  ): Promise<DriverStatusResponseDto> {
    const driverId = req.user.id; // assuming JWT payload contains user id
    await this.driverAssignmentService.updateDriverStatus(driverId, dto.status);

    return {
      driverId,
      status: dto.status,
      message: `Driver status updated to ${dto.status}`,
    };
  }

  @Get('tracking')
  @ApiOperation({
    summary: 'Get tracking data for the current user',
    description: 'Retrieve tracking information for the authenticated user active order.',
  })
  @ApiOkResponse({
    description: 'Tracking data retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'No active order found',
  })
  @ApiBearerAuth()
  async getTracking(@Req() req) {
    const driverId = req.user.id;
    return this.orderService.getTrackingData(driverId);
  }


  // @Get(':orderId/tracking')
  // @ApiOperation({
  //   summary: 'Get tracking data for an order',
  //   description: 'Retrieve tracking information for a specific order.',
  // })
  // @ApiParam({
  //   name: 'orderId',
  //   type: String,
  //   description: 'Order ID',
  //   example: 'clx123abc456',
  // })
  // @ApiOkResponse({
  //   description: 'Tracking data retrieved successfully',
  // })
  // @ApiResponse({
  //   status: 404,
  //   description: 'Order not found',
  // })
  // @ApiResponse({
  //   status: 403,
  //   description: 'Forbidden - User is not a vendor',
  // })
  // @ApiResponse({
  //   status: 500,
  //   description: 'Internal server error',
  // })
  // async getTrackingDataWithOrderId(@Param('orderId') orderId: string) {
  //   return this.orderService.getTrackingDataWithOrderId(orderId);
  // }


@Get('history')
@Roles(UserRole.DISPATCHER)
async getDriverOrderHistory(
  @GetUser() user: any,
  @Query('status') status?: OrderStatus,
  @Query('page') page = 1,
  @Query('limit') limit = 20,
) {
  const driverId = user.id; 
  return this.orderService.getDriverOrderHistory(driverId, {
    status,
    page: Number(page),
    limit: Number(limit),
  });
}



@Get('history/:orderId')
@Roles(UserRole.DISPATCHER)
async getDriverHistoryDetails(
  @GetUser() user: any,
  @Param('orderId') orderId: string,

) {
  const driverId = user.id; 
  return this.orderService.getDriverHistoryDetails(driverId, orderId);
}


}
