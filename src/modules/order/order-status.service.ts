// import { Injectable, BadRequestException } from '@nestjs/common';
// import { PrismaService } from '../../shared/services/prisma.service';
// import { OrderStatus, Role } from '@prisma/client';
// import { Queue } from 'bullmq';
// import { InjectQueue } from '@nestjs/bullmq';

// type TransitionContext = {
//   actorId?: string;
//   actorRole?: Role;
//   reason?: string;
//   metadata?: any;
// };

// const transitions: Record<
//   string,
//   { from: OrderStatus[]; to: OrderStatus; action: string }
// > = {
//   confirm_payment: {
//     from: [OrderStatus.ORDER_PLACED], // after payment verification
//     to: OrderStatus.ORDER_PLACED,
//     action: 'ORDER_PLACED',
//   },
//   vendor_accept: {
//     from: [OrderStatus.ORDER_PLACED],
//     to: OrderStatus.ORDER_ACCEPTED,
//     action: 'VENDOR_ACCEPT',
//   },
//   assign_driver: {
//     from: [OrderStatus.ORDER_ACCEPTED],
//     to: OrderStatus.ORDER_ASSIGNED,
//     action: 'ASSIGN_DRIVER',
//   },
//   pickup: {
//     from: [OrderStatus.ORDER_ASSIGNED],
//     to: OrderStatus.PICKED_UP,
//     action: 'PICKUP',
//   },
//   deliver: {
//     from: [OrderStatus.PICKED_UP],
//     to: OrderStatus.DELIVERED,
//     action: 'DELIVER',
//   },
//   cancel: {
//     from: [OrderStatus.ORDER_PLACED, OrderStatus.ORDER_ACCEPTED],
//     to: OrderStatus.CANCELLED,
//     action: 'CANCEL',
//   },
// };

// @Injectable()
// export class OrderStatusService {
//   constructor(
//     private prisma: PrismaService,
//     @InjectQueue('order-events') private orderQueue: Queue,
//   ) {}

//   async transition(
//     orderId: string,
//     targetStatus: OrderStatus,
//     context: TransitionContext,
//   ) {
//     return this.prisma.$transaction(async (tx) => {
//       const order = await tx.order.findUnique({
//         where: { id: orderId },
//         include: { vendorAction: true, driverAssignment: true },
//       });
//       if (!order) throw new Error('Order not found');

//       const current = order.orderStatus;
//       const transitionKey = Object.keys(transitions).find(
//         (key) =>
//           transitions[key].to === targetStatus &&
//           transitions[key].from.includes(current),
//       );
//       if (!transitionKey) {
//         throw new BadRequestException(
//           `Invalid transition from ${current} to ${targetStatus}`,
//         );
//       }
//       const rule = transitions[transitionKey];

//       // Update order
//       const updated = await tx.order.update({
//         where: { id: orderId },
//         data: {
//           orderStatus: targetStatus,
//           statusHistory: {
//             push: {
//               status: targetStatus,
//               timestamp: new Date().toISOString(),
//               note: rule.action,
//               actorId: context.actorId,
//               reason: context.reason,
//             },
//           },
//           ...(targetStatus === OrderStatus.ORDER_ACCEPTED && {
//             vendorAcceptedAt: new Date(),
//           }),
//           ...(targetStatus === OrderStatus.ORDER_ASSIGNED && {
//             driverAssignedAt: new Date(),
//           }),
//           ...(targetStatus === OrderStatus.PICKED_UP && {
//             pickupTime: new Date(),
//           }),
//           ...(targetStatus === OrderStatus.DELIVERED && {
//             deliveryTime: new Date(),
//           }),
//         },
//       });

//       // Log activity
//       await tx.orderActivityLog.create({
//         data: {
//           orderId,
//           actorId: context.actorId,
//           actorRole: context.actorRole,
//           action: rule.action,
//           fromStatus: current,
//           toStatus: targetStatus,
//           reason: context.reason,
//           metadata: context.metadata,
//         },
//       });

//       // Fire background job for side effects (notifications, etc.)
//       await this.orderQueue.add(
//         rule.action,
//         { orderId, context },
//         { attempts: 3 },
//       );

//       return updated;
//     });
//   }
// }
