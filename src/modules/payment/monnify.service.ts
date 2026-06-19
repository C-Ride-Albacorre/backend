// monnify.service.ts
import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/services/prisma.service';
import { OrderService } from '../order/order.service';
import { NotificationService } from '../notification/notification.service';
import {
  InitializePaymentDto,
  MonnifyPaymentResponse,
} from '../customer/dto/payment.dto';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import axios, { AxiosError } from 'axios';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';

@Injectable()
export class MonnifyService {
  private readonly logger = new Logger(MonnifyService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly contractCode: string;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly notificationService: NotificationService,
  ) {
    this.baseUrl = this.configService.get<string>('MONNIFY_BASE_URL')!;
    this.apiKey = this.configService.get<string>('MONNIFY_API_KEY')!;
    this.secretKey = this.configService.get<string>('MONNIFY_SECRET_KEY')!;
    this.contractCode = this.configService.get<string>(
      'MONNIFY_CONTRACT_CODE',
    )!;
  }

  // ==================== AUTHENTICATION ====================

  private async getAccessToken(): Promise<string> {
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
          headers: { Authorization: `Basic ${auth}` },
          timeout: 10000,
        },
      );

      if (response.data.requestSuccessful) {
        this.accessToken = response.data.responseBody.accessToken;
        this.tokenExpiry = new Date(Date.now() + 55 * 60 * 1000); // 55 minutes
        return this.accessToken;
      } else {
        throw new Error('Monnify login failed');
      }
    } catch (error) {
      this.logger.error(`Failed to get access token: ${error instanceof Error ? error.stack : String(error)}`);
      throw new HttpException(
        'Payment service unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  // ==================== PAYMENT INITIALIZATION (FIXED RACE CONDITION) ====================

  async initializePayment(
    userId: string,
    dto: InitializePaymentDto,
  ): Promise<MonnifyPaymentResponse> {
    this.logger.log(`Initializing payment for order: ${dto.orderId}`);

    // Validate payment method
    const allowedMethods = ['CARD', 'ACCOUNT_TRANSFER', 'USSD'];
    if (!dto.paymentMethod || !allowedMethods.includes(dto.paymentMethod)) {
      throw new BadRequestException('Invalid or missing payment method');
    }

    // Use transaction with row-level locking (Prisma's `$transaction` + `FOR UPDATE`)
    return await this.prisma.$transaction(async (tx) => {
      // 1. Lock and fetch order
      const order = await tx.order.findUnique({
        where: { id: dto.orderId },
      });
      // Manually add FOR UPDATE (Prisma does not support it directly, use raw query)
      // Alternative: Use `select ... for update` via $queryRaw
      await tx.$queryRaw`SELECT 1 FROM "Order" WHERE id = ${order?.id} FOR UPDATE`;

      if (!order) {
        throw new NotFoundException('Order not found');
      }
      if (order.userId !== userId) {
        throw new ForbiddenException('Order does not belong to user');
      }
      if (order.paymentReference) {
        throw new BadRequestException(
          'Payment already initialized for this order',
        );
      }
      if (order.paymentStatus !== PaymentStatus.PENDING) {
        throw new BadRequestException('Payment already processed');
      }

      // 2. Fetch user
      const user = await tx.user.findUnique({
        where: { id: userId },
      });
      if (!user || !user.email) {
        throw new BadRequestException('User email is required for payment');
      }

      // 3. Generate references
      const paymentReference = `PAY-${randomUUID()}`;
      const accessToken = await this.getAccessToken();

      // 4. Call Monnify
      const payload = {
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

      try {
        const response = await axios.post(
          `${this.baseUrl}/api/v1/merchant/transactions/init-transaction`,
          payload,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 15000,
          },
        );

        if (!response.data?.requestSuccessful) {
          throw new Error(
            response.data?.responseMessage || 'Monnify initialization failed',
          );
        }

        const monnifyReference =
          response.data.responseBody.transactionReference;

        // 5. Update order within transaction (both references now)
        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentReference,
            monnifyReference,
            // Keep paymentStatus = PENDING (waiting for payment)
          },
        });

        return response.data as MonnifyPaymentResponse;
      } catch (error) {
        this.logger.error(`Monnify API call failed: ${error instanceof Error ? error.stack : String(error)}`);
        // Rollback is automatic because transaction will abort
        throw new HttpException(
          this.extractMonnifyErrorMessage(error),
          HttpStatus.BAD_REQUEST,
        );
      }
    });
  }

  // ==================== WEBHOOK (FIXED SIGNATURE + IDEMPOTENCY) ====================
  async handleWebhook(
    rawBody: string,
    signature: string,
  ): Promise<{ success: true }> {
    this.logger.log('Processing webhook');

    // 1. Verify signature using rawBody
    if (!this.verifyWebhookSignature(rawBody, signature)) {
      this.logger.error('Invalid webhook signature');
      throw new ForbiddenException('Invalid signature');
    }

    let webhookData: any;
    try {
      webhookData = JSON.parse(rawBody);
    } catch (e) {
      throw new BadRequestException('Invalid JSON payload');
    }

    this.logger.log(`Full webhook payload: ${JSON.stringify(webhookData)}`);

    // 2. Extract transactionReference from the nested eventData object
    let transactionRef = webhookData.transactionReference;
    if (!transactionRef && webhookData.eventData) {
      transactionRef = webhookData.eventData.transactionReference;
    }

    if (!transactionRef) {
      // Ignore test webhooks or non-payment events
      if (webhookData.eventType === 'TEST' || webhookData.test === true) {
        this.logger.log('Ignoring test webhook');
        return { success: true };
      }
      this.logger.error(
        `Missing transactionReference in webhook: ${JSON.stringify(webhookData)}`,
      );
      throw new BadRequestException('Missing transactionReference');
    }

    this.logger.log(`Webhook received for transaction: ${transactionRef}`);

    // 3. Find order using transactionReference (monnifyReference)
    const order = await this.prisma.order.findFirst({
      where: { monnifyReference: transactionRef },
    });

    if (!order) {
      this.logger.error(`Order not found for transaction: ${transactionRef}`);
      // A 404 will prompt Monnify to retry.
      throw new NotFoundException(
        `Order not found for reference ${transactionRef}`,
      );
    }

    // 4. Idempotent update – only if payment is still PENDING
    const result = await this.prisma.order.updateMany({
      where: { id: order.id, paymentStatus: PaymentStatus.PENDING },
      data: {
        paymentStatus: PaymentStatus.PAID,
        orderStatus: OrderStatus.CONFIRMED,
        statusHistory: {
          push: {
            status: OrderStatus.CONFIRMED,
            timestamp: new Date().toISOString(),
            note: 'Payment confirmed via webhook',
          },
        },
      },
    });

    if (result.count === 0) {
      this.logger.warn(`Webhook already processed for order ${order.id}`);
      // Return success so Monnify doesn't retry
      return { success: true };
    }

    // 5. VERIFICATION - Re-query Monnify API as a final safety check
    // This protects against forged webhook requests, even if the signature is valid.
    const verification = await this.verifyPayment(transactionRef);
    if (verification?.responseBody?.paymentStatus !== 'PAID') {
      // Rollback the database update if the official API check fails
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.PENDING,
          orderStatus: OrderStatus.PENDING,
        },
      });
      this.logger.error(
        `Verification mismatch for order ${order.id}: ${verification?.responseBody?.paymentStatus}`,
      );
      throw new BadRequestException('Payment verification failed');
    }

    // 6. Trigger business logic
    this.logger.log(`Order ${order.orderNumber} marked as PAID via webhook, triggering business logic`);
    await this.orderService
      .transition(order.id, OrderStatus.ORDER_PLACED, {
        actorId: order.userId,
        actorRole: 'CUSTOMER',
      })
      .catch((e) => this.logger.error(`Transition failed: ${e.message}`));

    this.logger.log(`Notifying vendors for order ${order.orderNumber}`);
    await this.notificationService
      .notifyVendorsForOrder(order.id)
      .catch((e) =>
        this.logger.error(`Vendor notification failed: ${e.message}`),
      );
    this.logger.log(`Notifying customer for order ${order.orderNumber}`);
    await this.notificationService
      .notifyCustomerForOrder(order.id)
      .catch((e) =>
        this.logger.error(`Customer notification failed: ${e.message}`),
      );

    this.logger.log(`Order ${order.orderNumber} marked as PAID via webhook`);
    return { success: true };
  }

  private verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = this.secretKey;
    // Clean the signature (remove any surrounding whitespace or quotes)
    const cleanSignature = signature?.trim().replace(/^"|"$/g, '');
    // Hash the exact raw body string
    const hash = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');
    const isValid = hash === cleanSignature;

    if (!isValid) {
      this.logger.warn(
        `Signature verification failed. Expected: ${hash}, Received: ${cleanSignature}`,
      );
    }
    return isValid;
  }


  // ==================== VERIFICATION & CALLBACK ====================

  async verifyPaymentAndUpdate(transactionReference: string) {
    this.logger.log(
      `Verifying and updating for transaction: ${transactionReference}`,
    );

    // Find order by monnifyReference or paymentReference
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          { monnifyReference: transactionReference },
          { paymentReference: transactionReference },
        ],
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found for this transaction');
    }

    // Idempotent update
    const result = await this.prisma.order.updateMany({
      where: {
        id: order.id,
        paymentStatus: PaymentStatus.PENDING,
      },
      data: {
        paymentStatus: PaymentStatus.PAID,
        orderStatus: OrderStatus.CONFIRMED,
        statusHistory: {
          push: {
            status: OrderStatus.CONFIRMED,
            timestamp: new Date().toISOString(),
            note: 'Payment verified via callback',
          },
        },
      },
    });

    if (result.count === 0) {
      // Already paid
      this.logger.warn(`Payment already processed for order ${order.id}`);
      return {
        status: 'PAID',
        message: 'Payment already processed',
        orderId: order.id,
        orderNumber: order.orderNumber,
      };
    }

    // Re-verify with Monnify (optional but recommended)
    this.logger.log(`Re-verifying payment with Monnify for order ${order.orderNumber}`);
    const verification = await this.verifyPayment(transactionReference);
    if (verification?.responseBody?.paymentStatus !== 'PAID') {
      // Rollback
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.PENDING,
          orderStatus: OrderStatus.PENDING,
        },
      });
      throw new BadRequestException('Payment not confirmed by Monnify');
    }

    this.logger.log(`Transitioning order ${order.orderNumber} to CONFIRMED`);
    // Business logic
    await this.orderService
      .transition(order.id, OrderStatus.ORDER_PLACED, {
        actorId: order.userId,
        actorRole: 'CUSTOMER',
      })
      .catch((e) => this.logger.error(e));

    this.logger.log(`Notifying vendors for order ${order.orderNumber}`);
    await this.notificationService
      .notifyVendorsForOrder(order.id)
      .catch((e) => this.logger.error(e));

    return {
      status: 'PAID',
      orderId: order.id,
      orderNumber: order.orderNumber,
    };
  }

  async verifyPayment(transactionReference: string) {
    this.logger.log(`Verifying payment for transactionReference: ${transactionReference}`);
    const accessToken = await this.getAccessToken();
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/merchant/transactions/query`,
        {
          params: { transactionReference },
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 10000,
        },
      );
      if (!response.data?.requestSuccessful) {
        throw new Error(response.data?.responseMessage);
      }
      return response.data;
    } catch (error) {
      this.logger.error(`Verification failed: ${error instanceof Error ? error.stack : String(error)}`);
      throw new HttpException(
        'Payment verification failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async getPaymentStatus(transactionReference: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          { monnifyReference: transactionReference },
          { paymentReference: transactionReference },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        paymentStatus: true,
        orderStatus: true,
        totalAmount: true,
        monnifyReference: true,
        paymentReference: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!order) throw new NotFoundException('Transaction not found');

    let monnifyStatus = null;
    let monnifyData = null;
    try {
      const accessToken = await this.getAccessToken();
      const response = await axios.get(
        `${this.baseUrl}/api/v1/merchant/transactions/query`,
        {
          params: {
            transactionReference:
              order.monnifyReference || order.paymentReference,
          },
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 5000,
        },
      );
      if (response.data?.requestSuccessful) {
        monnifyStatus = response.data.responseBody.paymentStatus;
        monnifyData = response.data.responseBody;
      }
    } catch (error) {
      this.logger.warn(`Could not fetch real-time status: ${error instanceof Error ? error.stack : String(error)}`);
    }
    return {
      order,
      monnifyStatus,
      monnifyData,
      isSynced: monnifyStatus === order.paymentStatus,
      lastChecked: new Date().toISOString(),
    };
  }

  // Helper to extract Monnify error message
  private extractMonnifyErrorMessage(error: any): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const data = axiosError.response?.data as any;
      return data?.responseMessage || data?.message || axiosError.message;
    }
    return error.message || 'Payment initialization failed';
  }

  /**
   * Verify payment using paymentReference (instead of transactionReference)
   * Useful for callback flows where only paymentReference is available
   */
  async verifyByPaymentReference(paymentReference: string) {
    this.logger.log(`Verifying payment by reference: ${paymentReference}`);

    if (!paymentReference) {
      throw new BadRequestException('Payment reference is required');
    }

    // Find order by paymentReference (the one we generated: PAY-xxx)
    const order = await this.prisma.order.findFirst({
      where: { paymentReference },
    });

    if (!order) {
      throw new NotFoundException(
        `Order not found for payment reference: ${paymentReference}`,
      );
    }

    // Use transactionReference (Monnify's reference) if available, otherwise query by paymentReference
    if (order.monnifyReference) {
      return this.verifyPaymentAndUpdate(order.monnifyReference);
    }

    // If no monnifyReference, we need to query Monnify using paymentReference
    // Note: Monnify API typically uses transactionReference, not paymentReference.
    // Alternative: fetch transaction by paymentReference via their API if supported.
    // For now, we'll attempt to use the paymentReference as the transactionReference
    // (Monnify sometimes uses the same value if you set it that way)
    return this.verifyPaymentAndUpdate(paymentReference);
  }
}
