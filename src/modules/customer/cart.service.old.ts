// // src/customer/services/cart.service.ts
// import {
//   BadRequestException,
//   Injectable,
//   Logger,
//   NotFoundException,
// } from '@nestjs/common';
// import { AddToCartDto, CartSummaryDto } from './dto/cart.dto';
// import { PrismaService } from '../../shared/services/prisma.service';

// @Injectable()
// export class CartService {
//   private readonly logger = new Logger(CartService.name);

//   constructor(private readonly prisma: PrismaService) {}

//   /**
//    * Get or create user's cart
//    */
//   async getOrCreateCartold(userId: string, sessionId?: string) {
//     let cart;

//     if (userId) {
//       cart = await this.prisma.cart.findUnique({
//         where: { userId },
//         include: { items: true },
//       });
//     } else if (sessionId) {
//       cart = await this.prisma.cart.findUnique({
//         where: { sessionId },
//         include: { items: true },
//       });
//     }

//     if (!cart) {
//       cart = await this.prisma.cart.create({
//         //data: userId ? { userId } : { sessionId },
//         data: userId
//           ? {
//               user: { connect: { id: userId } },
//               // add other required fields if needed
//             }
//           : {
//               sessionId,
//               user: undefined, // or null if your schema allows
//               // add other required fields if needed
//             },
//         include: { items: true },
//       });
//     }

//     return cart;
//   }

//   async getOrCreateCart(userId?: string, sessionId?: string) {
//     if (!userId && !sessionId) {
//       throw new BadRequestException('User or sessionId must be provided');
//     }

//     let cart = null;

//     // ✅ 1. If user is logged in
//     if (userId) {
//       cart = await this.prisma.cart.findUnique({
//         where: { userId },
//         include: { items: true },
//       });

//       // 🔥 If user has no cart, check for guest cart to merge
//       if (!cart && sessionId) {
//         const guestCart = await this.prisma.cart.findUnique({
//           where: { sessionId },
//           include: { items: true },
//         });

//         if (guestCart) {
//           // 🔁 Convert guest cart → user cart
//           cart = await this.prisma.cart.update({
//             where: { id: guestCart.id },
//             data: {
//               user: { connect: { id: userId } },
//               sessionId: null, // optional: clear session
//             },
//             include: { items: true },
//           });

//           return cart;
//         }
//       }

//       // ✅ If still no cart, create new one
//       if (!cart) {
//         cart = await this.prisma.cart.create({
//           data: {
//             user: { connect: { id: userId } },
//           },
//           include: { items: true },
//         });
//       }

//       return cart;
//     }

//     // 🧠 2. Guest user (no userId)
//     cart = await this.prisma.cart.findUnique({
//       where: { sessionId },
//       include: { items: true },
//     });

//     // if (!cart) {
//     //   cart = await this.prisma.cart.create({
//     //     data: { sessionId },
//     //     include: { items: true },
//     //   });
//     // }
//     if (!cart) {
//       cart = await this.prisma.cart.create({
//         //data: userId ? { userId } : { sessionId },
//         data: userId
//           ? {
//               user: { connect: { id: userId } },
//               // add other required fields if needed
//             }
//           : {
//               sessionId,
//               user: undefined, // or null if your schema allows
//               // add other required fields if needed
//             },
//         include: { items: true },
//       });

//       return cart;
//     }
//   }
//   /**
//    * Add item to cart
//    */
//   async addToCart(userId: string, dto: AddToCartDto, sessionId?: string) {
//     this.logger.log(`Adding item to cart for user: ${userId || sessionId}`);

//     const cart = await this.getOrCreateCart(userId, sessionId);

//     // Get item details and calculate price
//     let itemDetails;
//     let unitPrice = 0;
//     let totalPrice = 0;
//     let selectedAddons = [];

//     switch (dto.itemType) {
//       case 'PRODUCT':
//         itemDetails = await this.getProductDetails(
//           dto.productId,
//           dto.variantId,
//         );
//         unitPrice = itemDetails.price;
//         totalPrice = unitPrice * dto.quantity;

