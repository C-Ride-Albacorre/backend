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
  @ApiBody({ type: SaveLocationDto })
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
  @ApiOperation({ summary: 'Get stores by category' })
  @ApiQuery({ name: 'latitude', required: false })
  @ApiQuery({ name: 'longitude', required: false })
  async getStoresByCategory(
    @Param('categoryId') categoryId: string,
    @Query('latitude') latitude?: number,
    @Query('longitude') longitude?: number,
  ) {
    const location = latitude && longitude ? { latitude, longitude } : null;
    return this.storeDiscoveryService.getStoresByCategory(categoryId, location);
  }

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
