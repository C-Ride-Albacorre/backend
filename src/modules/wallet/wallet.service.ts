// wallet.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { MonnifyService } from '../payment/monnify.service';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { TxStatus, WalletTxType, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/services/prisma.service';
import { CreditWalletDto, SearchWalletUsersDto, WalletUserType } from '../admin/dto/admin-wallet.dto';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    private monnifyService: MonnifyService,
    private configService: ConfigService,
  ) {}

  // Ensure wallet exists for user (called on signup or first use)
  // async getOrCreateWallet(userId: string) {
  //   let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
  //   if (!wallet) {
  //     wallet = await this.prisma.wallet.create({
  //       data: { userId, balance: 0 },
  //     });
  //   }
  //   return wallet;
  // }
  async getOrCreateWallet(userId: string) {
  let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    this.logger.warn(`Creating missing wallet for user ${userId}`);
    wallet = await this.prisma.wallet.create({
      data: { userId, balance: 0, currency: 'NGN' },
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
    this.logger.log(`Initiating wallet funding of ${amount} for user ${userId} via ${paymentMethod}`);

    const wallet = await this.getOrCreateWallet(userId);

    // Generate unique reference for this funding
    const fundingReference = `FUND-${randomUUID()}`;

    // Create a pending wallet transaction (PENDING)
    this.logger.log(`Creating pending wallet transaction for funding reference ${fundingReference}`);
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
    this.logger.log(`Initializing Monnify transaction for wallet funding, txId: ${tx.id}`);
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
    this.logger.log(`Calling MonnifyService to initialize transaction for funding reference ${fundingReference}`);
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

/**
 * Create a PENDING credit. Balance is NOT incremented — the money is
 * "pending" until clearPendingCredit is called by the cron.
 * Used by driver earnings so the driver sees the amount in Pending
 * immediately but cannot spend it until the hold window passes.
 */
async creditWalletPending(
  userId: string,
  amount: number,
  reference: string,
  description: string,
  metadata?: Record<string, any>,
) {
  if (amount <= 0) throw new BadRequestException('Amount must be positive');
  const wallet = await this.getOrCreateWallet(userId);

  return this.prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      amount,
      type: WalletTxType.CREDIT,
      reference,
      description,
      status: TxStatus.PENDING,
      metadata: metadata ?? {},
    },
  });
}

/**
 * Promote a PENDING credit to COMPLETED and increment the wallet balance.
 * Idempotent — re-running on an already-completed tx is a no-op.
 */
async clearPendingCredit(walletTxId: string) {
  return this.prisma.$transaction(async (prisma) => {
    const tx = await prisma.walletTransaction.findUnique({
      where: { id: walletTxId },
      include: { wallet: true },
    });
    if (!tx) throw new NotFoundException('Wallet transaction not found');
    if (tx.status !== TxStatus.PENDING) return tx;   // already processed

    // Lock wallet row, then increment
    await prisma.$queryRaw`SELECT 1 FROM "Wallet" WHERE id = ${tx.walletId} FOR UPDATE`;
    await prisma.wallet.update({
      where: { id: tx.walletId },
      data: { balance: { increment: tx.amount } },
    });
    return prisma.walletTransaction.update({
      where: { id: tx.id },
      data: { status: TxStatus.COMPLETED },
    });
  });
}

/**
 * Cancel a PENDING credit (used when an earning is reversed before clearing).
 */
async cancelPendingCredit(walletTxId: string, reason: string) {
  return this.prisma.walletTransaction.update({
    where: { id: walletTxId },
    data: {
      status: TxStatus.FAILED,
      metadata: { ...(await this.getTxMetadata(walletTxId)), cancelReason: reason },
    },
  });
}

private async getTxMetadata(id: string): Promise<Record<string, any>> {
  const tx = await this.prisma.walletTransaction.findUnique({
    where: { id },
    select: { metadata: true },
  });
  return (tx?.metadata as Record<string, any>) ?? {};
}

// wallet.service.ts

/**
 * Search users with wallet balances (customers or drivers).
 */
