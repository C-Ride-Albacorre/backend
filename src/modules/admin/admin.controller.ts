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
  Put,
  Delete,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiConsumes,
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
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import {
  CreateSubcategoryDto,
  UpdateSubcategoryDto,
} from './dto/subcategory.dto';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { DispatcherFilterDto } from './dto/dispatcher-filter.dto';
import { ApproveDispatcherDto } from './dto/approve-dispatcher.dto';
import { CustomerFilterDto } from './dto/customer.dto';
import { UpdateCustomerStatusDto } from './dto/update-customer-status.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // @Post('create-admin')
  // @Roles(UserRole.SUPER_ADMIN)
  // @HttpCode(HttpStatus.CREATED)
  // @ApiOperation({ summary: 'Create a new admin (Super Admin only)' })
  // @ApiResponse({ status: 201, description: 'Admin created successfully' })
  // @ApiResponse({
  //   status: 403,
  //   description: 'Forbidden - Requires Super Admin role',
  // })
  // async createAdmin(@GetUser() user: any, @Body() dto: CreateAdminDto) {
  //   return this.adminService.createAdmin(user.id, dto);
  // }

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

  // =============DISPACTHER============= //
  @Get('dispatchers')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all dispatchers with filters' })
  async getAllDispatchers(@Query() filterDto: DispatcherFilterDto) {
    return this.adminService.getAllDispatchers(filterDto);
  }

  @Get('dispatchers/:dispatcherId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get dispatcher details by ID' })
  async getDispatcherDetails(@Param('dispatcherId') dispatcherId: string) {
    return this.adminService.getDispatcherDetails(dispatcherId);
  }

  @Patch('dispatchers/:dispatcherId/approve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject dispatcher' })
  async approveDispatcher(
    @GetUser() user: any,
    @Param('dispatcherId') dispatcherId: string,
    @Body() dto: ApproveDispatcherDto,
  ) {
    return this.adminService.approveDispatcher(user.id, dispatcherId, dto);
  }

  // =============CUSTOMER============= //
@Get('customers')
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Get all customers with filters' })
async getAllCustomers(@Query() filterDto: CustomerFilterDto) {
  return this.adminService.getAllCustomers(filterDto);
}

@Get('customers/:customerId')
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Get customer details by ID' })
async getCustomerDetails(@Param('customerId') customerId: string) {
  return this.adminService.getCustomerDetails(customerId);
}

@Delete('customers/:customerId')
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Delete customer by ID' })
async deleteCustomer(@Param('customerId') customerId: string) {
  return this.adminService.deleteCustomer(customerId);
}

