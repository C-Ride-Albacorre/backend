import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { MonnifyService } from './monnify.service';

@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly monnifyService: MonnifyService,
    private readonly configService: ConfigService,
  ) {}

  //@Get('/callback')
  // async paymentCallback(@Query() query, @Res() res: Response) {
  //   const { transactionReference } = query;

  //   if (!transactionReference) {
  //     return res.redirect(
  //       `${this.configService.get('FRONTEND_URL')}/payment/error`,
  //     );
  //   }

  //   // Redirect user to frontend with reference
  //   return res.redirect(
  //     `${this.configService.get('FRONTEND_URL')}/payment/result?ref=${transactionReference}`,
  //   );
  // }

  @Get('callback')
  async paymentCallback(
    @Query('transactionReference') transactionReference: string,
    @Res() res: Response,
  ) {
    if (!transactionReference) {
      // Redirect to frontend error page if no reference
      return res.redirect(
        `${this.configService.get('FRONTEND_URL')}/payment/error`,
      );
    }

    try {
      // Verify payment with Monnify and update DB
      const result =
        await this.monnifyService.verifyPaymentAndUpdate(transactionReference);

      // Redirect to frontend result page with status info
      return res.redirect(
        `${this.configService.get('FRONTEND_URL')}/payment/result?status=${result.status}&orderId=${result.orderId}&orderNumber=${result.orderNumber}`,
      );
    } catch (error) {
      // Redirect to frontend error page on failure
      return res.redirect(
        `${this.configService.get('FRONTEND_URL')}/payment/error`,
      );
    }
  }
}