async searchUsers(dto: SearchWalletUsersDto) {
  const { userType, search, page = 1, limit = 20 } = dto;
  const skip = (page - 1) * limit;

  const where: Prisma.UserWhereInput = {
    isActive: true, // exclude inactive users by default
  };

  if (userType === WalletUserType.CUSTOMER) {
    where.role = 'CUSTOMER';
  } else if (userType === WalletUserType.DRIVER) {
    where.role = 'DISPATCHER';
  }

  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phoneNumber: { contains: search, mode: 'insensitive' } },
      { id: { equals: search } },
    ];
  }

  const [users, total] = await this.prisma.$transaction([
    this.prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        wallet: { select: { id: true, balance: true, currency: true } },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    this.prisma.user.count({ where }),
  ]);

  return {
    data: users.map((u) => ({
      id: u.id,
      name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
      email: u.email,
      phoneNumber: u.phoneNumber,
      role: u.role,
      isActive: u.isActive,
      walletBalance: u.wallet?.balance ?? 0,
      currency: u.wallet?.currency ?? 'NGN',
    })),
    total,
    page,
    limit,
  };
}

/**
 * Get a single user's wallet details.
 */
async getUserWallet(userId: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phoneNumber: true,
      role: true,
      isActive: true,
      wallet: true,
    },
  });
  if (!user) throw new NotFoundException('User not found');
  if (!user.isActive) throw new BadRequestException('User account is inactive');
  if (!user.wallet) {
    // Lazy fallback
    const wallet = await this.getOrCreateWallet(userId);
    return { ...user, wallet };
  }
  return user;
}

/**
 * Admin credits a user's wallet.
 */
async adminCredit(
  adminId: string,
  dto: CreditWalletDto,
) {
  if (dto.amount <= 0) {
    throw new BadRequestException('Credit amount must be greater than 0');
  }

  // Validate user
  const user = await this.prisma.user.findUnique({
    where: { id: dto.userId },
    include: { wallet: true },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }
  if (!user.isActive) {
    throw new BadRequestException('Cannot credit an inactive user account');
  }
  if (user.role !== dto.userType) {
    throw new BadRequestException(
      `User role mismatch. Expected ${dto.userType}, got ${user.role}`,
    );
  }

  const reference = `ADMIN-CREDIT-${randomUUID()}`;

  return await this.prisma.$transaction(async (tx) => {
    // Lock wallet row
    await tx.$queryRaw`SELECT 1 FROM "Wallet" WHERE "userId" = ${user.id} FOR UPDATE`;

    const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const previousBalance = wallet.balance;
    const newBalance = previousBalance + dto.amount;

    // Create transaction first
    const walletTx = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: dto.amount,
        type: WalletTxType.CREDIT,
        reference,
        description: dto.reason,
        status: TxStatus.COMPLETED,
        initiatedById: adminId,
        reason: dto.reason,
        relatedOrderId: dto.relatedOrderId ?? null,
        metadata: {
          source: 'ADMIN_CREDIT',
          userType: dto.userType,
        },
      },
    });

    // Update wallet balance
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance },
    });

    return {
      success: true,
      message: 'Wallet credited successfully',
      data: {
        walletTxId: walletTx.id,
        reference,
        userId: user.id,
        userName:
          `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email,
        amountCredited: dto.amount,
        previousBalance,
        newBalance,
        reason: dto.reason,
        relatedOrderId: dto.relatedOrderId ?? null,
        creditedBy: adminId,
        creditedAt: walletTx.createdAt,
      },
    };
  });
}

/**
 * Recent admin-initiated credits & refunds.
 */
async getRecentAdminTransactions(page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const [rows, total] = await this.prisma.$transaction([
    this.prisma.walletTransaction.findMany({
      where: {
        initiatedById: { not: null },
      },
      include: {
        wallet: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
              },
            },
          },
        },
        initiatedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    this.prisma.walletTransaction.count({
      where: { initiatedById: { not: null } },
    }),
  ]);

  return {
    data: rows.map((t) => ({
      id: t.id,
      userName:
        `${t.wallet.user.firstName ?? ''} ${t.wallet.user.lastName ?? ''}`.trim() ||
        t.wallet.user.email,
      userType: t.wallet.user.role,
      amount: t.amount,
      type: t.type,
      reference: t.reference,
      reason: t.reason,
      relatedOrderId: t.relatedOrderId,
      previousBalance:
        t.metadata && typeof t.metadata === 'object'
          ? (t.metadata as any).previousBalance ?? null
          : null,
      newBalance:
        t.metadata && typeof t.metadata === 'object'
          ? (t.metadata as any).newBalance ?? null
          : null,
      initiatedBy: {
        id: t.initiatedBy?.id,
        name:
          `${t.initiatedBy?.firstName ?? ''} ${t.initiatedBy?.lastName ?? ''}`.trim() ||
          t.initiatedBy?.email,
      },
      createdAt: t.createdAt,
    })),
    total,
    page,
    limit,
  };
}
}