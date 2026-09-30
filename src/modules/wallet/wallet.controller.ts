// wallet.controller.ts
import { Controller, Post, Get, Body, Request, Query, UseGuards, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { WalletService } from './wallet.service';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { FundWalletDto } from './dto/wallet.dto.';
import { ConfigService } from '@nestjs/config';
import { Roles } from '../../common/decorators/role.decorator';
import { UserRole } from '../../shared/enums';
import { PaymentMethod } from '@prisma/client';
import { RolesGuard } from '../../common/guards/role.guard';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Customer Wallet')
@Controller('wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
@ApiBearerAuth()
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(private walletService: WalletService,
    private readonly configService: ConfigService,
  ) {

  }

  @Get('balance')
  @ApiOperation({ summary: 'Get wallet balance' })
  async getBalance(@Request() req) {
    return this.walletService.getBalance(req.user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get transaction history' })
  async getTransactions(@Request() req, @Query('page') page = 1, @Query('limit') limit = 20) {
    return this.walletService.getTransactions(req.user.id, +page, +limit);
  }

  @Post('fund')
  @ApiOperation({ summary: 'Fund wallet via Monnify' })
  @ApiBody({
    type: FundWalletDto,
    description: 'Wallet funding details',
    examples: {
      default: {
        summary: 'Fund wallet',
        value: { amount: 5000, paymentMethod: PaymentMethod.CARD },
      },
    },
  })
  
  async fundWallet(@Request() req, @Body() dto: FundWalletDto) {
    return this.walletService.fundWallet(req.user.id, dto.amount, dto.paymentMethod);
  }

  // Internal endpoint for webhook callback (no auth)
  // We'll add a separate controller for webhook handlers.

  // In wallet.controller.ts (or new WalletWebhookController)

@Public()
@Get('callback')
async walletCallback(
  @Query('paymentReference') paymentReference: string,
  @Res() res: Response,
) {
  const result = await this.walletService.processWalletCallback({
    paymentReference,
  });

  return res.redirect(result.redirectUrl);
}

}