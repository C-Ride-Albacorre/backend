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
import axios from 'axios';
import {
  InitializePaymentDto,
  MonnifyPaymentResponse,
  MonnifyWebhookDto,
} from '../customer/dto/payment.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';
import { OrderStatus, PaymentStatus, Role } from '@prisma/client';
import { OrderService } from '../order/order.service';
import { NotificationService } from '../notification/notification.service';

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
    private readonly orderService: OrderService,
    private readonly notificationService: NotificationService,
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

    if (order.paymentStatus !== PaymentStatus.PENDING) {
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
        //paymentStatus: PaymentStatus.INITIATING,
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
          monnifyReference: response.data.responseBody.transactionReference,
          //  monnifyReference: monnifyRef,
          // paymentStatus: PaymentStatus.PENDING, // revert from INITIATING → awaiting payment
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
          paymentStatus: PaymentStatus.FAILED,
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
  // async handleWebhook(
  //   webhookData: MonnifyWebhookDto,
  //   signature: string, // pass from controller header
  // ) {
  async handleWebhook(rawBody: string, signature: string) {
    if (!this.verifyWebhookSignature(rawBody, signature)) {
      throw new ForbiddenException('Invalid signature');
    }
    // Parse after signature verification
    const webhookData = JSON.parse(rawBody);
    this.logger.log(`Webhook received: ${webhookData.transactionReference}`);

    // ✅ Validate signature FIRST
    if (!signature) {
      this.logger.error('Missing webhook signature');
      throw new HttpException('Missing signature', HttpStatus.FORBIDDEN);
    }

    this.logger.log('Webhook headers:', JSON.stringify(signature));
    this.logger.log('Webhook payload:', JSON.stringify(webhookData));
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
      if (order.paymentStatus === PaymentStatus.PAID) {
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
        status: OrderStatus.CONFIRMED,
        timestamp: new Date().toISOString(),
        note: 'Payment confirmed via webhook',
      });

      // ✅ 6. Update order
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.PAID,
          orderStatus: OrderStatus.CONFIRMED,
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

  // private verifyWebhookSignature(payload: any, signature: string): boolean {
  //   const secret = this.configService.get<string>('MONNIFY_SECRET_KEY');

  //   const hash = crypto
  //     .createHmac('sha512', secret)
  //     .update(JSON.stringify(payload))
  //     .digest('hex');

  //   return hash === signature;
  // }
  // In monnify.service.ts
  private verifyWebhookSignature(rawBody: any, signature: string): boolean {
    // const secretKey = this.configService.get<string>('MONNIFY_SECRET_KEY');

    const hash = crypto
      .createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');
    const cleanSig = signature.trim().replace(/^"|"$/g, '');
    return hash === cleanSig;
    // Clean the signature (remove any whitespace or quotes)
    // const cleanSignature = signature?.trim().replace(/^"|"$/g, '');

    // // Create the HMAC hash of the raw JSON string (not parsed object)
    // // Important: Use the raw request body, not the parsed body
    // // Pass the raw body from controller
    // const hash = crypto
    //   .createHmac('sha512', secret)
    //   .update(JSON.stringify(payload))
    //   .digest('hex');

    // return hash === cleanSignature;
  }

  // src/payment/services/monnify.service.ts (add these methods)

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

  /**
   * Get payment status for a transaction reference (without updating order)
   * Used by the GET /payment/status endpoint
   */
  async getPaymentStatus(transactionReference: string) {
    this.logger.log(
      `Getting payment status for reference: ${transactionReference}`,
    );

    if (!transactionReference) {
      throw new BadRequestException('Transaction reference is required');
    }

    // First check local database
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

    if (!order) {
      throw new NotFoundException('Transaction not found');
    }

    // Optional: Verify with Monnify for real-time status
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
        },
      );

      if (response.data?.requestSuccessful) {
        monnifyStatus = response.data.responseBody?.paymentStatus;
        monnifyData = response.data.responseBody;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch real-time status from Monnify: ${error.message}`,
      );
      // Don't throw - still return local status
    }

    return {
      order,
      monnifyStatus,
      monnifyData,
      isSynced: monnifyStatus === order.paymentStatus,
      lastChecked: new Date().toISOString(),
    };
  }

  /**
   * Verify payment using transactionReference and update order if needed
   * (Already exists, but ensure it's complete)
   */
  async verifyPaymentAndUpdate(transactionReference: string) {
    this.logger.log(
      `Verifying and updating payment for: ${transactionReference}`,
    );

    const accessToken = await this.getAccessToken();

    try {
      // Query Monnify for payment status
      const response = await axios.get(
        `${this.baseUrl}/api/v1/merchant/transactions/query`,
        {
          params: { transactionReference },
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      if (!response.data?.requestSuccessful) {
        throw new Error(
          response.data?.responseMessage || 'Verification failed',
        );
      }

      const paymentStatus = response.data.responseBody?.paymentStatus;
      const monnifyReference = response.data.responseBody?.transactionReference;

      // Find order in database
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

      // Idempotency check
      if (order.paymentStatus === 'PAID') {
        return {
          status: 'PAID',
          message: 'Payment already processed',
          orderId: order.id,
          orderNumber: order.orderNumber,
        };
      }

      // Update order if payment is confirmed
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
            monnifyReference: monnifyReference || order.monnifyReference,
            statusHistory: JSON.stringify(statusHistory),
          },
        });

        // Trigger order placed event (if you have OrderService injected)
        if (this.orderService) {
          await this.orderService.transition(
            order.id,
            OrderStatus.ORDER_PLACED,
            {
              actorId: order.userId,
              actorRole: 'CUSTOMER',
            },
          );
        }

        // Notify vendors
        if (this.notificationService) {
          await this.notificationService.notifyVendorsForOrder(order.id);
        }

        this.logger.log(
          `Order ${order.orderNumber} marked as PAID via verification`,
        );
      }

      return {
        status: paymentStatus,
        orderId: order.id,
        orderNumber: order.orderNumber,
      };
    } catch (error) {
      this.logger.error(`Payment verification failed: ${error.message}`);
      throw new HttpException(
        error.message || 'Payment verification failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Verify payment status
   */
  // async verifyPaymentAndUpdate(transactionReference: string) {
  //   const accessToken = await this.getAccessToken();

  //   try {
  //     // 1️⃣ Query Monnify for payment status
  //     const response = await axios.get(
  //       `${this.baseUrl}/api/v1/merchant/transactions/query`,
  //       {
  //         params: { transactionReference },
  //         headers: {
  //           Authorization: `Bearer ${accessToken}`,
  //         },
  //       },
  //     );

  //     if (!response.data?.requestSuccessful) {
  //       throw new Error(
  //         response.data?.responseMessage || 'Verification failed',
  //       );
  //     }

  //     const paymentStatus = response.data.responseBody?.paymentStatus;

  //     // 2️⃣ Find order in database
  //     const order = await this.prisma.order.findFirst({
  //       where: { monnifyReference: transactionReference },
  //     });

  //     if (!order) {
  //       throw new NotFoundException('Order not found for this transaction');
  //     }

  //     // 3️⃣ Idempotency check
  //     if (order.paymentStatus === PaymentStatus.PAID) {
  //       return {
  //         status: 'PAID',
  //         message: 'Payment already processed',
  //         orderId: order.id,
  //       };
  //     }

  //     // 4️⃣ Update order if payment is confirmed
  //     if (paymentStatus === PaymentStatus.PAID) {
  //       let statusHistory = [];
  //       try {
  //         statusHistory = JSON.parse(order.statusHistory as string) || [];
  //       } catch {
  //         statusHistory = [];
  //       }

  //       statusHistory.push({
  //         status: 'CONFIRMED',
  //         timestamp: new Date().toISOString(),
  //         note: 'Payment verified via API',
  //       });

  //       await this.prisma.order.update({
  //         where: { id: order.id },
  //         data: {
  //           paymentStatus: 'PAID',
  //           orderStatus: 'CONFIRMED',
  //           statusHistory: JSON.stringify(statusHistory),
  //         },
  //       });

  //       // ✅ ADD THIS HERE (after DB commit)
  //       await this.orderService.transition(order.id, OrderStatus.ORDER_PLACED, {
  //         actorId: order.userId,
  //         actorRole: Role.CUSTOMER,
  //       });

  //       await this.notificationService.notifyVendorsForOrder(order.id);
  //     }

  //     // 5️⃣ Return verification info
  //     return {
  //       status: paymentStatus,
  //       orderId: order.id,
  //       orderNumber: order.orderNumber,
  //     };
  //   } catch (error) {
  //     this.logger.error(
  //       `Payment verification failed (${transactionReference}): ${error.message}`,
  //     );
  //     throw new HttpException(
  //       'Payment verification failed',
  //       HttpStatus.BAD_REQUEST,
  //     );
  //   }
  // }

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

  //   async getPaymentStatus(transactionReference: string) {
  //     if (!transactionReference) {
  //       throw new BadRequestException('Transaction reference is required');
  //     }

  //     const order = await this.prisma.order.findFirst({
  //       where: { monnifyReference: transactionReference },
  //     });

  //     if (!order) {
  //       throw new NotFoundException('Order not found');
  //     }

  //     return {
  //       status: order.paymentStatus,
  //       orderId: order.id,
  //       orderNumber: order.orderNumber,
  //     };
  //   }
  // }

  // In monnify.service.ts
  // async getPaymentStatus(transactionReference: string) {
  //   const order = await this.prisma.order.findFirst({
  //     where: { monnifyReference: transactionReference },
  //     select: {
  //       id: true,
  //       orderNumber: true,
  //       paymentStatus: true,
  //       orderStatus: true,
  //       totalAmount: true,
  //       monnifyReference: true,
  //       paymentReference: true,
  //     },
  //   });

  //   if (!order) {
  //     throw new NotFoundException('Transaction not found');
  //   }

  //   // Optional: Verify with Monnify for real-time status
  //   const accessToken = await this.getAccessToken();
  //   const response = await axios.get(
  //     `${this.baseUrl}/api/v1/merchant/transactions/query`,
  //     {
  //       params: { transactionReference },
  //       headers: { Authorization: `Bearer ${accessToken}` },
  //     },
  //   );

  //   return {
  //     order,
  //     monnifyStatus: response.data?.responseBody?.paymentStatus,
  //   };
  // }
}