//         // Add add-ons if selected
//         if (dto.addonIds?.length) {
//           selectedAddons = await this.getAddonDetails(dto.addonIds);
//           const addonsTotal = selectedAddons.reduce(
//             (sum, addon) => sum + addon.price,
//             0,
//           );
//           totalPrice += addonsTotal * dto.quantity;
//         }
//         break;

//       case 'PACKAGE':
//       case 'DOCUMENT':
//         itemDetails = await this.getPackageDetails(dto.packageId);
//         unitPrice = itemDetails.basePrice;
//         totalPrice = unitPrice * dto.quantity;
//         break;
//     }

//     if (dto.itemType === 'PACKAGE' || dto.itemType === 'DOCUMENT') {
//       const pkg = await this.prisma.package.findUnique({
//         where: { id: dto.packageId },
//       });

//       if (!pkg) {
//         throw new NotFoundException('Package not found');
//       }
//     }

//     // Create cart item
//     await this.prisma.cartItem.create({
//       data: {
//         cartId: cart.id,
//         itemType: dto.itemType,
//         productId: dto.itemType === 'PRODUCT' ? dto.productId : null,
//         variantId: dto.itemType === 'PRODUCT' ? dto.variantId : null,
//         packageId:
//           dto.itemType === 'PACKAGE' || dto.itemType === 'DOCUMENT'
//             ? dto.packageId
//             : null,
//         selectedAddons: selectedAddons,
//         quantity: dto.quantity,
//         unitPrice,
//         totalPrice,
//         specialInstructions: dto.specialInstructions,
//       },
//     });

//     // Update cart total
//     await this.updateCartTotal(cart.id);

//     return this.getCartSummary(cart.id);
//   }

//   async mergeGuestCart(userId: string, sessionId: string) {
//     const guestCart = await this.prisma.cart.findUnique({
//       where: { sessionId },
//       include: { items: true },
//     });

//     if (!guestCart) return;

//     const userCart = await this.getOrCreateCart(userId);

//     for (const guestItem of guestCart.items) {
//       // 🔍 Check if similar item already exists
//       const existingItem = await this.prisma.cartItem.findFirst({
//         where: {
//           cartId: userCart.id,
//           productId: guestItem.productId,
//           packageId: guestItem.packageId,
//           itemType: guestItem.itemType,
//         },
//       });

//       if (existingItem) {
//         // ✅ Merge quantities
//         await this.prisma.cartItem.update({
//           where: { id: existingItem.id },
//           data: {
//             quantity: existingItem.quantity + guestItem.quantity,
//             totalPrice: existingItem.totalPrice + guestItem.totalPrice,
//           },
//         });
//       } else {
//         // ➕ Create new item
//         await this.prisma.cartItem.create({
//           data: {
//             cartId: userCart.id,
//             itemType: guestItem.itemType,
//             productId: guestItem.productId,
//             packageId: guestItem.packageId,
//             variantId: guestItem.variantId,
//             quantity: guestItem.quantity,
//             unitPrice: guestItem.unitPrice,
//             totalPrice: guestItem.totalPrice,
//             selectedAddons: guestItem.selectedAddons,
//             specialInstructions: guestItem.specialInstructions,
//           },
//         });
//       }
//     }

//     // 🧹 Delete guest cart
//     await this.prisma.cart.delete({
//       where: { id: guestCart.id },
//     });

//     // 🔄 Recalculate total
//     await this.updateCartTotal(userCart.id);

//     return this.getCartSummary(userCart.id);
//   }

//   /**
//    * Update cart item quantity
//    */
//   async updateCartItemQuantity(cartItemId: string, quantity: number) {
//     if (quantity < 1) {
//       return this.removeCartItem(cartItemId);
//     }

//     const cartItem = await this.prisma.cartItem.findUnique({
//       where: { id: cartItemId },
//     });

//     if (!cartItem) {
//       throw new NotFoundException('Cart item not found');
//     }

//     const newTotalPrice = cartItem.unitPrice * quantity;

