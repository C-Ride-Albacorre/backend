import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PayOrderDto } from './dto/pay-order.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { OrderStatus, PaymentMethod, PaymentStatus, Prisma, TxStatus, WalletTxType } from '@prisma/client';
import { OrderService } from '../order/order.service';
import { NotificationService } from '../notification/notification.service';
import { MonnifyService } from './monnify.service';
import { PaymentMethodDto } from '../../shared/enums';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly orderService: OrderService,
        private readonly notificationService: NotificationService,
        private readonly monnifyService: MonnifyService
    ) { }


 async payOrder(orderId: string, customerId: string, dto: PayOrderDto) {
    const order = await this.prisma.order.findUnique({
        where: { id: orderId },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== customerId) {
        throw new ForbiddenException('Order does not belong to you');
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
        throw new BadRequestException('Order already paid');
    }
    if (order.orderStatus !== OrderStatus.ORDER_PLACED) {
        throw new BadRequestException(
            `Cannot pay order in status ${order.orderStatus}`,
        );
    }

    if (dto.paymentMethod === PaymentMethodDto.WALLET) {
        return this.payWithWallet(order);
    }

    // Existing Monnify flow — keep it exactly as it was. If your current
    // initialize method is named differently (e.g. initializePayment /
    // initializeTransaction), call it here unchanged.
    return this.monnifyService.initializeTransaction(order);

}

async payWithWallet(order: {
  id: string;
  orderNumber: string;
  userId: string;
  totalAmount: Prisma.Decimal | number; // match whatever your Order column is
}) {
  const amount = new Prisma.Decimal(order.totalAmount);

  try {
    const result = await this.prisma.$transaction(
      async (tx) => {
        // 1. Re-read order *inside* the tx with a conditional update.
        //    We do the "already paid?" check here, not outside, because
        //    two concurrent wallet taps must not double-charge.
        const stillPayable = await tx.order.updateMany({
          where: {
            id: order.id,
            paymentStatus: PaymentStatus.PENDING,
            orderStatus: OrderStatus.ORDER_PLACED,
          },
          data: {
            paymentStatus: PaymentStatus.PAID,
            paymentMethod: PaymentMethod.WALLET,
            paymentReference: `WALLET-${order.orderNumber}`,
          },
        });

        if (stillPayable.count === 0) {
          throw new BadRequestException('Order already paid or not payable');
        }

        // 2. Conditional debit. The `balance: { gte: amount }` is the
        //    concurrency guard — two simultaneous debits can't both
        //    pass it. If this returns 0, we throw and the whole tx
        //    rolls back, including the order update above.
        const debit = await tx.wallet.updateMany({
          where: {
            userId: order.userId,
            balance: { gte: amount.toNumber() },
          },
          data: {
            balance: { decrement: amount.toNumber() },
          },
        });

        if (debit.count === 0) {
          throw new BadRequestException('Insufficient wallet balance');
        }

        // 3. Ledger row. Uses existing WalletTransaction model.
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.userId } },
            type: WalletTxType.DEBIT, // or your existing enum value, e.g. TransactionType.PAYMENT
            amount: amount.toNumber(),
            reference: `WALLET-${order.orderNumber}`,
            description: `Payment for order ${order.orderNumber}`,
            relatedOrderId: order.id ?? null,
            status: TxStatus.COMPLETED
          },
        });

        // 4. Transition to CONFIRMED inside the same tx.
        await this.orderService.transition(
          order.id,
          OrderStatus.CONFIRMED,
          {
            actorId: order.userId,
            actorRole: 'CUSTOMER',
            reason: 'Paid via wallet',
          },
        );

        return { ok: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!result.ok) {
      throw new BadRequestException('Wallet payment failed');
    }
  } catch (err) {
    // Serializable conflicts → client can safely retry once.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      throw new ConflictException('Wallet payment conflicted; retry');
    }
    throw err;
  }

  // 5. Notify AFTER the tx commits. If this fails, the payment is
  //    still correct — the customer sees success, notifications retry
  //    via whatever you do for order notifications. (Same pattern as
  //    your webhook handler.)
  await this.notificationService
    .notifyVendorsForOrder(order.id)
    .catch((e) => this.logger.error(`Vendor notify failed: ${e.message}`));

  await this.notificationService
    .notifyCustomerForOrder(order.id)
    .catch((e) => this.logger.error(`Customer notify failed: ${e.message}`));

  return {
    success: true,
    status: 'PAID',
    paymentMethod: 'WALLET',
    orderId: order.id,
    orderNumber: order.orderNumber,
  };
}
}
