// src/admin/admin.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { Roles } from '../../common/decorators/role.decorator';
import { RolesGuard } from '../../common/guards/role.guard';
import { UserRole } from '../../shared/enums';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ApproveVendorDto } from './dto/approve-vendor.dto';
import { ApproveStoreDto } from './dto/approve-store.dto';
import { VendorFilterDto } from './dto/vendor-filter.dto';
import { StoreFilterDto } from './dto/store-filter.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('create-admin')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new admin (Super Admin only)' })
  @ApiResponse({ status: 201, description: 'Admin created successfully' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Requires Super Admin role',
  })
  async createAdmin(@GetUser() user: any, @Body() dto: CreateAdminDto) {
    return this.adminService.createAdmin(user.id, dto);
  }

  @Get('vendors')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all vendors with filters' })
  @ApiResponse({ status: 200, description: 'Vendors retrieved successfully' })
  async getAllVendors(@Query() filterDto: VendorFilterDto) {
    return this.adminService.getAllVendors(filterDto);
  }

  @Get('vendors/:vendorId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get vendor details by ID' })
  @ApiParam({ name: 'vendorId', description: 'Vendor ID' })
  async getVendorDetails(@Param('vendorId') vendorId: string) {
    return this.adminService.getVendorDetails(vendorId);
  }

  @Patch('vendors/:vendorId/approve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject a vendor' })
  @ApiParam({ name: 'vendorId', description: 'Vendor ID' })
  async approveVendor(
    @GetUser() user: any,
    @Param('vendorId') vendorId: string,
    @Body() dto: ApproveVendorDto,
  ) {
    return this.adminService.approveVendor(user.id, vendorId, dto);
  }

  @Get('stores')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all stores with filters' })
  @ApiResponse({ status: 200, description: 'Stores retrieved successfully' })
  async getAllStores(@Query() filterDto: StoreFilterDto) {
    return this.adminService.getAllStores(filterDto);
  }

  @Get('stores/:storeId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get store details by ID' })
  @ApiParam({ name: 'storeId', description: 'Store ID' })
  async getStoreDetails(@Param('storeId') storeId: string) {
    return this.adminService.getStoreDetails(storeId);
  }

  @Patch('stores/:storeId/approve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject a store' })
  @ApiParam({ name: 'storeId', description: 'Store ID' })
  async approveStore(
    @GetUser() user: any,
    @Param('storeId') storeId: string,
    @Body() dto: ApproveStoreDto,
  ) {
    return this.adminService.approveStore(user.id, storeId, dto);
  }

  @Get('dashboard/stats')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get dashboard statistics' })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }
}
