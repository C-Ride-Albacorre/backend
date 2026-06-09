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

@ApiTags('Payment')
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
      this.logger.error('Missing transactionReference and paymentReference in callback');
      return res.redirect(
        `${frontendUrl}/payment/error?reason=missing_reference`,
      );
    }

    try {
      let result;
      if (transactionReference) {
        this.logger.log(`Verifying payment for transactionReference: ${transactionReference}`);
        result =
          await this.monnifyService.verifyPaymentAndUpdate(
            transactionReference,
          );
      } else if (paymentReference) {
        // Handle paymentReference if needed
        this.logger.log(`Verifying payment for paymentReference: ${paymentReference}`);
        result =
          await this.monnifyService.verifyByPaymentReference(paymentReference);
      }

      const params = new URLSearchParams({
        status: result.status,
        orderId: result.orderId,
        orderNumber: result.orderNumber,
      });
       const redirectUrl = `${frontendUrl}/payment/result?${params.toString()}`;
      console.log('Redirect URL - SUCCESS:', redirectUrl);

      return res.redirect(redirectUrl);
    } catch (error) {
      this.logger.error(`Callback error: ${error.message}`);
      const ref = transactionReference || paymentReference;
      console.log('Redirect URL - ERROR:', `${frontendUrl}/payment/error?reason=verification_failed&ref=${ref}`);
      return res.redirect(
        `${frontendUrl}/payment/error?reason=verification_failed&ref=${ref}`,
      );
    }
  }
  
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
