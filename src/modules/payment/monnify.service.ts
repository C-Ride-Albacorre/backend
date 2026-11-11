// monnify.service.ts
import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
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
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class MonnifyService {
  private readonly logger = new Logger(MonnifyService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly contractCode: string;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

private tokenPromise: Promise<string> | null = null; // ← mutex
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => WalletService))
    private readonly walletService: WalletService
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
  // Fast path: cached & valid
  if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
    return this.accessToken;
  }

  // Mutex: if a refresh is in-flight, wait for it instead of firing another login
  if (this.tokenPromise) {
    return this.tokenPromise;
  }

  this.tokenPromise = (async () => {
    try {
      this.logger.log('Fetching Monnify access token');
      const auth = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString('base64');
      const response = await axios.post(
        `${this.baseUrl}/api/v1/auth/login`,
        {},
        { headers: { Authorization: `Basic ${auth}` }, timeout: 10000 },
      );

      if (!response.data?.requestSuccessful) {
        throw new Error('Monnify login failed');
      }

      this.accessToken = response.data.responseBody.accessToken;
      // 45 min buffer — Monnify tokens are 60 min; leave 15 min safety margin
      this.tokenExpiry = new Date(Date.now() + 45 * 60 * 1000);
      return this.accessToken!;
    } catch (error) {
      this.logger.error(
        `Failed to get access token: ${error instanceof Error ? error.stack : String(error)}`,
      );
      throw new HttpException('Payment service unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    } finally {
      this.tokenPromise = null; // release mutex
    }
  })();

  return this.tokenPromise;
}

/** Force a cache clear so the next call refetches. */
private invalidateToken() {
  this.accessToken = null;
  this.tokenExpiry = null;
}



  // ==================== PAYMENT INITIALIZATION (FIXED RACE CONDITION) ====================
