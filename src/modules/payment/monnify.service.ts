// src/payment/services/monnify.service.ts
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  InitializePaymentDto,
  MonnifyPaymentResponse,
  MonnifyWebhookDto,
} from '../customer/dto/payment.dto';
import { PrismaService } from '../../shared/services/prisma.service';

@Injectable()
export class MonnifyService {
  private readonly logger = new Logger(MonnifyService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly contractCode: string;
  private accessToken: string;
  private tokenExpiry: Date;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.baseUrl = this.configService.get<string>('MONNIFY_BASE_URL');
    this.apiKey = this.configService.get<string>('MONNIFY_API_KEY');
    this.secretKey = this.configService.get<string>('MONNIFY_SECRET_KEY');
    this.contractCode = this.configService.get<string>('MONNIFY_CONTRACT_CODE');
  }

  /**
   * Get access token from Monnify
   */
  private async getAccessToken(): Promise<string> {
    // Check if token is still valid
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.accessToken;
    }

    try {
      const auth = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString(
        'base64',
      );

      const response = await axios.post(
        `${this.baseUrl}/api/v1/auth/login`,
        {},
        {
          headers: {
            Authorization: `Basic ${auth}`,
          },
        },
      );

      if (response.data.requestSuccessful) {
        this.accessToken = response.data.responseBody.accessToken;
        // Set expiry (typically 1 hour)
        this.tokenExpiry = new Date(Date.now() + 55 * 60 * 1000); // 55 minutes
        return this.accessToken;
      } else {
        throw new Error('Failed to get access token');
      }
    } catch (error) {
      this.logger.error(`Failed to get Monnify access token: ${error.message}`);
      throw new HttpException(
        'Payment service unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Initialize payment
   */
  async initializePayment(
    userId: string,
    dto: InitializePaymentDto,
  ): Promise<MonnifyPaymentResponse> {
    this.logger.log(`Initializing payment for order: ${dto.orderId}`);

    // Get order details
    const order = await this.prisma.order.findFirst({
      where: {
        id: dto.orderId,
        userId,
      },
    });

    if (!order) {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }

    if (order.paymentStatus !== 'PENDING') {
      throw new HttpException(
        'Payment already processed',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Get user details for payment
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    const accessToken = await this.getAccessToken();

    try {
      const paymentReference = `PAY-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const payload: any = {
        amount: order.totalAmount,
        customerName: `${user.firstName} ${user.lastName}`.trim() || 'Customer',
        customerEmail: user.email || 'customer@example.com',
        paymentReference,
        paymentDescription: `Order ${order.orderNumber}`,
        currencyCode: 'NGN',
        contractCode: this.contractCode,
        redirectUrl:
          dto.callbackUrl ||
          this.configService.get('APP_URL') + '/payment/callback',
        paymentMethods: [dto.paymentMethod],
      };

      // Add specific fields based on payment method
      if (dto.paymentMethod === 'ACCOUNT_TRANSFER') {
        payload.paymentMethods = ['ACCOUNT_TRANSFER'];
      }

      const response = await axios.post(
        `${this.baseUrl}/api/v1/merchant/transactions/init-transaction`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (response.data.requestSuccessful) {
        // Update order with payment reference
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            paymentReference,
            monnifyReference: response.data.responseBody.transactionReference,
          },
        });

        return response.data;
      } else {
        throw new Error(response.data.responseMessage);
      }
    } catch (error) {
      this.logger.error(`Payment initialization failed: ${error.message}`);
      throw new HttpException(
        error.response?.data?.responseMessage ||
          'Payment initialization failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Handle Monnify webhook
   */
  async handleWebhook(webhookData: MonnifyWebhookDto) {
    this.logger.log(
      `Received Monnify webhook: ${webhookData.transactionReference}`,
    );

    // Verify webhook signature (in production)
    // const signature = req.headers['monnify-signature'];
    // Verify signature using your secret key

    try {
      // Find order by payment reference
      const order = await this.prisma.order.findFirst({
        where: {
          monnifyReference: webhookData.transactionReference,
        },
      });

      if (!order) {
        this.logger.error(
          `Order not found for reference: ${webhookData.transactionReference}`,
        );
        return { success: false };
      }

      // Update order based on payment status
      const paymentStatus =
        webhookData.paymentStatus === 'PAID' ? 'PAID' : 'FAILED';

      const statusHistory = JSON.parse(order.statusHistory as string) || [];
      statusHistory.push({
        status: paymentStatus === 'PAID' ? 'CONFIRMED' : 'PAYMENT_FAILED',
        timestamp: new Date().toISOString(),
        note: `Payment ${paymentStatus.toLowerCase()}`,
      });

      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus,
          orderStatus: paymentStatus === 'PAID' ? 'CONFIRMED' : 'PENDING',
          statusHistory: JSON.stringify(statusHistory),
        },
      });

      this.logger.log(`Order ${order.orderNumber} payment ${paymentStatus}`);

      return { success: true };
    } catch (error) {
      this.logger.error(`Webhook processing failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify payment status
   */
  async verifyPayment(transactionReference: string) {
    const accessToken = await this.getAccessToken();

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/merchant/transactions/query?transactionReference=${transactionReference}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Payment verification failed: ${error.message}`);
      throw new HttpException(
        'Payment verification failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