//     // Calculate add-ons total if any
//     let addonsTotal = 0;
//     if (cartItem.selectedAddons && Array.isArray(cartItem.selectedAddons)) {
//       addonsTotal = (
//         cartItem.selectedAddons as Array<{ price: number }>
//       ).reduce((sum, addon) => sum + addon.price, 0);
//     }

//     await this.prisma.cartItem.update({
//       where: { id: cartItemId },
//       data: {
//         quantity,
//         totalPrice: newTotalPrice + addonsTotal * quantity,
//       },
//     });

//     await this.updateCartTotal(cartItem.cartId);

//     return this.getCartSummary(cartItem.cartId);
//   }

//   /**
//    * Remove item from cart
//    */
//   async removeCartItem(cartItemId: string) {
//     const cartItem = await this.prisma.cartItem.findUnique({
//       where: { id: cartItemId },
//     });

//     if (!cartItem) {
//       throw new NotFoundException('Cart item not found');
//     }

//     await this.prisma.cartItem.delete({
//       where: { id: cartItemId },
//     });

//     await this.updateCartTotal(cartItem.cartId);

//     return this.getCartSummary(cartItem.cartId);
//   }

//   /**
//    * Get cart summary with calculations
//    */
//   async getCartSummary(cartId: string): Promise<CartSummaryDto> {
//     const cart = await this.prisma.cart.findUnique({
//       where: { id: cartId },
//       include: {
//         items: {
//           include: {
//             product: {
//               include: {
//                 store: true,
//                 productImages: {
//                   orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
//                   take: 1, // ✅ only best image
//                 },
//               },
//             },
//             package: true,
//           },
//         },
//       },
//     });

//     if (!cart) {
//       throw new NotFoundException('Cart not found');
//     }

//     const items = cart.items.map((item) => {
//       if (item.itemType === 'PRODUCT') {
//         const product = item.product;
//         const imageUrl = product?.productImages?.[0]?.imageUrl || null;

//         return {
//           id: item.id,
//           itemType: item.itemType,
//           productId: item.productId,
//           packageId: item.packageId,
//           name: product?.productName || 'Product',
//           imageUrl, // ✅ included
//           quantity: item.quantity,
//           unitPrice: item.unitPrice,
//           totalPrice: item.totalPrice,
//           selectedAddons: Array.isArray(item.selectedAddons)
//             ? item.selectedAddons
//             : [],
//           storeName: product?.store?.storeName,
//           specialInstructions: item.specialInstructions,
//         };
//       }

//       // PACKAGE
//       return {
//         id: item.id,
//         itemType: item.itemType,
//         productId: null,
//         packageId: item.packageId,
//         name: item.package?.name || 'Package',
//         //imageUrl: item.package?.imageUrl || null, // if exists
//         quantity: item.quantity,
//         unitPrice: item.unitPrice,
//         totalPrice: item.totalPrice,
//         specialInstructions: item.specialInstructions,
//       };
//     });

//     // 💰 Calculations
//     const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);

//     const [deliveryFee, serviceFee, taxAmount] = await Promise.all([
//       this.calculateDeliveryFee(cartId),
//       this.calculateServiceFee(subtotal),
//       this.calculateTax(subtotal),
//     ]);

//     return {
//       cartId: cart.id,
//       items,
//       subtotal,
//       deliveryFee,
//       serviceFee,
//       taxAmount,
//       totalAmount: subtotal + deliveryFee + serviceFee + taxAmount,
//     };
//   }

//   async getCartSummaryOld(cartId: string): Promise<CartSummaryDto> {
//     const cart = await this.prisma.cart.findUnique({
//       where: { id: cartId },
//       include: {
//         items: true,
//       },
//     });

//     if (!cart) {
//       throw new NotFoundException('Cart not found');
//     }

