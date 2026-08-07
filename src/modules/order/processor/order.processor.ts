// // // processors/order.processor.ts
// // import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
// // import { PushNotificationService } from '../../../modules/notification/push-notification.service';
// // import { PrismaService } from '../../../shared/services/prisma.service';
// // import { ZohoEmailProvider } from '../../verification/providers/zoho-email.provider';

// // @Processor('orderQueue')
// // export class OrderProcessor extends WorkerHost{
// //     constructor(
// //         private readonly prisma: PrismaService,
// //         private emailService: ZohoEmailProvider,
// //         private readonly pushService: PushNotificationService,
// //         // some Logger types don't expose .error in their TS type definitions
// //         // use `any` here to avoid Property 'error' does not exist on type 'Logger' errors
// //         private readonly logger: any,
// //     ) { 
// //     super();

// //     }

// //     @Process('PICKUP')
// //     async handlePickup(job: Job<{ orderId: string; context: any }>) {
// //         const { orderId } = job.data;

// //         // 1. Fetch order with user and driver details
// //         const order = await this.prisma.order.findUnique({
// //             where: { id: orderId },
// //             include: {
// //                 user: { select: { email: true, id: true } },
// //                 // cast include to any to avoid strict Prisma include typing issues for nested selects
// //                 driverAssignment: { include: { driver: true } } as any,
// //             },
// //         }) ;

// //         if (!order) {
// //             this.logger.error(`Order ${orderId} not found for PICKUP job`);
// //             return; // or throw if you want retry
// //         }

// //         // 2. Idempotency: check if already notified
// //         if (order.pickedUpAt) {
// //             this.logger.log(`Pickup notification already sent for order ${orderId}`);
// //             return;
// //         }

// //         const driverName = order.driverAssignment?.driver?.name || 'Driver';

// //         // 3. Send notifications (fire-and-forget, but catch errors)
// //         const notificationPromises = [];

// //         // Email
// //         if (order.user?.email) {
// //             notificationPromises.push(
// //                 this.emailService.sendPickupConfirmation(order.user.email, orderId, driverName)
// //                     .catch(err => this.logger.error(`Email failed for order ${orderId}`, err))
// //             );
// //         }

// //         // Push
// //         if (order.user?.id) {
// //             notificationPromises.push(
// //                 this.pushService.sendPickupPush(order.user.id, orderId, driverName)
// //                     .catch(err => this.logger.error(`Push failed for order ${orderId}`, err))
// //             );
// //         }

// //         // 4. Wait for all notifications to complete (or not, depending on your preference)
// //         await Promise.allSettled(notificationPromises);

// //         // 5. Mark as notified to avoid duplicates (optional)
// //         await this.prisma.order.update({
// //             where: { id: orderId },
// //             data: { pickedUpAt: new Date() },
// //         });
// //     }
// // }
// // processors/order.processor.ts
// import { Processor, WorkerHost } from '@nestjs/bullmq';
// import { Job } from 'bullmq';
// import { Logger } from '@nestjs/common';
// import { PushNotificationService } from '../../../modules/notification/push-notification.service';
// import { PrismaService } from '../../../shared/services/prisma.service';
// import { ZohoEmailProvider } from '../../verification/providers/zoho-email.provider';

// @Processor('orderQueue')
// export class OrderProcessor extends WorkerHost {
//   private readonly logger = new Logger(OrderProcessor.name);

//   constructor(
//     private readonly prisma: PrismaService,
//     private readonly emailService: ZohoEmailProvider,
//     private readonly pushService: PushNotificationService,
//   ) {
//     super();
//   }

//   @Process('PICKUP')
//   async handlePickup(job: Job<{ orderId: string; context: any }>) {
//     const { orderId } = job.data;

//     // Fetch order with user and driver details
//     const order = await this.prisma.order.findUnique({
//       where: { id: orderId },
//       include: {
//         user: { select: { email: true, id: true } },
//         driverAssignment: {
//           include: {
//             driver: { select: { name: true } },
//           },
//         },
//       },
//     });

//     if (!order) {
//       this.logger.error(`Order ${orderId} not found for PICKUP job`);
//       return; // or throw to retry
//     }

//     // ✅ Check the dedicated notification flag
//     if (order.pickupNotifiedAt) {
//       this.logger.log(`Pickup notification already sent for order ${orderId}`);
//       return;
//     }

//     const driverName = order.driverAssignment?.driver?.name || 'Driver';

//     // Prepare notification promises with error handling
//     const notificationPromises = [];

//     if (order.user?.email) {
//       notificationPromises.push(
//         this.emailService.sendPickupConfirmation(order.user.email, orderId, driverName)
//           .catch(err => this.logger.error(`Email failed for order ${orderId}`, err))
//       );
//     }

//     if (order.user?.id) {
//       notificationPromises.push(
//         this.pushService.sendPickupPush(order.user.id, orderId, driverName)
//           .catch(err => this.logger.error(`Push failed for order ${orderId}`, err))
//       );
//     }

//     // Wait for all (settled)
//     await Promise.allSettled(notificationPromises);

//     // ✅ Update only the notification flag
//     await this.prisma.order.update({
//       where: { id: orderId },
//       data: { pickupNotifiedAt: new Date() },
//     });
//   }
// }