@Patch('customers/:customerId/status')
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Update customer status' })
async updateCustomerStatus(
  @Param('customerId') customerId: string,
  @Body() statusDto: UpdateCustomerStatusDto,
) {
  return this.adminService.updateCustomerStatus(
    customerId,
    statusDto,
  );
}


  // ========== CATEGORY ENDPOINTS ==========

  @Post('category')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'image', maxCount: 1 },
      { name: 'icon', maxCount: 1 },
    ]),
  )
  @ApiOperation({
    summary: 'Create a new category',
    description:
      'Creates a new product/service category. Category name must be unique.',
  })
  @ApiBody({
    type: CreateCategoryDto,
    description: 'Category creation data',
    examples: {
      'Restaurant Category': {
        value: {
          name: 'Restaurants',
          description: 'All types of restaurants',
          icon: 'https://example.com/icons/restaurant.png',
          image: 'https://example.com/images/restaurant.jpg',
          isActive: true,
          displayOrder: 1,
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Category created successfully' })
  @ApiBadRequestResponse({ description: 'Invalid input data' })
  @ApiConflictResponse({
    description: 'Category with this name already exists',
  })
  async createCategory(
    @Body() dto: CreateCategoryDto,
    @UploadedFiles()
    files: {
      image?: Express.Multer.File[];
      icon?: Express.Multer.File[];
    },
  ) {
    return this.adminService.createCategory(dto, files);
  }

  @Get('categories')
  @ApiOperation({
    summary: 'Get all categories (including inactive)',
    description:
      'Retrieves all categories with their subcategories and store counts. Includes both active and inactive categories for admin purposes.',
  })
  @ApiOkResponse({
    description: 'List of all categories retrieved successfully',
  })
  async getAllCategories() {
    return this.adminService.getAllCategories();
  }

  @Get('category/:id')
  @ApiOperation({
    summary: 'Get category by ID',
    description:
      'Retrieves detailed information about a specific category including its subcategories and associated stores.',
  })
  @ApiParam({
    name: 'id',
    description: 'Category UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  @ApiOkResponse({ description: 'Category details retrieved successfully' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  async getCategoryById(@Param('id') id: string) {
    return this.adminService.getCategoryById(id);
  }

  @Put('category/:id')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'image', maxCount: 1 },
      { name: 'icon', maxCount: 1 },
    ]),
  )
  @ApiOperation({
    summary: 'Update category',
    description:
      'Updates an existing category. All fields are optional - only provided fields will be updated.',
  })
  @ApiParam({
    name: 'id',
    description: 'Category UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({
    type: UpdateCategoryDto,
    description: 'Category update data (all fields optional)',
    examples: {
      'Update Name and Order': {
        value: {
          name: 'Restaurants & Cafes',
          displayOrder: 2,
        },
      },
      'Update Status': {
        value: {
          isActive: false,
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Category updated successfully' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  @ApiConflictResponse({
    description: 'Category with this name already exists',
  })
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @UploadedFiles()
    files: {
      image?: Express.Multer.File[];
      icon?: Express.Multer.File[];
    },
  ) {
    return this.adminService.updateCategory(id, dto, files);
  }

  @Delete('category/:id')
  // @ApiOperation({
  //   summary: 'Delete category (soft delete)',
  //   description:
  //     'Soft deletes a category by setting isActive to false. The category remains in the database but becomes inactive.',
  // })
  @ApiOperation({
    summary: 'Delete category',
    description: 'Deletes a category from db.',
  })
  @ApiParam({
    name: 'id',
    description: 'Category UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({ description: 'Category deleted (deactivated) successfully' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  async deleteCategory(@Param('id') id: string) {
    return this.adminService.deleteCategory(id);
  }

  @Put(':id/toggle-status')
  @ApiOperation({
    summary: 'Toggle category active status',
    description:
      'Toggles the isActive status of a category. If currently active, becomes inactive and vice versa.',
  })
  @ApiParam({
    name: 'id',
    description: 'Category UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({ description: 'Category status toggled successfully' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  async toggleCategoryStatus(@Param('id') id: string) {
    return this.adminService.toggleCategoryStatus(id);
  }

  @Put(':id/reorder')
  @ApiOperation({
    summary: 'Update category display order',
    description:
      'Updates the display order of a category for sorting purposes.',
  })
  @ApiParam({
    name: 'id',
    description: 'Category UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        displayOrder: {
          type: 'number',
          description: 'New display order position',
          example: 3,
          minimum: 0,
        },
      },
    },
    description: 'New display order value',
  })
  @ApiOkResponse({ description: 'Category display order updated successfully' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  async reorderCategory(
    @Param('id') id: string,
    @Body('displayOrder') displayOrder: number,
  ) {
    return this.adminService.updateDisplayOrder(id, displayOrder);
  }

  // ========== SUBCATEGORY ENDPOINTS ==========

  // @Post('subcategories')
  // @ApiOperation({
  //   summary: 'Create a new subcategory',
  //   description:
  //     'Creates a new subcategory under an existing category. Subcategory name must be unique within its category.',
  // })
  // @ApiBody({
  //   type: CreateSubcategoryDto,
  //   description: 'Subcategory creation data',
  //   examples: {
  //     'Italian Subcategory': {
  //       value: {
  //         name: 'Italian Restaurant',
  //         description: 'Authentic Italian cuisine',
  //         categoryId: '123e4567-e89b-12d3-a456-426614174000',
  //         isActive: true,
  //         displayOrder: 1,
  //       },
  //     },
  //   },
  // })
  // @ApiCreatedResponse({ description: 'Subcategory created successfully' })
  // @ApiBadRequestResponse({ description: 'Invalid input data' })
  // @ApiNotFoundResponse({ description: 'Category not found' })
  // @ApiConflictResponse({
  //   description: 'Subcategory with this name already exists in this category',
  // })
  // async createSubcategory(@Body() dto: CreateSubcategoryDto) {
  //   return this.adminService.createSubcategory(dto);
  // }

  @Post('subcategories')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'image', maxCount: 1 },
      { name: 'icon', maxCount: 1 },
    ]),
  )
  @ApiOperation({
    summary: 'Create a new subcategory',
    description:
      'Creates a new subcategory under an existing category. Subcategory name must be unique within its category.',
  })
  @ApiBody({
    type: CreateSubcategoryDto,
    description: 'Subcategory creation data',
    examples: {
      'Italian Subcategory': {
        value: {
          name: 'Italian Restaurant',
          description: 'Authentic Italian cuisine',
          categoryId: '123e4567-e89b-12d3-a456-426614174000',
          icon: 'https://example.com/icons/italian.png',
          image: 'https://example.com/images/italian.jpg',
          isActive: true,
          displayOrder: 1,
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Subcategory created successfully' })
  @ApiBadRequestResponse({ description: 'Invalid input data' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  @ApiConflictResponse({
    description: 'Subcategory with this name already exists in this category',
  })
  async createSubcategory(
    @Body() dto: CreateSubcategoryDto,
    @UploadedFiles()
    files: {
      image?: Express.Multer.File[];
      icon?: Express.Multer.File[];
    },
  ) {
    return this.adminService.createSubcategory(dto, files);
  }

  @Get('subcategories')
  @ApiOperation({
    summary: 'Get all subcategories (including inactive)',
    description:
      'Retrieves all subcategories with their category information and store counts. Includes both active and inactive subcategories.',
  })
  @ApiOkResponse({
    description: 'List of all subcategories retrieved successfully',
  })
  async getAllSubcategories() {
    return this.adminService.getAllSubcategories();
  }

  @Get('subcategories/:id')
  @ApiOperation({
    summary: 'Get subcategory by ID',
    description:
      'Retrieves detailed information about a specific subcategory including its category and associated stores.',
  })
  @ApiParam({
    name: 'id',
    description: 'Subcategory UUID',
    example: '123e4567-e89b-12d3-a456-426614174001',
    required: true,
  })
  @ApiOkResponse({ description: 'Subcategory details retrieved successfully' })
  @ApiNotFoundResponse({ description: 'Subcategory not found' })
  async getSubcategoryById(@Param('id') id: string) {
    return this.adminService.getSubcategoryById(id);
  }

  @Get(':categoryId/subcategories')
  @ApiOperation({
    summary: 'Get all subcategories by category ID',
    description:
      'Retrieves all subcategories belonging to a specific category, ordered by display order.',
  })
  @ApiParam({
    name: 'categoryId',
    description: 'Category UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  @ApiOkResponse({
    description: 'List of subcategories retrieved successfully',
  })
  async getSubcategoriesByCategory(@Param('categoryId') categoryId: string) {
    return this.adminService.getSubcategoriesByCategory(categoryId);
  }

  @Put('subcategories/:id')
   @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'image', maxCount: 1 },
      { name: 'icon', maxCount: 1 },
    ]),
  )
  @ApiOperation({
    summary: 'Update subcategory',
    description:
      'Updates an existing subcategory. All fields are optional - only provided fields will be updated.',
  })
  @ApiParam({
    name: 'id',
    description: 'Subcategory UUID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @ApiBody({
    type: UpdateSubcategoryDto,
    description: 'Subcategory update data (all fields optional)',
    examples: {
      'Update Name and Description': {
        value: {
          name: 'Italian Cuisine',
          description: 'Traditional Italian dishes and pizza',
        },
      },
      'Change Category': {
        value: {
          categoryId: '123e4567-e89b-12d3-a456-426614174002',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Subcategory updated successfully' })
  @ApiNotFoundResponse({ description: 'Subcategory not found' })
  @ApiConflictResponse({
    description: 'Subcategory with this name already exists in this category',
  })
  async updateSubcategory(
    @Param('id') id: string,
    @Body() dto: UpdateSubcategoryDto,
     @UploadedFiles()
    files: {
      image?: Express.Multer.File[];
      icon?: Express.Multer.File[];
    },
  ) {
    return this.adminService.updateSubcategory(id, dto, files);
  }

  @Delete('subcategories/:id')
  // @ApiOperation({
  //   summary: 'Delete subcategory (soft delete)',
  //   description:
  //     'Soft deletes a subcategory by setting isActive to false. The subcategory remains in the database but becomes inactive.',
  // })
  @ApiOperation({
    summary: 'Delete subCategory',
    description: 'Deletes a subCategory from db.',
  })
  @ApiParam({
    name: 'id',
    description: 'Subcategory UUID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @ApiOkResponse({
    description: 'Subcategory deleted (deactivated) successfully',
  })
  @ApiNotFoundResponse({ description: 'Subcategory not found' })
  async deleteSubcategory(@Param('id') id: string) {
    return this.adminService.deleteSubcategory(id);
  }

  @Put('subcategories/:id/toggle-status')
  @ApiOperation({
    summary: 'Toggle subcategory active status',
    description:
      'Toggles the isActive status of a subcategory. If currently active, becomes inactive and vice versa.',
  })
  @ApiParam({
    name: 'id',
    description: 'Subcategory UUID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @ApiOkResponse({ description: 'Subcategory status toggled successfully' })
  @ApiNotFoundResponse({ description: 'Subcategory not found' })
  async toggleSubcategoryStatus(@Param('id') id: string) {
    return this.adminService.toggleSubcategoryStatus(id);
  }

  @Put('subcategories/:id/reorder')
  @ApiOperation({
    summary: 'Update subcategory display order',
    description:
      'Updates the display order of a subcategory for sorting purposes within its category.',
  })
  @ApiParam({
    name: 'id',
    description: 'Subcategory UUID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        displayOrder: {
          type: 'number',
          description: 'New display order position',
          example: 2,
          minimum: 0,
        },
      },
    },
    description: 'New display order value',
  })
  @ApiOkResponse({
    description: 'Subcategory display order updated successfully',
  })
  @ApiNotFoundResponse({ description: 'Subcategory not found' })
  async reorderSubcategory(
    @Param('id') id: string,
    @Body('displayOrder') displayOrder: number,
  ) {
    return this.adminService.updateSubcategoryDisplayOrder(id, displayOrder);
  }

  // Bulk operations
  @Post('bulk/reorder')
  @ApiOperation({
    summary: 'Bulk update categories display order',
    description:
      'Updates display orders for multiple categories in a single transaction. Useful for drag-and-drop reordering interfaces.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          description: 'Array of categories with their new display orders',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Category UUID',
                example: '123e4567-e89b-12d3-a456-426614174000',
              },
              displayOrder: {
                type: 'number',
                description: 'New display order',
                example: 1,
                minimum: 0,
              },
            },
            required: ['id', 'displayOrder'],
          },
          example: [
            { id: '123e4567-e89b-12d3-a456-426614174000', displayOrder: 1 },
            { id: '223e4567-e89b-12d3-a456-426614174001', displayOrder: 2 },
            { id: '323e4567-e89b-12d3-a456-426614174002', displayOrder: 3 },
          ],
        },
      },
      required: ['categories'],
    },
    description: 'Array of category ID and display order pairs',
  })
  @ApiOkResponse({ description: 'Categories reordered successfully' })
  @ApiBadRequestResponse({ description: 'Invalid input data' })
  async bulkReorderCategories(
    @Body('categories') categories: { id: string; displayOrder: number }[],
  ) {
    return this.adminService.bulkReorderCategories(categories);
  }

  @Get('dashboard/stats')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get dashboard statistics' })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }
}