//     // Get full item details
//     const items = await Promise.all(
//       cart.items.map(async (item) => {
//         if (item.itemType === 'PRODUCT') {
//           const product = await this.prisma.product.findUnique({
//             where: { id: item.productId },
//             include: { store: true },
//           });
//           return {
//             id: item.id,
//             itemType: item.itemType,
//             productId: item.productId,
//             packageId: item.packageId,
//             name: product?.productName || 'Product',
//             quantity: item.quantity,
//             unitPrice: item.unitPrice,
//             totalPrice: item.totalPrice,
//             selectedAddons: Array.isArray(item.selectedAddons)
//               ? item.selectedAddons
//               : [],
//             storeName: product?.store?.storeName,
//             specialInstructions: item.specialInstructions,
//           };
//         } else {
//           const package_item = await this.prisma.package.findUnique({
//             where: { id: item.packageId },
//           });
//           return {
//             id: item.id,
//             itemType: item.itemType,
//             productId: null,
//             packageId: item.packageId,
//             name: package_item?.name || 'Package',
//             quantity: item.quantity,
//             unitPrice: item.unitPrice,
//             totalPrice: item.totalPrice,
//             specialInstructions: item.specialInstructions,
//           };
//         }
//       }),
//     );

//     // Calculate fees and taxes
//     const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
//     const deliveryFee = await this.calculateDeliveryFee(cartId);
//     const serviceFee = await this.calculateServiceFee(subtotal);
//     const taxAmount = await this.calculateTax(subtotal);

//     return {
//       cartId: cart.id,
//       items,
//       subtotal,
//       deliveryFee,
//       serviceFee,
//       taxAmount,
//       totalAmount: subtotal + deliveryFee + serviceFee + taxAmount,
//     };
//   }

//   /**
//    * Clear cart
//    */
//   async clearCart(cartId: string) {
//     await this.prisma.cartItem.deleteMany({
//       where: { cartId },
//     });

//     await this.prisma.cart.update({
//       where: { id: cartId },
//       data: { totalAmount: 0 },
//     });
//   }

//   // Private helper methods
//   private async getProductDetails(productId: string, variantId?: string) {
//     if (variantId) {
//       const variant = await this.prisma.variant.findUnique({
//         where: { id: variantId },
//       });
//       if (!variant) throw new NotFoundException('Variant not found');
//       return { price: variant.price };
//     } else {
//       const product = await this.prisma.product.findUnique({
//         where: { id: productId },
//       });
//       if (!product) throw new NotFoundException('Product not found');
//       return { price: product.basePrice };
//     }
//   }

//   private async getAddonDetails(addonIds: string[]) {
//     return this.prisma.addon.findMany({
//       where: { id: { in: addonIds } },
//     });
//   }

//   private async getPackageDetails(packageId: string) {
//     const package_item = await this.prisma.package.findUnique({
//       where: { id: packageId },
//     });
//     if (!package_item) throw new NotFoundException('Package not found');
//     return package_item;
//   }

//   private async updateCartTotal(cartId: string) {
//     const items = await this.prisma.cartItem.findMany({
//       where: { cartId },
//     });

//     const total = items.reduce((sum, item) => sum + item.totalPrice, 0);

//     await this.prisma.cart.update({
//       where: { id: cartId },
//       data: { totalAmount: total },
//     });
//   }

//   private async calculateDeliveryFee(cartId: string): Promise<number> {
//     // In production, calculate based on distance and delivery option
//     return 500; // Mock delivery fee
//   }

//   private async calculateServiceFee(subtotal: number): Promise<number> {
//     const serviceFees = await this.prisma.serviceFee.findMany({
//       where: { isActive: true },
//     });

//     let totalServiceFee = 0;
//     for (const fee of serviceFees) {
//       if (fee.feeType === 'PERCENTAGE') {
//         totalServiceFee += (subtotal * fee.value) / 100;
//       } else {
//         totalServiceFee += fee.value;
//       }
//     }

//     return totalServiceFee;
//   }

//   private async calculateTax(subtotal: number): Promise<number> {
//     const taxes = await this.prisma.taxSetting.findMany({
//       where: { isActive: true },
//     });

//     let totalTax = 0;
//     for (const tax of taxes) {
//       totalTax += (subtotal * tax.rate) / 100;
//     }

//     return totalTax;
//   }
// }
