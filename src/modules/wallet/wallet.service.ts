// wallet.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { MonnifyService } from '../payment/monnify.service';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { TxStatus, WalletTxType, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/services/prisma.service';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    private monnifyService: MonnifyService,
    private configService: ConfigService,
  ) {}

  // Ensure wallet exists for user (called on signup or first use)
  async getOrCreateWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId, balance: 0 },
      });
    }
    return wallet;
  }

  // Get wallet balance
  async getBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return { balance: wallet.balance, currency: wallet.currency };
  }

  // Get transaction history with pagination
  async getTransactions(userId: string, page = 1, limit = 20) {
    const wallet = await this.getOrCreateWallet(userId);
    const skip = (page - 1) * limit;
    const [transactions, total] = await this.prisma.$transaction([
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);
    return { data: transactions, total, page, limit };
  }

  // Fund wallet via Monnify
  async fundWallet(userId: string, amount: number, paymentMethod: string) {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    const wallet = await this.getOrCreateWallet(userId);

    // Generate unique reference for this funding
    const fundingReference = `FUND-${randomUUID()}`;

    // Create a pending wallet transaction (PENDING)
    const tx = await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: amount, // positive
        type: WalletTxType.CREDIT,
        reference: fundingReference,
        description: `Wallet funding of ${amount} ${wallet.currency}`,
        status: TxStatus.PENDING,
        metadata: { paymentMethod },
      },
    });

    // Initialize Monnify transaction for this funding
    // We'll reuse the same MonnifyService but we need to customize the redirect and
    // handle the webhook/callback separately.
    // Instead of hardcoding order logic, we can extend MonnifyService to accept a callback
    // that updates our transaction.

    // We need to store the transaction ID in metadata to link webhook.
    // We'll pass a custom redirect URL: /api/v1/wallet/callback
    const callbackUrl = `${this.configService.get('BACKEND_URI')}/api/v1/wallet/callback`;

    // Call Monnify initialization with amount, reference, etc.
    const monnifyPayload = {
      amount,
      customerEmail: (await this.prisma.user.findUnique({ where: { id: userId } })).email,
      paymentReference: fundingReference,
      paymentDescription: `Wallet funding`,
      currencyCode: 'NGN',
      contractCode: this.configService.get('MONNIFY_CONTRACT_CODE'),
      redirectUrl: callbackUrl,
      paymentMethods: [paymentMethod],
      metaData: { walletTxId: tx.id }, // store our tx id to link
    };

    // Use a generic method in MonnifyService that returns the checkout URL
    const response = await this.monnifyService.initializeTransaction(monnifyPayload);

    // Return the checkout URL to frontend
    return {
      checkoutUrl: response.responseBody.checkoutUrl,
      transactionReference: response.responseBody.transactionReference,
      walletTxId: tx.id,
    };
  }

  // Handle Monnify webhook for wallet funding
  async handleFundingWebhook(transactionReference: string, paymentStatus: string, metadata: any) {
    // Find the pending transaction by metadata.walletTxId or by reference
    const tx = await this.prisma.walletTransaction.findFirst({
      where: { reference: metadata?.paymentReference || transactionReference },
      include: { wallet: true },
    });

    if (!tx) {
      this.logger.warn(`No wallet transaction found for reference: ${transactionReference}`);
      return;
    }

    if (tx.status !== TxStatus.PENDING) {
      this.logger.warn(`Transaction ${tx.id} already processed`);
      return;
    }

    if (paymentStatus === 'PAID') {
      // Credit the wallet
      await this.prisma.$transaction(async (prisma) => {
        // Lock wallet row
        await prisma.$queryRaw`SELECT 1 FROM "Wallet" WHERE id = ${tx.walletId} FOR UPDATE`;
        const wallet = await prisma.wallet.findUnique({ where: { id: tx.walletId } });
        const newBalance = wallet.balance + tx.amount;
        await prisma.wallet.update({
          where: { id: tx.walletId },
          data: { balance: newBalance },
        });
        await prisma.walletTransaction.update({
          where: { id: tx.id },
          data: { status: TxStatus.COMPLETED },
        });
      });
      this.logger.log(`Wallet funded: ${tx.amount} for user ${tx.wallet.userId}`);
    } else {
      // Mark as failed
      await this.prisma.walletTransaction.update({
        where: { id: tx.id },
        data: { status: TxStatus.FAILED },
      });
      this.logger.warn(`Wallet funding failed for reference: ${transactionReference}`);
    }
  }

  // Internal method to debit wallet (used for order payments)
  async debitWallet(userId: string, amount: number, reference: string, description: string) {
    if (amount <= 0) throw new Error('Amount must be positive');
    const wallet = await this.getOrCreateWallet(userId);

    // Use transaction with locking
    return await this.prisma.$transaction(async (prisma) => {
      // Lock wallet
      await prisma.$queryRaw`SELECT 1 FROM "Wallet" WHERE userId = ${userId} FOR UPDATE`;
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');
      if (wallet.balance < amount) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      const newBalance = wallet.balance - amount;
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });

      const tx = await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: -amount,
          type: WalletTxType.DEBIT,
          reference,
          description,
          status: TxStatus.COMPLETED,
        },
      });
      return tx;
    });
  }

  // Credit wallet (for refunds)
  async creditWallet(userId: string, amount: number, reference: string, description: string) {
    if (amount <= 0) throw new Error('Amount must be positive');
    const wallet = await this.getOrCreateWallet(userId);

    return await this.prisma.$transaction(async (prisma) => {
      await prisma.$queryRaw`SELECT 1 FROM "Wallet" WHERE userId = ${userId} FOR UPDATE`;
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      const newBalance = wallet.balance + amount;
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });
      const tx = await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: amount,
          type: WalletTxType.CREDIT,
          reference,
          description,
          status: TxStatus.COMPLETED,
        },
      });
      return tx;
    });
  }


  async handleWalletCallback(transactionReference: string) {
    // Do not trust paymentStatus/paymentReference from the callback query.
    // Verify the transaction directly with Monnify.
    const verification =
      await this.monnifyService.verifyPayment(transactionReference);

    const { paymentStatus, metaData } = verification.responseBody;

    await this.handleFundingWebhook(
      transactionReference,
      paymentStatus,
      metaData,
    );

    return {
      status: paymentStatus,
    };
  }

//   async handleFundingWebhook(
//     transactionReference: string,
//     status: string,
//     metaData: Record<string, any>,
//   ) {
//     // Your existing wallet funding logic
//     // ...
//   }

}