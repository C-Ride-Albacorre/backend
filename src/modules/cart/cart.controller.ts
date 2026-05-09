// src/customer/customer.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Request,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/cart.dto';
import { Public } from '../../common/decorators/public.decorator';
import Helper from 'src/shared/utils/helpers';

@ApiTags('cart')
@Controller('cart')
@Public()
export class CartController {
  constructor(private readonly cartService: CartService) {}

  // ==================== CART ====================

  @Get('')
  @ApiOperation({ summary: 'Get current cart' })
  @ApiHeader({
    name: 'x-session-id',
    required: false, // ✅ this is key
    description: 'Guest session ID',
  })
  async getCart(@Request() req, @Headers('x-session-id') sessionId: string) {
    const userId = req.user?.id || null;

    const cart = await this.cartService.getOrCreateCart(userId, sessionId);
    return this.cartService.getCartSummary(cart.id);
  }

  @Post('/add')
  @Public()
  @ApiOperation({ summary: 'Add item to cart' })
  @ApiHeader({
    name: 'x-session-id',
    required: false,
    description: 'Guest session ID',
  })
  async addToCart(
    @Request() req,
    @Body() dto: AddToCartDto,
    @Headers('x-session-id') sessionId: string,
  ) {
    const userId = req.user?.id || null;
    return this.cartService.addToCart(userId, dto, sessionId);
  }

  @Post('/add1')
  @Public()
  @ApiOperation({ summary: 'Add item to cart' })
  async addToCart1(@Request() req, @Body() dto: AddToCartDto) {
    const userId = req.user?.id || null;
    // No sessionId from header – service will generate one for guests
    return this.cartService.addToCart(userId, dto);
  }

  @Post('/item/:itemId/quantity')
  @ApiOperation({ summary: 'Update cart item quantity' })
  @ApiHeader({
    name: 'x-session-id',
    required: false,
    description: 'Guest session ID',
  })
  async updateCartItemQuantity(
    @Request() req,
    @Param('itemId') itemId: string,
    @Body('quantity') quantity: number,
    @Headers('x-session-id') sessionId?: string,
  ) {
    const userId = req.user?.id || null;

    return this.cartService.updateCartItemQuantity(
      itemId,
      quantity,
      userId,
      sessionId,
    );
  }

  @Post('/item/:itemId/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove item from cart' })
  @ApiHeader({
    name: 'x-session-id',
    required: false,
    description: 'Guest session ID',
  })
  async removeCartItem(
    @Request() req,
    @Param('itemId') itemId: string,
    @Headers('x-session-id') sessionId?: string,
  ) {
    const userId = req.user?.id || null;

    return this.cartService.removeCartItem(itemId, userId, sessionId);
  }

  @Post('/clear')
  @ApiOperation({ summary: 'Clear cart' })
  @ApiHeader({
    name: 'x-session-id',
    required: false, // ✅ this is key
    description: 'Guest session ID',
  })
  async clearCart(@Request() req, @Headers('x-session-id') sessionId: string) {
    const userId = req.user?.id || null;

    const cart = await this.cartService.getOrCreateCart(userId, sessionId);
    await this.cartService.clearCart(cart.id);

    return { success: true, message: 'Cart cleared' };
  }
}
