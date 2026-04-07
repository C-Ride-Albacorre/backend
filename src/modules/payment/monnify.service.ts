import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  InitializePaymentDto,
  MonnifyPaymentResponse,
  MonnifyWebhookDto,
} from '../customer/dto/payment.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';

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

    // Validate payment method early
    const allowedMethods = ['CARD', 'ACCOUNT_TRANSFER', 'USSD'];
    if (!dto.paymentMethod || !allowedMethods.includes(dto.paymentMethod)) {
      throw new BadRequestException('Invalid or missing payment method');
    }

    // Fetch order
    const order = await this.prisma.order.findFirst({
      where: {
        id: dto.orderId,
        userId,
      },
    });

    if (!order) {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }

    // Prevent re-initialization (idempotency guard)
    if (order.paymentReference) {
      throw new BadRequestException(
        'Payment already initialized for this order',
      );
    }

    if (order.paymentStatus !== 'PENDING') {
      throw new BadRequestException('Payment already processed');
    }

    // Fetch user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    if (!user.email) {
      throw new BadRequestException('User email is required for payment');
    }

    const accessToken = await this.getAccessToken();

    // Generate strong unique reference
    const paymentReference = `PAY-${randomUUID()}`;

    // Save INITIATING state before external call (safer pattern)
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        paymentReference,
        paymentStatus: 'INITIATING',
      },
    });

    const payload: any = {
      amount: order.totalAmount,
      customerName:
        `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer',
      customerEmail: user.email,
      paymentReference,
      paymentDescription: `Order ${order.orderNumber}`,
      currencyCode: 'NGN',
      contractCode: this.contractCode,
      redirectUrl:
        dto.callbackUrl ||
        `${this.configService.get('BACKEND_URI')}/api/v1/payment/callback`,
      paymentMethods: [dto.paymentMethod],
    };

    // Force correct structure for account transfer
    if (dto.paymentMethod === 'ACCOUNT_TRANSFER') {
      payload.paymentMethods = ['ACCOUNT_TRANSFER'];
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/merchant/transactions/init-transaction`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.data?.requestSuccessful) {
        throw new Error(response.data?.responseMessage || 'Unknown error');
      }

      const monnifyRef = response.data.responseBody?.transactionReference;

      // Final update after successful initialization
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          monnifyReference: monnifyRef,
          paymentStatus: 'PENDING', // revert from INITIATING → awaiting payment
        },
      });

      return response.data;
    } catch (error) {
      this.logger.error(
        `Payment initialization failed for order ${order.id}: ${error.message}`,
      );

      // Rollback INITIATING state (important)
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'FAILED',
        },
      });

      const message =
        error?.response?.data?.responseMessage ||
        error?.message ||
        'Payment initialization failed';

      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Handle Monnify webhook
   */
  async handleWebhook(
    webhookData: MonnifyWebhookDto,
    signature: string, // pass from controller header
  ) {
    this.logger.log(`Webhook received: ${webhookData.transactionReference}`);

    // ✅ 1. Verify signature
    const isValid = this.verifyWebhookSignature(webhookData, signature);

    if (!isValid) {
      this.logger.error('Invalid webhook signature');
      throw new HttpException('Invalid signature', HttpStatus.FORBIDDEN);
    }

    try {
      // ✅ 2. Find order
      const order = await this.prisma.order.findFirst({
        where: {
          monnifyReference: webhookData.transactionReference,
        },
      });

      if (!order) {
        this.logger.error(
          `Order not found: ${webhookData.transactionReference}`,
        );
        return { success: false };
      }

      // ✅ 3. Idempotency check
      if (order.paymentStatus === 'PAID') {
        this.logger.warn(`Webhook already processed for order ${order.id}`);
        return { success: true };
      }

      // ✅ 4. OPTIONAL: Verify with Monnify (recommended)
      const verification = await this.verifyPayment(
        webhookData.transactionReference,
      );

      const verifiedStatus = verification?.responseBody?.paymentStatus;

      if (verifiedStatus !== 'PAID') {
        this.logger.warn(
          `Verification mismatch for ${order.id}: ${verifiedStatus}`,
        );
        return { success: false };
      }

      // ✅ 5. Safe JSON parse
      let statusHistory = [];
      try {
        statusHistory = JSON.parse(order.statusHistory as string) || [];
      } catch {
        statusHistory = [];
      }

      statusHistory.push({
        status: 'CONFIRMED',
        timestamp: new Date().toISOString(),
        note: 'Payment confirmed via webhook',
      });

      // ✅ 6. Update order
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          orderStatus: 'CONFIRMED',
          statusHistory: JSON.stringify(statusHistory),
        },
      });

      this.logger.log(`Order ${order.orderNumber} marked as PAID`);

      return { success: true };
    } catch (error) {
      this.logger.error(
        `Webhook failed (${webhookData.transactionReference}): ${error.message}`,
      );

      return { success: false };
    }
  }

  private verifyWebhookSignature(payload: any, signature: string): boolean {
    const secret = this.configService.get<string>('MONNIFY_SECRET_KEY');

    const hash = crypto
      .createHmac('sha512', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return hash === signature;
  }

  /**
   * Verify payment status
   */
  async verifyPaymentAndUpdate(transactionReference: string) {
    const accessToken = await this.getAccessToken();

    try {
      // 1️⃣ Query Monnify for payment status
      const response = await axios.get(
        `${this.baseUrl}/api/v1/merchant/transactions/query`,
        {
          params: { transactionReference },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.data?.requestSuccessful) {
        throw new Error(
          response.data?.responseMessage || 'Verification failed',
        );
      }

      const paymentStatus = response.data.responseBody?.paymentStatus;

      // 2️⃣ Find order in database
      const order = await this.prisma.order.findFirst({
        where: { monnifyReference: transactionReference },
      });

      if (!order) {
        throw new NotFoundException('Order not found for this transaction');
      }

      // 3️⃣ Idempotency check
      if (order.paymentStatus === 'PAID') {
        return {
          status: 'PAID',
          message: 'Payment already processed',
          orderId: order.id,
        };
      }

      // 4️⃣ Update order if payment is confirmed
      if (paymentStatus === 'PAID') {
        let statusHistory = [];
        try {
          statusHistory = JSON.parse(order.statusHistory as string) || [];
        } catch {
          statusHistory = [];
        }

        statusHistory.push({
          status: 'CONFIRMED',
          timestamp: new Date().toISOString(),
          note: 'Payment verified via API',
        });

        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'PAID',
            orderStatus: 'CONFIRMED',
            statusHistory: JSON.stringify(statusHistory),
          },
        });
      }

      // 5️⃣ Return verification info
      return {
        status: paymentStatus,
        orderId: order.id,
        orderNumber: order.orderNumber,
      };
    } catch (error) {
      this.logger.error(
        `Payment verification failed (${transactionReference}): ${error.message}`,
      );
      throw new HttpException(
        'Payment verification failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async verifyPayment(transactionReference: string) {
    const accessToken = await this.getAccessToken();

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/merchant/transactions/query`,
        {
          params: { transactionReference },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.data?.requestSuccessful) {
        throw new Error(
          response.data?.responseMessage || 'Verification failed',
        );
      }

      return response.data;
    } catch (error) {
      this.logger.error(
        `Verification failed (${transactionReference}): ${error.message}`,
      );

      throw new HttpException(
        'Payment verification failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
