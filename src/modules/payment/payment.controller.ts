import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Res,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { MonnifyService } from './monnify.service';
import {
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MonnifyWebhookDto } from '../customer/dto/payment.dto';

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly monnifyService: MonnifyService,
    private readonly configService: ConfigService,
  ) {}

  @Get('/callback')
  @ApiOperation({
    summary: 'Monnify Payment Callback',
    description:
      'Handles payment callback from Monnify. Verifies transaction and redirects user to frontend with payment status.',
  })
  @ApiProduces('text/html')
  @ApiQuery({
    name: 'transactionReference',
    required: true,
    type: String,
    description: 'Unique transaction reference from Monnify',
    example: 'MNFY|85|20230920123456|000123',
  })
  @ApiResponse({
    status: 302,
    description:
      'Redirects to frontend payment result page with status, orderId, and orderNumber',
  })
  @ApiResponse({
    status: 400,
    description: 'Missing transaction reference',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error during verification',
  })
  async paymentCallback(
    @Query('transactionReference') transactionReference: string,
    @Res() res: Response,
  ) {
    if (!transactionReference) {
      return res.redirect(
        `${this.configService.get('FRONTEND_URL')}/payment/error`,
      );
    }

    return res.redirect(
      `${this.configService.get('FRONTEND_URL')}/payment/result?transactionReference=${transactionReference}`,
    );
  }
  // async paymentCallbackold(
  //   @Query('transactionReference') transactionReference: string,
  //   @Res() res: Response,
  // ) {
  //   if (!transactionReference) {
  //     // Redirect to frontend error page if no reference
  //     return res.redirect(
  //       `${this.configService.get('FRONTEND_URL')}/payment/error`,
  //     );
  //   }

  //   try {
  //     // Verify payment with Monnify and update DB
  //     const result =
  //       await this.monnifyService.verifyPaymentAndUpdate(transactionReference);

  //     // Redirect to frontend result page with status info
  //     return res.redirect(
  //       `${this.configService.get('FRONTEND_URL')}/payment/result?status=${result.status}&orderId=${result.orderId}&orderNumber=${result.orderNumber}`,
  //     );
  //   } catch (error) {
  //     // Redirect to frontend error page on failure
  //     return res.redirect(
  //       `${this.configService.get('FRONTEND_URL')}/payment/error`,
  //     );
  //   }
  // }

  @Post('/webhook')
  async webhook(
    @Body() body: MonnifyWebhookDto,
    @Headers('monnify-signature') signature: string,
  ) {
    return this.monnifyService.handleWebhook(body, signature);
  }

  @Get('/status')
  async getPaymentStatus(@Query('transactionReference') ref: string) {
    return this.monnifyService.getPaymentStatus(ref);
  }
}
