// src/customer/customer.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiBody,
  ApiNotFoundResponse,
  ApiParam,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { CustomerService } from './customer.service';
import { StoreDiscoveryService } from './store-discovery.service';
import { CartService } from './cart.service';
import { SaveLocationDto } from './dto/location.dto';
import { AddToCartDto } from './dto/cart.dto';
import { CreateOrderDto } from './dto/order.dto';
import { InitializePaymentDto } from './dto/payment.dto';
import { MonnifyService } from '../payment/monnify.service';
import { OrderService } from '../order/order.service';
import { Roles } from 'src/common/decorators/role.decorator';
import { UserRole } from 'src/shared/enums';
import { GetStoresQueryDto } from './dto/get-store.dto';
import { StoreResponseDto } from './dto/store-response.dto';
import { GetNearbyStoresQueryDto } from './dto/near-by-store.dto';

@ApiTags('customer')
@Controller('customer')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly storeDiscoveryService: StoreDiscoveryService,
    private readonly cartService: CartService,
    private readonly orderService: OrderService,
    private readonly monnifyService: MonnifyService,
  ) {}

  // ==================== LOCATION ====================

  @Post('location')
  @ApiOperation({ summary: 'Save customer location (prompted at first login)' })
  // @ApiBody({ type: SaveLocationDto })
  @ApiBody({
    description: 'Enter address',
    required: true,
    schema: {
      example: { address: '12 Allen Avenue, Lekki, Lagos' },
    },
  })
  async saveLocation(@Request() req, @Body() dto: SaveLocationDto) {
    return this.customerService.saveLocation(req.user.id, dto);
  }

  @Get('locations')
  @ApiOperation({ summary: 'Get customer saved locations' })
  async getLocations(@Request() req) {
    return this.customerService.getUserLocations(req.user.id);
  }

  // ==================== DISCOVERY ====================

  @Get('categories')
  @ApiOperation({ summary: 'Get all categories with subcategories' })
  async getCategories() {
    return this.customerService.getCategories();
  }

  @Get('stores/category/:categoryId')
  @ApiOperation({
    summary: 'Get stores by category (optionally filter by subcategory)',
    description:
      'Fetch stores by category. Optionally filter by subcategory, location, radius, search, and pagination. Uses user location if provided, otherwise falls back to saved address.',
  })
  @ApiParam({
    name: 'categoryId',
    description: 'ID of the store category',
    type: 'string',
  })
  @ApiQuery({
    name: 'subcategoryId',
    required: false,
    type: String,
    description: 'Optional subcategory filter',
  })
  @ApiQuery({ name: 'lat', required: false, type: Number })
  @ApiQuery({ name: 'lng', required: false, type: Number })
  @ApiQuery({ name: 'radiusKm', required: false, type: Number })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by store name, address, or product',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({
    description: 'Stores fetched successfully',
    type: [StoreResponseDto],
  })
  async getStores(
    @Param('categoryId') categoryId: string,
    @Query() query: GetStoresQueryDto,
    @Request() req,
  ): Promise<PaginatedStoreResponse> {
    const customerId = req.user?.id;

    return this.storeDiscoveryService.getStores({
      categoryId,
      customerId,
      ...query,
    });
  }

  @Get('stores/nearby')
  @ApiOperation({
    summary: 'Get nearby stores (optionally search by name/address/product)',
    description:
      'Fetch stores based on proximity to user. Optionally filter by search query. Uses user location if provided, otherwise falls back to saved address.',
  })
  @ApiQuery({
    name: 'lat',
    required: false,
    type: Number,
    description: 'User latitude',
  })
  @ApiQuery({
    name: 'lng',
    required: false,
    type: Number,
    description: 'User longitude',
  })
  @ApiQuery({
    name: 'radiusKm',
    required: false,
    type: Number,
    description: 'Radius in km',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by store name, address, description, or product',
  })
  @ApiOkResponse({
    description: 'Nearby stores fetched successfully',
    type: [StoreResponseDto],
  })
  async getNearbyStores(
    @Query() query: GetNearbyStoresQueryDto,
    @Request() req,
  ) {
    const customerId = req.user?.id;
    return this.storeDiscoveryService.getNearbyStores({ ...query, customerId });
  }

  // @Get('stores/category/:categoryId/subcategory/:subcategoryId')
  // @ApiOperation({
  //   summary: 'Get stores by subcategory (with optional location support)',
  //   description:
  //     'Fetch stores filtered by category and subcategory. Supports optional GPS coordinates, radius filtering, search, and pagination. If no location is provided, defaults to user saved address if available.',
  // })
  // @ApiParam({
  //   name: 'categoryId',
  //   description: 'ID of the parent store category',
  //   type: 'string',
  //   example: '123e4567-e89b-12d3-a456-426614174000',
  // })
  // @ApiParam({
  //   name: 'subcategoryId',
  //   description: 'ID of the store subcategory',
  //   type: 'string',
  //   example: '987e6543-e21b-12d3-a456-426614174999',
  // })
  // @ApiQuery({
  //   name: 'lat',
  //   required: false,
  //   type: Number,
  //   description: 'User latitude (optional, overrides saved location)',
  //   example: 6.5244,
  // })
  // @ApiQuery({
  //   name: 'lng',
  //   required: false,
  //   type: Number,
  //   description: 'User longitude (optional, overrides saved location)',
  //   example: 3.3792,
  // })
  // @ApiQuery({
  //   name: 'radiusKm',
  //   required: false,
  //   type: Number,
  //   description: 'Search radius in kilometers',
  //   example: 10,
  // })
  // @ApiQuery({
  //   name: 'search',
  //   required: false,
  //   type: String,
  //   description: 'Search stores by name, address, or products',
  //   example: 'Coffee | Pizza | Store name',
  // })
  // @ApiQuery({
  //   name: 'page',
  //   required: false,
  //   type: Number,
  //   description: 'Pagination page number',
  //   example: 1,
  // })
  // @ApiQuery({
  //   name: 'limit',
  //   required: false,
  //   type: Number,
  //   description: 'Number of stores per page',
  //   example: 20,
  // })
  // @ApiOkResponse({
  //   description:
  //     'List of stores matching the category, subcategory, and optional filters',
  //   type: [StoreResponseDto],
  // })
  // async getStoresBySubcategory(
  //   @Param('categoryId') categoryId: string,
  //   @Param('subcategoryId') subcategoryId: string,
  //   @Query() query: GetStoresQueryDto,
  //   @Request() req,
  // ): Promise<PaginatedStoreResponse> {
  //   const customerId = req.user?.id;

  //   return this.storeDiscoveryService.getStoresBySubcategory({
  //     categoryId,
  //     subcategoryId,
  //     customerId,
  //     ...query,
  //   });
  // }

  @Get('subcategories/category/:categoryId')
  @ApiOperation({ summary: 'Get subcategories by category with store counts' })
  async getSubcategoriesByCategory(@Param('categoryId') categoryId: string) {
    return this.storeDiscoveryService.getSubcategoriesWithStoreCount(
      categoryId,
    );
  }

  @Get('stores/:storeId')
  @ApiOperation({ summary: 'Get store details with products' })
  async getStoreDetails(@Param('storeId') storeId: string) {
    return this.storeDiscoveryService.getStoreWithProducts(storeId);
  }

  @Get('products/:productId')
  @ApiOperation({ summary: 'Get product details' })
  async getProductDetails(@Param('productId') productId: string) {
    return this.storeDiscoveryService.getProductDetails(productId);
  }

  @Get('packages')
  @ApiOperation({ summary: 'Get packages and documents' })
  @ApiQuery({ name: 'type', enum: ['PACKAGE', 'DOCUMENT'], required: false })
  async getPackages(@Query('type') type?: 'PACKAGE' | 'DOCUMENT') {
    return this.customerService.getPackages(type);
  }

  @Get('delivery-options')
  @ApiOperation({ summary: 'Get delivery options' })
  async getDeliveryOptions() {
    return this.customerService.getDeliveryOptions();
  }

  @Get('vendor-address/:storeId')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get vendor address by store ID',
    description:
      'Retrieves the vendor address associated with a specific store',
  })
  @ApiParam({
    name: 'storeId',
    description: 'Store UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({
    description: 'Vendor address retrieved successfully',
  })
  @ApiNotFoundResponse({
    description: 'Store or Vendor not found',
  })
  async getVendorAddressByStore(@Param('storeId') storeId: string) {
    return this.customerService.getVendorAddressByStore(storeId);
  }

  // ==================== CART ====================

  @Get('cart')
  @ApiOperation({ summary: 'Get current cart' })
  async getCart(@Request() req) {
    const cart = await this.cartService.getOrCreateCart(req.user.id);
    return this.cartService.getCartSummary(cart.id);
  }

  @Post('cart/add')
  @ApiOperation({ summary: 'Add item to cart' })
  async addToCart(@Request() req, @Body() dto: AddToCartDto) {
    return this.cartService.addToCart(req.user.id, dto);
  }

  @Post('cart/item/:itemId/quantity')
  @ApiOperation({ summary: 'Update cart item quantity' })
  async updateCartItemQuantity(
    @Param('itemId') itemId: string,
    @Body('quantity') quantity: number,
  ) {
    return this.cartService.updateCartItemQuantity(itemId, quantity);
  }

  @Post('cart/item/:itemId/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove item from cart' })
  async removeCartItem(@Param('itemId') itemId: string) {
    return this.cartService.removeCartItem(itemId);
  }

  @Post('cart/clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear cart' })
  async clearCart(@Request() req) {
    const cart = await this.cartService.getOrCreateCart(req.user.id);
    await this.cartService.clearCart(cart.id);
    return { success: true, message: 'Cart cleared' };
  }

  // ==================== ORDER ====================

  @Post('orders')
  @ApiOperation({ summary: 'Create order from cart' })
  async createOrder(@Request() req, @Body() dto: CreateOrderDto) {
    return this.orderService.createOrder(req.user.id, dto);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Get user orders' })
  async getUserOrders(@Request() req) {
    return this.orderService.getUserOrders(req.user.id);
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Get order details' })
  async getOrderDetails(@Request() req, @Param('orderId') orderId: string) {
    return this.orderService.getOrderDetails(orderId, req.user.id);
  }

  @Post('orders/:orderId/cancel')
  @ApiOperation({ summary: 'Cancel order' })
  async cancelOrder(@Request() req, @Param('orderId') orderId: string) {
    return this.orderService.cancelOrder(orderId, req.user.id);
  }

  // ==================== PAYMENT ====================

  @Post('payment/initialize')
  @ApiOperation({ summary: 'Initialize Monnify payment' })
  async initializePayment(@Request() req, @Body() dto: InitializePaymentDto) {
    return this.monnifyService.initializePayment(req.user.id, dto);
  }

  @Post('payment/verify/:reference')
  @ApiOperation({ summary: 'Verify payment' })
  async verifyPayment(@Param('reference') reference: string) {
    return this.monnifyService.verifyPayment(reference);
  }
}

type PaginatedStoreResponse = {
  data: StoreResponseDto[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};
