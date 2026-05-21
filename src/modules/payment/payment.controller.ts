import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Res,
  Headers,
  HttpCode,
  RawBodyRequest,
  Req,
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
// import { MonnifyWebhookDto } from '../customer/dto/payment.dto';

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
  @ApiQuery({
    name: 'paymentReference',
    required: true,
    type: String,
    description: 'Unique payment reference from Monnify',
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
    @Query('paymentReference') paymentReference: string,
    @Res() res: Response,
  ) {
    console.log(
      'Callback received query:',
      transactionReference,
      paymentReference,
    ); // <<-- log this
    const frontendUrl = this.configService.get('FRONTEND_URL');
    console.log('frontendUrl:', frontendUrl); // <<-- log this

    if (!transactionReference && !paymentReference) {
      return res.redirect(
        `${frontendUrl}/payment/error?reason=missing_reference`,
      );
    }

    try {
      let result;
      if (transactionReference) {
        result =
          await this.monnifyService.verifyPaymentAndUpdate(
            transactionReference,
          );
      } else if (paymentReference) {
        // Handle paymentReference if needed
        result =
          await this.monnifyService.verifyByPaymentReference(paymentReference);
      }

      const params = new URLSearchParams({
        status: result.status,
        orderId: result.orderId,
        orderNumber: result.orderNumber,
      });

      return res.redirect(`${frontendUrl}/payment/result?${params.toString()}`);
    } catch (error) {
      this.logger.error(`Callback error: ${error.message}`);
      const ref = transactionReference || paymentReference;
      return res.redirect(
        `${frontendUrl}/payment/error?reason=verification_failed&ref=${ref}`,
      );
    }
  }
  //FOR WEBHOOK
  // async paymentCallback(
  //   @Query('transactionReference') transactionReference: string,
  //   @Res() res: Response,
  // ) {
  //   if (!transactionReference) {
  //     return res.redirect(
  //       `${this.configService.get('FRONTEND_URL')}/payment/error`,
  //     );
  //   }

  //   return res.redirect(
  //     `${this.configService.get('FRONTEND_URL')}/payment/result?transactionReference=${transactionReference}`,
  //   );
  // }
  // async paymentCallback(
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

  // @Post('/webhook')
  // async webhook(
  //   @Body() body: MonnifyWebhookDto,
  //   @Headers('monnify-signature') signature: string,
  // ) {
  //   return this.monnifyService.handleWebhook(body, signature);
  // }

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('monnify-signature') signature: string,
  ) {
    const rawBody = req.rawBody?.toString();
    if (!rawBody) {
      this.logger.error('Missing raw body in webhook');
      throw new Error('Raw body missing');
    }

    // Pass raw body and signature to service
    await this.monnifyService.handleWebhook(rawBody, signature);
    // If we reach here, all good (service threw on error)
    return { success: true };
  }

  @Get('/status')
  @ApiOperation({ summary: 'Get payment status by transaction reference' })
  @ApiQuery({
    name: 'transactionReference',
    type: String,
    description: 'Unique transaction reference for the payment',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Payment status retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid transaction reference' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  async getPaymentStatus(@Query('transactionReference') ref: string) {
    return this.monnifyService.getPaymentStatus(ref);
  }
}