private async postToMonnify<T = any>(url: string, payload: any, timeoutMs = 15000): Promise<T> {
  const attempt = async (): Promise<T> => {
    const token = await this.getAccessToken();
    return (await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: timeoutMs,
    })).data;
  };

  try {
    return await attempt();
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      this.logger.warn('Monnify 401 — refreshing token and retrying once');
      this.invalidateToken();
      return await attempt(); // one retry with fresh token
    }
    throw error;
  }
}

  async initializePayment(
  userId: string,
  dto: InitializePaymentDto,
): Promise<MonnifyPaymentResponse> {
  this.logger.log(`Initializing payment for order: ${dto.orderId}`);

  const allowedMethods = ['CARD', 'ACCOUNT_TRANSFER', 'USSD'];
  if (!dto.paymentMethod || !allowedMethods.includes(dto.paymentMethod)) {
    throw new BadRequestException('Invalid or missing payment method');
  }

  // ---------- PHASE 1: short transaction — reserve the reference ----------
  const reservation = await this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Order" WHERE id = ${dto.orderId} FOR UPDATE`;

    const order = await tx.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('Order does not belong to user');
    if (order.paymentReference) {
      throw new BadRequestException('Payment already initialized for this order');
    }
    if (order.paymentStatus !== PaymentStatus.PENDING) {
      throw new BadRequestException('Payment already processed');
    }

    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const customerEmail = dto.email?.trim() || user.email?.trim();
    if (!customerEmail) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'EMAIL_REQUIRED_FOR_PAYMENT',
        message: 'Please provide your email address to continue with payment.',
      });
    }

    if (!user.email?.trim()) {
      await tx.user.update({ where: { id: userId }, data: { email: customerEmail } });
    }

    const paymentReference = `PAY-${randomUUID()}`;

    // Reserve: set paymentReference now, monnifyReference later
    await tx.order.update({
      where: { id: order.id },
      data: { paymentReference },
    });

    return { order, user, customerEmail, paymentReference };
  });

  const { order, user, customerEmail, paymentReference } = reservation;

  // ---------- PHASE 2: external call (no DB lock held) ----------
  const payload = {
    amount: order.totalAmount,
    customerName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer',
    customerEmail,
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
    const data = await this.postToMonnify<any>(
      `${this.baseUrl}/api/v1/merchant/transactions/init-transaction`,
      payload,
    );
    if (!data?.requestSuccessful) {
      throw new Error(data?.responseMessage || 'Monnify initialization failed');
    }

    const monnifyReference = data.responseBody.transactionReference;

    // ---------- PHASE 3: short transaction — persist monnifyReference ----------
    await this.prisma.order.update({
      where: { id: order.id },
      data: { monnifyReference },
    });

    return data as MonnifyPaymentResponse;
  } catch (error) {
    // Roll back the reservation so the user can retry
    await this.prisma.order
      .update({
        where: { id: order.id },
        data: { paymentReference: null },
      })
      .catch((e) => this.logger.error(`Failed to release reservation: ${e.message}`));

    if (axios.isAxiosError(error)) {
      this.logger.error(`Monnify HTTP ${error.response?.status}: ${JSON.stringify(error.response?.data)}`);
    } else {
      this.logger.error(error instanceof Error ? error.message : String(error));
    }

    throw new HttpException(
      this.extractMonnifyErrorMessage(error),
      HttpStatus.BAD_REQUEST,
    );
  }
}

  // ==================== WEBHOOK (FIXED SIGNATURE + IDEMPOTENCY) ====================
  async handleWebhook(
  rawBody: string,
  signature: string,
): Promise<{ success: true }> {
  this.logger.log('Processing webhook');

  // ── 1. Verify signature ──
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

  const eventData = webhookData.eventData;
  const metadata = eventData.metaData || {};
  const paymentReference = eventData.paymentReference;
  const paymentStatus = eventData.paymentStatus;

  // ── 2. Wallet funding route (unchanged) ──
  if (
    metadata.walletTxId ||
    metadata.entityType === 'wallet' ||
    paymentReference?.startsWith('FUND-')
  ) {
    await this.walletService.handleFundingWebhook(
      eventData.transactionReference,
      paymentStatus,
      { paymentReference, walletTxId: metadata.walletTxId },
    );
    return { success: true };
  }

  this.logger.log(`Full webhook payload: ${JSON.stringify(webhookData)}`);

  // ── 3. Extract transactionReference ──
  let transactionRef = webhookData.transactionReference;
  if (!transactionRef && webhookData.eventData) {
    transactionRef = webhookData.eventData.transactionReference;
  }

  if (!transactionRef) {
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

  // ── 4. Find the order ──
  const order = await this.prisma.order.findFirst({
    where: { monnifyReference: transactionRef },
  });
  if (!order) {
    this.logger.error(`Order not found for transaction: ${transactionRef}`);
    throw new NotFoundException(
      `Order not found for reference ${transactionRef}`,
    );
  }

  // ── 5. Idempotent payment status update — PAYMENT ONLY, not order status ──
  const paymentUpdate = await this.prisma.order.updateMany({
    where: { id: order.id, paymentStatus: PaymentStatus.PENDING },
    data: {
      paymentStatus: PaymentStatus.PAID,
      paymentReference: paymentReference ?? order.paymentReference,
    },
  });

  if (paymentUpdate.count === 0) {
    this.logger.warn(`Webhook already processed for order ${order.id}`);
    return { success: true };
  }

  // ── 6. Verify with Monnify (final safety) ──
  const verification = await this.verifyPayment(transactionRef);
  if (verification?.responseBody?.paymentStatus !== 'PAID') {
    // Rollback payment status only
    await this.prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: PaymentStatus.PENDING },
    });
    this.logger.error(
      `Verification mismatch for order ${order.id}: ${verification?.responseBody?.paymentStatus}`,
    );
    throw new BadRequestException('Payment verification failed');
  }

  // ── 7. Transition ORDER_PLACED → CONFIRMED (this is the REAL status change) ──
  this.logger.log(
    `Order ${order.orderNumber} marked as PAID, transitioning to CONFIRMED`,
  );
  try {
    await this.orderService.transition(order.id, OrderStatus.CONFIRMED, {
      actorId: order.userId,
      actorRole: 'CUSTOMER',
      reason: 'Payment confirmed via webhook',
    });
  } catch (err) {
    // If it's already CONFIRMED, that's fine (idempotency)
    if (
      err instanceof BadRequestException &&
      String(err.message).includes('Invalid transition')
    ) {
      this.logger.warn(
        `Order ${order.id} already CONFIRMED; skipping transition`,
      );
    } else {
      this.logger.error(
        `Transition failed for order ${order.id}: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }
  }

  // ── 8. Notify vendors and customer ──
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



  async handleWebhookWithoutWalletInclusion(
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

  // Idempotent payment status update
  const paymentUpdate = await this.prisma.order.updateMany({
    where: { id: order.id, paymentStatus: PaymentStatus.PENDING },
    data: { paymentStatus: PaymentStatus.PAID },
  });

  if (paymentUpdate.count === 0) {
    this.logger.warn(`Payment already processed for order ${order.id}`);
    return {
      status: 'PAID',
      message: 'Payment already processed',
      orderId: order.id,
      orderNumber: order.orderNumber,
    };
  }

  // Verify with Monnify
  this.logger.log(
    `Re-verifying payment with Monnify for order ${order.orderNumber}`,
  );
  const verification = await this.verifyPayment(transactionReference);
  if (verification?.responseBody?.paymentStatus !== 'PAID') {
    await this.prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: PaymentStatus.PENDING },
    });
    throw new BadRequestException('Payment not confirmed by Monnify');
  }

  // Transition ORDER_PLACED → CONFIRMED (correct target status)
  this.logger.log(`Transitioning order ${order.orderNumber} to CONFIRMED`);
  try {
    await this.orderService.transition(order.id, OrderStatus.CONFIRMED, {
      actorId: order.userId,
      actorRole: 'CUSTOMER',
      reason: 'Payment verified via callback',
    });
  } catch (err) {
    if (
      err instanceof BadRequestException &&
      String(err.message).includes('Invalid transition')
    ) {
      this.logger.warn(`Order ${order.id} already CONFIRMED; skipping`);
    } else {
      this.logger.error(err);
      throw err;
    }
  }

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


  // In monnify.service.ts
async initializeTransaction(payload: any): Promise<any> {
  this.logger.log(`Initializing Monnify transaction: ${JSON.stringify(payload)}`);
  try {
    const data = await this.postToMonnify(
      `${this.baseUrl}/api/v1/merchant/transactions/init-transaction`,
      payload,
    );
    if (!data?.requestSuccessful) {
      throw new Error(data?.responseMessage || 'Initialization failed');
    }
    return data;
  } catch (error) {
    this.logger.error(
      `Monnify initialization failed: ${axios.isAxiosError(error) ? JSON.stringify(error.response?.data) : String(error)}`,
    );
    throw new HttpException(
      this.extractMonnifyErrorMessage(error),
      HttpStatus.BAD_REQUEST,
    );
  }
}


  ////DISBURSTMENT//////////

  async initiateTransfer(payload: {
    amount: number;
    reference: string;
    narration: string;
    destinationBankCode: string;
    destinationAccountNumber: string;
    destinationAccountName: string; // REQUIRED since March 2026 [citation:28]
    sourceAccountNumber: string;
  }) {
    const accessToken = await this.getAccessToken();
    const baseUrl = this.configService.get('MONNIFY_BASE_URL');

    try {
      const response = await axios.post(
        `${baseUrl}/api/v2/disbursements/single`,
        {
          amount: payload.amount,
          reference: payload.reference,
          narration: payload.narration,
          destinationBankCode: payload.destinationBankCode,
          destinationAccountNumber: payload.destinationAccountNumber,
          destinationAccountName: payload.destinationAccountName, // mandatory [citation:28]
          currency: 'NGN',
          sourceAccountNumber: payload.sourceAccountNumber,
        },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 30000,
        },
      );

      if (!response.data?.requestSuccessful) {
        throw new Error(response.data?.responseMessage || 'Transfer failed');
      }

      return response.data.responseBody;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Transfer failed';
      this.logger.error(`Disbursement failed: ${message}`);
      const responseMessage = (error as any)?.response?.data?.responseMessage;
      throw new BadRequestException(
        responseMessage || 'Transfer failed',
      );
    }
  }

 
}
