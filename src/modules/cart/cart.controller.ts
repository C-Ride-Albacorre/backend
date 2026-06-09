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
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/cart.dto';
import { Public } from '../../common/decorators/public.decorator';
import { JwtOptionalGuard } from 'src/common/guards/jwt-optional.guard';
import { PrismaService } from 'src/shared/services/prisma.service';

@Public()
@ApiTags('Cart')
@Controller('cart')
@UseGuards(JwtOptionalGuard)
@ApiBearerAuth()
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly prisma: PrismaService,
  ) {}

  // ==================== CART ====================

  // @Get('')
  // @ApiOperation({ summary: 'Get current cart' })
  // @ApiHeader({
  //   name: 'x-session-id',
  //   required: false, // ✅ this is key
  //   description: 'Guest session ID',
  // })
  // async getCart(@Request() req, @Headers('x-session-id') sessionId: string) {
  //   const userId = req.user?.id || null;

  //   const cart = await this.cartService.getOrCreateCart(userId, sessionId);
  //   return this.cartService.getCartSummary(cart.id, userId, sessionId);
  // }

  @Get('')
  @ApiOperation({ summary: 'Get current cart' })
  @ApiHeader({
    name: 'x-session-id',
    required: false, // ✅ this is key
    description: 'Guest session ID',
  })
  async getCart(@Request() req, @Headers('x-session-id') sessionId: string) {
    const userId = req.user?.id || null;
    const safeSessionId = sessionId?.trim() || null;

    // Logged-in user → always return user cart (do NOT create)
    if (userId) {
      const userCart = await this.prisma.cart.findUnique({
        where: { userId },
        include: { items: true },
      });
      if (!userCart) {
        // Optionally create one, but better to return 404 or empty structure
        throw new NotFoundException('No cart found for this user');
      }
      return this.cartService.getCartSummary(userCart.id, userId, null);
    }

    // Guest flow
    if (!safeSessionId) {
      throw new BadRequestException('sessionId required for guest');
    }

    const guestCart = await this.prisma.cart.findUnique({
      where: { sessionId: safeSessionId },
      include: { items: true },
    });

    if (!guestCart) {
      // Do NOT auto-create – the sessionId is invalid or was merged
      throw new NotFoundException('No cart found for this session');
    }

    return this.cartService.getCartSummary(guestCart.id, null, safeSessionId);
  }

  @Post('/add')
  @ApiOperation({ summary: 'Add item to cart' })
  @ApiHeader({
    name: 'x-session-id',
    required: false,
    description: 'Guest session ID',
  })
  async addToCart(
    @Request() req,
    @Body() dto: AddToCartDto,
    @Headers('x-session-id') sessionId?: string,
  ) {
    const userId = req.user?.id || null;
    const safeSessionId = sessionId?.trim() || null;

    console.log('userId', userId);
    console.log('safeSessionId', safeSessionId);

    return this.cartService.addToCart(userId, dto, safeSessionId);
  }

  @Post('/item/:itemId/quantity')
  @ApiOperation({ summary: 'Update cart item quantity' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        quantity: { type: 'number', example: 2 },
      },
      required: ['quantity'],
    },
  })
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
