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
import { PrismaService } from '../../shared/services/prisma.service';

@ApiTags('Payment')
@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly monnifyService: MonnifyService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
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
async paymentCallbackNew(
  @Query('transactionReference') transactionReference: string,
  @Query('paymentReference') paymentReference: string,
  @Res() res: Response,
) {
  const frontendUrl = this.configService.get('FRONTEND_URL');
  const ref = transactionReference || paymentReference;

  let orderId = '';

  console.log('Callback received:', {
    transactionReference,
    paymentReference,
  });

  try {
    if (!ref) {
      return res.redirect(
        `${frontendUrl}/payment/error?reason=missing_reference`,
      );
    }

    // ── Pre-resolve the order so orderId is never empty on error ──
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          { monnifyReference: ref },
          { paymentReference: ref },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        monnifyReference: true,
      },
    });
    orderId = order?.id || '';

    console.log('Pre-resolved orderId:', orderId);

    let result;

    if (transactionReference) {
      result = await this.monnifyService.verifyPaymentAndUpdate(
        transactionReference,
      );
    } else if (paymentReference) {
      result = await this.monnifyService.verifyByPaymentReference(
        paymentReference,
      );
    } else {
      return res.redirect(
        `${frontendUrl}/payment/error?reason=missing_reference`,
      );
    }

    // Keep the original assignment as a fallback in case the service
    // returns a different id than we pre-resolved.
    orderId = result?.orderId || orderId;

    console.log('Verification result:', result);
    console.log('Resolved orderId:', orderId);

    const params = new URLSearchParams({
      status: result.status || 'UNKNOWN',
      orderId,
      orderNumber: result.orderNumber || '',
    });

    return res.redirect(
      `${frontendUrl}/payment/result?${params.toString()}`,
    );

  } catch (error) {
    console.error('Payment callback error:', error);

    // orderId was resolved before verification, so it survives the throw.
    const params = new URLSearchParams({
      reason: 'verification_failed',
      ref: ref || '',
      orderId,
    });

    return res.redirect(
      `${frontendUrl}/payment/error?${params.toString()}`,
    );
  }
}

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

      let orderId = '';

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
      orderId = result.orderId;

      let params = new URLSearchParams({
        status: result.status,
        orderId: result.orderId,
        orderNumber: result.orderNumber,
      });
       const redirectUrl = `${frontendUrl}/payment/result?${params.toString()}`;
      console.log('Redirect URL - SUCCESS:', redirectUrl);

      return res.redirect(redirectUrl);
    } catch (error) {
      this.logger.error(`Callback error: ${error}`);
      const ref = transactionReference || paymentReference;
      console.log('Redirect URL - ERROR:', `${frontendUrl}/payment/error?reason=verification_failed&ref=${ref}`);
      return res.redirect(
        `${frontendUrl}/payment/error?reason=verification_failed&ref=${ref}&orderId=${orderId}`,
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
