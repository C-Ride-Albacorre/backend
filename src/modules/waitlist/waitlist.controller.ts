// import { Controller } from '@nestjs/common';
// import { WaitlistService } from './waitlist.service';

// @Controller('waitlist')
// export class WaitlistController {
//   constructor(private readonly waitlistService: WaitlistService) { }
// }
// src/waitlist/waitlist.controller.ts
import {
  Body,
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  Get,
  Query,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiNotFoundResponse,
  getSchemaPath,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WaitlistService } from './waitlist.service';
import { CreateVendorWaitlistDto } from './dto/create-vendor-waitlist.dto';
import { CreateDriverWaitlistDto } from './dto/create-driver-waitlist.dto';
import { CreateCustomerWaitlistDto } from './dto/create-customer-waitlist.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { VendorWaitlistResponseDto } from './dto/vendor-waitlist-response.dto';
import { CustomerWaitlistResponseDto } from './dto/customer-waitlist-response.dto';
import { WaitlistStatsResponseDto } from './dto/waitlist-stats-response.dto';
import { DriverWaitlistResponseDto } from './dto/driver-waitlist-response.dto';
import { Roles } from '../../common/decorators/role.decorator';
import { RolesGuard } from '../../common/guards/role.guard';
import { UserRole } from '../../shared/enums';
import { JwtAuthGuard } from '../../common/guards/auth.guard';


@ApiTags('Waitlist')
@Controller('waitlist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) { }

  @Post('vendor')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a vendor to the waitlist' })
  @ApiCreatedResponse({ description: 'Vendor successfully added to waitlist.' })
  @ApiBadRequestResponse({ description: 'Invalid input data.' })
  async addVendor(@Body() dto: CreateVendorWaitlistDto) {
    return this.waitlistService.addVendor(dto);
  }


  @Get('vendor')
  @ApiOperation({ summary: 'Get all vendors on the waitlist (paginated)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by vendor name, email, phone, or business name' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10, description: 'Number of records per page' })
  @ApiOkResponse({
    description: 'Paginated list of vendors.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(VendorWaitlistResponseDto) } },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 100 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 10 },
            totalPages: { type: 'number', example: 10 },
          },
        },
      },
    },
  })
  async getVendors(@Query() pagination: PaginationQueryDto) {
    return this.waitlistService.getVendors(pagination);
  }

  @Get('vendor/:id')
  @ApiOperation({ summary: 'Get a vendor by ID' })
  @ApiParam({ name: 'id', description: 'Vendor UUID' })
  @ApiOkResponse({ description: 'Vendor found.', type: VendorWaitlistResponseDto })
  @ApiNotFoundResponse({ description: 'Vendor not found.' })
  async getVendorById(@Param('id', ParseUUIDPipe) id: string) {
    return this.waitlistService.getVendorById(id);
  }

  @Post('driver')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a driver to the waitlist' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by driver name, email, or phone number' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10, description: 'Number of records per page' })
  @ApiCreatedResponse({ description: 'Driver successfully added to waitlist.' })
  @ApiBadRequestResponse({ description: 'Invalid input data.' })
  async addDriver(@Body() dto: CreateDriverWaitlistDto) {
    return this.waitlistService.addDriver(dto);
  }


  @Get('driver')
  @ApiOperation({ summary: 'Get all drivers on the waitlist (paginated)' })
  @ApiOkResponse({
    description: 'Paginated list of drivers.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(DriverWaitlistResponseDto) } },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 50 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 10 },
            totalPages: { type: 'number', example: 5 },
          },
        },
      },
    },
  })
  async getDrivers(@Query() pagination: PaginationQueryDto) {
    return this.waitlistService.getDrivers(pagination);
  }

  @Get('driver/:id')
  @ApiOperation({ summary: 'Get a driver by ID' })
  @ApiParam({ name: 'id', description: 'Driver UUID' })
  @ApiOkResponse({ description: 'Driver found.', type: DriverWaitlistResponseDto })
  @ApiNotFoundResponse({ description: 'Driver not found.' })
  async getDriverById(@Param('id', ParseUUIDPipe) id: string) {
    return this.waitlistService.getDriverById(id);
  }


  @Post('customer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a customer to the waitlist' })
  @ApiCreatedResponse({ description: 'Customer successfully added.' })
  @ApiBadRequestResponse({ description: 'Invalid input.' })
  async addCustomer(@Body() dto: CreateCustomerWaitlistDto) {
    return this.waitlistService.addCustomer(dto);
  }



  @Get('customer')
  @ApiOperation({ summary: 'Get all customers on the waitlist (paginated)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by customer name, email, or phone number' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10, description: 'Number of records per page' })
  @ApiOkResponse({
    description: 'Paginated list of customers.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(CustomerWaitlistResponseDto) } },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 200 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 10 },
            totalPages: { type: 'number', example: 20 },
          },
        },
      },
    },
  })
  async getCustomers(@Query() pagination: PaginationQueryDto) {
    return this.waitlistService.getCustomers(pagination);
  }

  @Get('customer/:id')
  @ApiOperation({ summary: 'Get a customer by ID' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  @ApiOkResponse({ description: 'Customer found.', type: CustomerWaitlistResponseDto })
  @ApiNotFoundResponse({ description: 'Customer not found.' })
  async getCustomerById(@Param('id', ParseUUIDPipe) id: string) {
    return this.waitlistService.getCustomerById(id);
  }



  // ═══ STATS ═══
  @Get('stats')
  @ApiOperation({ summary: 'Get waitlist statistics (total vendors, drivers, and customers)' })
  @ApiOkResponse({ description: 'Waitlist statistics.', type: WaitlistStatsResponseDto })
  async getStats() {
    return this.waitlistService.getStats();
  }
}