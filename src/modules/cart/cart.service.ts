// src/customer/services/cart.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AddToCartDto, CartItemDto, CartSummaryDto } from './dto/cart.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import Helper from 'src/shared/utils/helpers';
import { CartStatus, Prisma } from '@prisma/client';
import { JsonValue } from '@prisma/client/runtime/library';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get or create user's cart
   */
  async getOrCreateCartold(userId: string, sessionId?: string) {
    let cart;

    if (userId) {
      cart = await this.prisma.cart.findUnique({
        where: { userId },
        include: { items: true },
      });
    } else if (sessionId) {
      cart = await this.prisma.cart.findUnique({
        where: { sessionId },
        include: { items: true },
      });
    }

    if (!cart) {
      cart = await this.prisma.cart.create({
        //data: userId ? { userId } : { sessionId },
        data: userId
          ? {
              user: { connect: { id: userId } },
              // add other required fields if needed
            }
          : {
              sessionId,
              user: undefined, // or null if your schema allows
              // add other required fields if needed
            },
        include: { items: true },
      });
    }

    return cart;
  }

  /**
   * Get or create an ACTIVE cart for a user or guest.
   * - If an ACTIVE cart exists, return it.
   * - If only non‑ACTIVE carts exist (e.g., CHECKED_OUT), create a new one.
   * - If no cart exists, create one.
   */
  async getOrCreateCart(
    userId?: string,
    sessionId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    if (!userId && !sessionId) {
      throw new BadRequestException('User or sessionId must be provided');
    }

    const prisma = tx ?? this.prisma;
    const safeSessionId = sessionId?.trim() || null;
    const hasUser = !!userId;
    const hasSession = !!safeSessionId;

    let activeCart = null;

    if (hasUser) {
      activeCart = await prisma.cart.findFirst({
        where: { userId, status: CartStatus.ACTIVE },
        include: { items: true },
      });
      if (!activeCart) {
        activeCart = await prisma.cart.create({
          data: { userId, status: CartStatus.ACTIVE },
          include: { items: true },
        });
        this.logger.log(
          `Created new active cart ${activeCart.id} for user ${userId}`,
        );
      }
    } else {
      activeCart = await prisma.cart.findFirst({
        where: { sessionId: safeSessionId, status: CartStatus.ACTIVE },
        include: { items: true },
      });
      if (!activeCart) {
        activeCart = await prisma.cart.create({
          data: { sessionId: safeSessionId, status: CartStatus.ACTIVE },
          include: { items: true },
        });
        this.logger.log(
          `Created new active cart ${activeCart.id} for guest session ${safeSessionId}`,
        );
      }
    }
    return activeCart;
  }

  async getOrCreateCartRecent(userId?: string, sessionId?: string) {
    console.log('userId', userId);
    console.log('safeSessionId', sessionId);

    const safeSessionId = sessionId?.trim() || null;
    const hasUser = !!userId;
    const hasSession = !!safeSessionId;

    if (!hasUser && !hasSession) {
      throw new BadRequestException('User or sessionId must be provided');
    }

    let cart;

    /**
     * =========================
     * LOGGED-IN USER FLOW
     * =========================
     */
    if (hasUser) {
      cart = await this.prisma.cart.findUnique({
        where: { userId },
        include: { items: true },
      });

      /**
       * Merge guest cart → user cart (only if session exists)
       */
      if (!cart && hasSession) {
        const guestCart = await this.prisma.cart.findUnique({
          where: { sessionId: safeSessionId },
          include: { items: true },
        });

        if (guestCart) {
          cart = await this.prisma.cart.update({
            where: { id: guestCart.id },
            data: {
              user: { connect: { id: userId } },
              sessionId: null,
            },
            include: { items: true },
          });

          return cart;
        }
      }

      /**
       * Create user cart if none exists
       */
      if (!cart) {
        cart = await this.prisma.cart.create({
          data: {
            user: { connect: { id: userId } },
          },
          include: { items: true },
        });
      }

      return cart;
    }

    /**
     * =========================
     * GUEST FLOW
     * =========================
     */
    cart = await this.prisma.cart.findUnique({
      where: { sessionId: safeSessionId },
      include: { items: true },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: {
          sessionId: safeSessionId,
        },
        include: { items: true },
      });
    }

    return cart;
  }

  async getOrCreateCartbk(userId?: string, sessionId?: string) {
    if (!userId && !sessionId) {
      throw new BadRequestException('User or sessionId must be provided');
    }

    let cart = null;

    // ✅ Logged-in user
    if (userId) {
      cart = await this.prisma.cart.findUnique({
        where: { userId },
        include: { items: true },
      });

      // Merge guest cart into user cart
      if (!cart && sessionId) {
        const guestCart = await this.prisma.cart.findUnique({
          where: { sessionId },
          include: { items: true },
        });

        if (guestCart) {
          cart = await this.prisma.cart.update({
            where: { id: guestCart.id },
            data: {
              user: { connect: { id: userId } },
              sessionId: null,
            },
            include: { items: true },
          });

          return cart;
        }
      }

      // Create new user cart
      if (!cart) {
        cart = await this.prisma.cart.create({
          data: {
            user: { connect: { id: userId } },
          },
          include: { items: true },
        });
      }

      return cart;
    }

    // ✅ Guest user
    cart = await this.prisma.cart.findUnique({
      where: { sessionId },
      include: { items: true },
    });

    // Create guest cart if none exists
    if (!cart) {
      cart = await this.prisma.cart.create({
        data: {
          sessionId,
        },
        include: { items: true },
      });
    }

    // 🔥 MISSING RETURN
    return cart;
  }

  async getOrCreateCartoldbug(userId?: string, sessionId?: string) {
    if (!userId && !sessionId) {
      throw new BadRequestException('User or sessionId must be provided');
    }

    let cart = null;

    // ✅ 1. If user is logged in
    if (userId) {
      cart = await this.prisma.cart.findUnique({
        where: { userId },
        include: { items: true },
      });

      // 🔥 If user has no cart, check for guest cart to merge
      if (!cart && sessionId) {
        const guestCart = await this.prisma.cart.findUnique({
          where: { sessionId },
          include: { items: true },
        });

        if (guestCart) {
          // 🔁 Convert guest cart → user cart
          cart = await this.prisma.cart.update({
            where: { id: guestCart.id },
            data: {
              user: { connect: { id: userId } },
              sessionId: null, // optional: clear session
            },
            include: { items: true },
          });

          return cart;
        }
      }

      // ✅ If still no cart, create new one
      if (!cart) {
        cart = await this.prisma.cart.create({
          data: {
            user: { connect: { id: userId } },
          },
          include: { items: true },
        });
      }

      return cart;
    }

    // 🧠 2. Guest user (no userId)
    cart = await this.prisma.cart.findUnique({
      where: { sessionId },
      include: { items: true },
    });

    // if (!cart) {
    //   cart = await this.prisma.cart.create({
    //     data: { sessionId },
    //     include: { items: true },
    //   });
    // }
    if (!cart) {
      cart = await this.prisma.cart.create({
        //data: userId ? { userId } : { sessionId },
        data: userId
          ? {
              user: { connect: { id: userId } },
              // add other required fields if needed
            }
          : {
              sessionId,
              user: undefined, // or null if your schema allows
              // add other required fields if needed
            },
        include: { items: true },
      });

      return cart;
    }
  }
  /**
   * Add item to cart
   */
  async addToCartbk(userId: string, dto: AddToCartDto, sessionId?: string) {
    this.logger.log(`Adding item to cart for user: ${userId || sessionId}`);

    const cart = await this.getOrCreateCart(userId, sessionId);

    // Get item details and calculate price
    let itemDetails;
    let unitPrice = 0;
    let totalPrice = 0;
    let selectedAddons = [];

    switch (dto.itemType) {
      case 'PRODUCT':
        itemDetails = await this.getProductDetails(
          dto.productId,
          dto.variantId,
        );
        unitPrice = itemDetails.price;
        totalPrice = unitPrice * dto.quantity;

        // Add add-ons if selected
        if (dto.addonIds?.length) {
          selectedAddons = await this.getAddonDetails(dto.addonIds);
          const addonsTotal = selectedAddons.reduce(
            (sum, addon) => sum + addon.price,
            0,
          );
          totalPrice += addonsTotal * dto.quantity;
        }
        break;

      case 'PACKAGE':
      case 'DOCUMENT':
        itemDetails = await this.getPackageDetails(dto.packageId);
        unitPrice = itemDetails.basePrice;
        totalPrice = unitPrice * dto.quantity;
        break;
    }

    if (dto.itemType === 'PACKAGE' || dto.itemType === 'DOCUMENT') {
      const pkg = await this.prisma.package.findUnique({
        where: { id: dto.packageId },
      });

      if (!pkg) {
        throw new NotFoundException('Package not found');
      }
    }

    // Create cart item
    await this.prisma.cartItem.create({
      data: {
        cartId: cart.id,
        itemType: dto.itemType,
        productId: dto.itemType === 'PRODUCT' ? dto.productId : null,
        variantId: dto.itemType === 'PRODUCT' ? dto.variantId : null,
        packageId:
          dto.itemType === 'PACKAGE' || dto.itemType === 'DOCUMENT'
            ? dto.packageId
            : null,
        selectedAddons: selectedAddons,
        quantity: dto.quantity,
        unitPrice,
        totalPrice,
        specialInstructions: dto.specialInstructions,
      },
    });

    // Update cart total
    await this.updateCartTotal(cart.id);

    return this.getCartSummary(cart.id, userId, sessionId);
  }
  /**
   * Add item to cart – uses active cart (creates one if needed).
   */
  async addToCart(
    userId: string | null,
    dto: AddToCartDto,
    sessionId?: string,
  ) {
    const cart = await this.getOrCreateCart(userId || undefined, sessionId);

    // Resolve item details and pricing
    let unitPrice = 0;
    let totalPrice = 0;
    let selectedAddons: any[] = [];

    switch (dto.itemType) {
      case 'PRODUCT':
        const productDetails = await this.getProductDetails(
          dto.productId!,
          dto.variantId,
        );
        unitPrice = productDetails.price;
        totalPrice = unitPrice * dto.quantity;
        if (dto.addonIds?.length) {
          selectedAddons = await this.getAddonDetails(dto.addonIds);
          const addonsTotal = selectedAddons.reduce(
            (sum, addon) => sum + addon.price,
            0,
          );
          totalPrice += addonsTotal * dto.quantity;
        }
        break;

      case 'PACKAGE':
      case 'DOCUMENT':
        const packageDetails = await this.getPackageDetails(dto.packageId!);
        unitPrice = packageDetails.basePrice;
        totalPrice = unitPrice * dto.quantity;
        break;
    }

    // Validate package exists (for safety)
    if (dto.itemType === 'PACKAGE' || dto.itemType === 'DOCUMENT') {
      const pkg = await this.prisma.package.findUnique({
        where: { id: dto.packageId },
      });
      if (!pkg) throw new NotFoundException('Package not found');
    }

    // Create cart item
    await this.prisma.cartItem.create({
      data: {
        cartId: cart.id,
        itemType: dto.itemType,
        productId: dto.itemType === 'PRODUCT' ? dto.productId : null,
        variantId: dto.itemType === 'PRODUCT' ? dto.variantId : null,
        packageId:
          dto.itemType === 'PACKAGE' || dto.itemType === 'DOCUMENT'
            ? dto.packageId
            : null,
        selectedAddons,
        quantity: dto.quantity,
        unitPrice,
        totalPrice,
        specialInstructions: dto.specialInstructions,
      },
    });

    await this.updateCartTotal(cart.id);
    return this.getCartSummary(cart.id, userId || undefined, sessionId);
  }

  /**
   * Merge a guest's active cart into the user's active cart after login.
   * - Only active carts are merged (status = ACTIVE).
   * - The user's active cart is created if it doesn't exist.
   * - All database operations run inside a single serializable transaction.
   * - Guest cart is deleted after successful merge.
   * - Returns the merged cart summary.
   */
  /**
   * Merge guest ACTIVE cart into user ACTIVE cart – fully atomic.
   */
  async mergeGuestCart(
    userId: string,
    sessionId: string,
  ): Promise<CartSummaryDto> {
    if (!userId || !sessionId) {
      throw new BadRequestException('Both userId and sessionId are required');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Get or create user's active cart
        let userCart = await tx.cart.findFirst({
          where: { userId, status: CartStatus.ACTIVE },
          include: { items: true },
        });
        if (!userCart) {
          userCart = await tx.cart.create({
            data: { userId, status: CartStatus.ACTIVE },
            include: { items: true },
          });
          this.logger.log(
            `Created new active cart ${userCart.id} for user ${userId}`,
          );
        }

        // 2. Get guest's active cart (ignore non-active)
        const guestCart = await tx.cart.findFirst({
          where: { sessionId, status: CartStatus.ACTIVE },
          include: { items: true },
        });

        if (!guestCart || guestCart.items.length === 0) {
          return this.getCartSummary(userCart.id, userId, undefined, tx);
        }

        // 3. Merge items
        for (const guestItem of guestCart.items) {
          const existingItem = await tx.cartItem.findFirst({
            where: {
              cartId: userCart.id,
              itemType: guestItem.itemType,
              productId: guestItem.productId,
              packageId: guestItem.packageId,
              variantId: guestItem.variantId,
              selectedAddons: {
                equals: this.normalizeAddons(guestItem.selectedAddons as any),
              },
            },
          });

          if (existingItem) {
            await tx.cartItem.update({
              where: { id: existingItem.id },
              data: {
                quantity: existingItem.quantity + guestItem.quantity,
                totalPrice:
                  Number(existingItem.totalPrice) +
                  Number(guestItem.totalPrice),
              },
            });
          } else {
            await tx.cartItem.create({
              data: {
                cartId: userCart.id,
                itemType: guestItem.itemType,
                productId: guestItem.productId,
                packageId: guestItem.packageId,
                variantId: guestItem.variantId,
                quantity: guestItem.quantity,
                unitPrice: guestItem.unitPrice,
                totalPrice: guestItem.totalPrice,
                selectedAddons: guestItem.selectedAddons,
                specialInstructions: guestItem.specialInstructions,
              },
            });
          }
        }

        // 4. Delete guest cart
        await tx.cart.delete({ where: { id: guestCart.id } });
        // 5. Update total
        await this.updateCartTotal(userCart.id, tx);
        // 6. Return summary
        return this.getCartSummary(userCart.id, userId, undefined, tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    );
  }

  async mergeGuestCartMostRecent(
    userId: string,
    sessionId: string,
  ): Promise<CartSummaryDto> {
    // Validate inputs
    if (!userId || !sessionId) {
      throw new BadRequestException('Both userId and sessionId are required');
    }

    // Use serializable transaction for maximum consistency
    return this.prisma.$transaction(
      async (tx) => {
        // 1. Get or create user's ACTIVE cart (inside transaction)
        let userCart = await tx.cart.findFirst({
          where: {
            userId,
            status: CartStatus.ACTIVE,
          },
          include: { items: true },
        });

        if (!userCart) {
          userCart = await tx.cart.create({
            data: {
              userId,
              status: CartStatus.ACTIVE,
            },
            include: { items: true },
          });
          this.logger.log(
            `Created new active cart ${userCart.id} for user ${userId}`,
          );
        }

        // 2. Get guest's ACTIVE cart (ignore non-active or non-existent)
        const guestCart = await tx.cart.findFirst({
          where: {
            sessionId,
            status: CartStatus.ACTIVE,
          },
          include: { items: true },
        });

        // 3. If no guest cart or guest cart is empty, return current user cart summary
        if (!guestCart || guestCart.items.length === 0) {
          this.logger.log(
            `No active guest cart to merge for session ${sessionId}`,
          );
          // Use transaction client to get summary
          return this.getCartSummary(userCart.id, userId, undefined, tx);
        }

        this.logger.log(
          `Merging ${guestCart.items.length} items from guest cart ${guestCart.id} to user cart ${userCart.id}`,
        );

        // 4. Merge each guest item into user cart
        for (const guestItem of guestCart.items) {
          // Find existing identical item in user cart (same type, IDs, and addons)
          const existingItem = await tx.cartItem.findFirst({
            where: {
              cartId: userCart.id,
              itemType: guestItem.itemType,
              productId: guestItem.productId,
              packageId: guestItem.packageId,
              variantId: guestItem.variantId,
              // Compare addons in a stable way
              selectedAddons: {
                equals: this.normalizeAddons(guestItem.selectedAddons as any),
              },
            },
          });

          if (existingItem) {
            // Combine quantities and total price
            await tx.cartItem.update({
              where: { id: existingItem.id },
              data: {
                quantity: existingItem.quantity + guestItem.quantity,
                totalPrice:
                  Number(existingItem.totalPrice) +
                  Number(guestItem.totalPrice),
              },
            });
            this.logger.debug(
              `Updated existing item ${existingItem.id}, new quantity = ${existingItem.quantity + guestItem.quantity}`,
            );
          } else {
            // Create new cart item
            await tx.cartItem.create({
              data: {
                cartId: userCart.id,
                itemType: guestItem.itemType,
                productId: guestItem.productId,
                packageId: guestItem.packageId,
                variantId: guestItem.variantId,
                quantity: guestItem.quantity,
                unitPrice: guestItem.unitPrice,
                totalPrice: guestItem.totalPrice,
                selectedAddons: guestItem.selectedAddons,
                specialInstructions: guestItem.specialInstructions,
              },
            });
            this.logger.debug(`Created new cart item from guest item`);
          }
        }

        // 5. Delete the guest cart (only after successful merge)
        await tx.cart.delete({
          where: { id: guestCart.id },
        });
        this.logger.log(`Deleted guest cart ${guestCart.id}`);

        // 6. Recalculate user cart total inside transaction
        await this.updateCartTotal(userCart.id);

        // 7. Return the merged cart summary using the same transaction
        const summary = await this.getCartSummary(
          userCart.id,
          userId,
          undefined,
          tx,
        );
        this.logger.log(
          `Cart merge completed. User cart ${userCart.id} now has ${summary.items.length} items, total ${summary.totalAmount}`,
        );
        return summary;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000, // maximum time to wait for transaction to start
        timeout: 10000, // maximum time the transaction can run
      },
    );
  }

  /**
   * Helper to normalize addons for consistent comparison.
   * Sorts addons by a stable key (e.g., addon id) before stringifying.
   */

  // private normalizeAddons(addons: any[]): any[] {
  //   if (!addons || !Array.isArray(addons)) return [];
  //   // Assuming each addon has an `id` field; sort by id
  //   return [...addons].sort((a, b) => {
  //     const idA = a.id ?? a;
  //     const idB = b.id ?? b;
  //     return String(idA).localeCompare(String(idB));
  //   });
  // }

  private normalizeAddons(addons: any[]): any[] {
    if (!addons || !Array.isArray(addons)) return [];
    return [...addons].sort((a, b) =>
      String(a.id ?? a).localeCompare(String(b.id ?? b)),
    );
  }

  /**
   * Update cart total using a transaction client.
   * (Your existing implementation, but accepting a transaction client)
   */
  private async updateCartTotal(
    cartId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx ?? this.prisma;

    const items = await prisma.cartItem.findMany({
      where: { cartId },
    });
    const total = items.reduce((sum, item) => sum + item.totalPrice, 0);
    await prisma.cart.update({
      where: { id: cartId },
      data: { totalAmount: total },
    });
  }

  async mergeGuestCartRecent(userId: string, sessionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const guestCart = await tx.cart.findUnique({
        where: { sessionId },
        include: { items: true },
      });

      const userCart = await this.getOrCreateCart(userId);

      // ✅ Nothing to merge
      if (!guestCart || guestCart.items.length === 0) {
        //return this.getCartSummary(userCart.id, userId);
        return this.getCartSummary(userCart.id, userId, sessionId);
      }

      for (const guestItem of guestCart.items) {
        const existingItems = await tx.cartItem.findMany({
          where: {
            cartId: userCart.id,
            itemType: guestItem.itemType,
            productId: guestItem.productId,
            packageId: guestItem.packageId,
            variantId: guestItem.variantId,
          },
        });

        const existingItem = existingItems.find(
          (item) =>
            JSON.stringify(item.selectedAddons) ===
            JSON.stringify(guestItem.selectedAddons),
        );

        if (existingItem) {
          await tx.cartItem.update({
            where: { id: existingItem.id },
            data: {
              quantity: existingItem.quantity + guestItem.quantity,

              totalPrice:
                Number(existingItem.totalPrice) + Number(guestItem.totalPrice),
            },
          });
        } else {
          await tx.cartItem.create({
            data: {
              cartId: userCart.id,
              itemType: guestItem.itemType,
              productId: guestItem.productId,
              packageId: guestItem.packageId,
              variantId: guestItem.variantId,
              quantity: guestItem.quantity,
              unitPrice: guestItem.unitPrice,
              totalPrice: guestItem.totalPrice,
              selectedAddons: guestItem.selectedAddons,
              specialInstructions: guestItem.specialInstructions,
            },
          });
        }
      }

      await tx.cart.delete({
        where: { id: guestCart.id },
      });

      await this.updateCartTotal(userCart.id);

      //return this.getCartSummary(userCart.id, userId);
      return this.getCartSummary(userCart.id, userId, sessionId);
    });
  }

  /**
   * Update cart item quantity
   */
  // async updateCartItemQuantity(cartItemId: string, quantity: number) {
  //   if (quantity < 1) {
  //     return this.removeCartItem(cartItemId);
  //   }

  //   const cartItem = await this.prisma.cartItem.findUnique({
  //     where: { id: cartItemId },
  //   });

  //   if (!cartItem) {
  //     throw new NotFoundException('Cart item not found');
  //   }

  //   const newTotalPrice = cartItem.unitPrice * quantity;

  //   // Calculate add-ons total if any
  //   let addonsTotal = 0;
  //   if (cartItem.selectedAddons && Array.isArray(cartItem.selectedAddons)) {
  //     addonsTotal = (
  //       cartItem.selectedAddons as Array<{ price: number }>
  //     ).reduce((sum, addon) => sum + addon.price, 0);
  //   }

  //   await this.prisma.cartItem.update({
  //     where: { id: cartItemId },
  //     data: {
  //       quantity,
  //       totalPrice: newTotalPrice + addonsTotal * quantity,
  //     },
  //   });

  //   await this.updateCartTotal(cartItem.cartId);

  //   return this.getCartSummary(cartItem.cartId);
  // }
  async updateCartItemQuantity(
    cartItemId: string,
    quantity: number,
    userId?: string,
    sessionId?: string,
  ) {
    if (!userId && !sessionId) {
      throw new UnauthorizedException('Unauthorized');
    }

    if (quantity < 1) {
      return this.removeCartItem(cartItemId, userId, sessionId);
    }

    const cartItem = await this.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: { cart: true },
    });

    if (!cartItem) {
      throw new NotFoundException('Cart item not found');
    }

    // 🔒 Ownership check
    if (
      (userId && cartItem.cart.userId !== userId) ||
      (!userId && cartItem.cart.sessionId !== sessionId)
    ) {
      throw new ForbiddenException('Access denied to this cart item');
    }

    const newTotalPrice = cartItem.unitPrice * quantity;

    // Calculate add-ons total if any
    let addonsTotal = 0;
    if (cartItem.selectedAddons && Array.isArray(cartItem.selectedAddons)) {
      addonsTotal = (
        cartItem.selectedAddons as Array<{ price: number }>
      ).reduce((sum, addon) => sum + addon.price, 0);
    }

    await this.prisma.cartItem.update({
      where: { id: cartItemId },
      data: {
        quantity,
        totalPrice: newTotalPrice + addonsTotal * quantity,
      },
    });

    await this.updateCartTotal(cartItem.cartId);

    return this.getCartSummary(cartItem.cartId, userId, sessionId);
  }

  /**
   * Remove item from cart
   */
  // async removeCartItem(cartItemId: string) {
  //   const cartItem = await this.prisma.cartItem.findUnique({
  //     where: { id: cartItemId },
  //   });

  //   if (!cartItem) {
  //     throw new NotFoundException('Cart item not found');
  //   }

  //   await this.prisma.cartItem.delete({
  //     where: { id: cartItemId },
  //   });

  //   await this.updateCartTotal(cartItem.cartId);

  //   return this.getCartSummary(cartItem.cartId);
  // }
  async removeCartItem(
    cartItemId: string,
    userId?: string,
    sessionId?: string,
  ) {
    if (!userId && !sessionId) {
      throw new UnauthorizedException('Unauthorized');
    }

    const cartItem = await this.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: { cart: true },
    });

    if (!cartItem) {
      throw new NotFoundException('Cart item not found');
    }

    // 🔒 Ownership check
    if (
      (userId && cartItem.cart.userId !== userId) ||
      (!userId && cartItem.cart.sessionId !== sessionId)
    ) {
      throw new ForbiddenException('Access denied to this cart item');
    }

    await this.prisma.cartItem.delete({
      where: { id: cartItemId },
    });

    await this.updateCartTotal(cartItem.cartId);

    return this.getCartSummary(cartItem.cartId, userId, sessionId);
  }

  /**
   * Get cart summary with calculations
   * Get a detailed summary of an active cart.
   * Supports both authenticated (userId) and guest (sessionId) access.
   * Can be used within a transaction by passing the `tx` client.
   */

  /**
   * Get cart summary – only for ACTIVE carts, with ownership check.
   * Can be used inside a transaction by passing `tx`.
   */
  async getCartSummary(
    cartId: string,
    userId?: string,
    sessionId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<CartSummaryDto> {
    if (!userId && !sessionId) {
      throw new UnauthorizedException(
        'Either userId or sessionId must be provided',
      );
    }

    const prisma = tx ?? this.prisma;

    const cart = await prisma.cart.findFirst({
      where: {
        id: cartId,
        status: CartStatus.ACTIVE,
        ...(userId ? { userId } : { sessionId }),
      },
      include: {
        items: {
          include: {
            product: {
              include: {
                store: true,
                productImages: {
                  orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
                  take: 1,
                },
              },
            },
            package: { include: { store: true } },
          },
        },
      },
    });

    if (!cart) {
      throw new NotFoundException('Active cart not found or access denied');
    }

    const items: CartItemDto[] = cart.items.map((item) => {
      if (item.itemType === 'PRODUCT') {
        const product = item.product;
        return {
          id: item.id,
          itemType: item.itemType,
          productId: item.productId,
          variantId: item.variantId,
          packageId: null,
          name: product?.productName || 'Product (deleted)',
          imageUrl: product?.productImages?.[0]?.imageUrl || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          selectedAddons: Array.isArray(item.selectedAddons)
            ? item.selectedAddons
            : [],
          storeId: product?.storeId || null,
          storeName: product?.store?.storeName || null,
          specialInstructions: item.specialInstructions,
        };
      }
      const pkg = item.package;
      return {
        id: item.id,
        itemType: item.itemType,
        productId: null,
        variantId: null,
        packageId: item.packageId,
        name: pkg?.name || 'Package (deleted)',
        imageUrl: null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        selectedAddons: [],
        storeId: pkg?.storeId || null,
        storeName: pkg?.store?.storeName || null,
        specialInstructions: item.specialInstructions,
      };
    });

    const subtotal = items.reduce((sum, i) => sum + i.totalPrice, 0);
    const [deliveryFee, serviceFee, taxAmount] = await Promise.all([
      this.calculateDeliveryFee(cartId, prisma),
      this.calculateServiceFee(subtotal, prisma),
      this.calculateTax(subtotal, prisma),
    ]);

    return {
      cartId: cart.id,
      items,
      subtotal,
      deliveryFee,
      serviceFee,
      taxAmount,
      totalAmount: subtotal + deliveryFee + serviceFee + taxAmount,
    };
  }

  async getCartSummaryMostRecent(
    cartId: string,
    userId?: string,
    sessionId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<CartSummaryDto> {
    // 1. Validate identity
    if (!userId && !sessionId) {
      throw new UnauthorizedException(
        'Either userId or sessionId must be provided',
      );
    }

    const prisma = tx ?? this.prisma;

    // 2. Fetch the cart – enforce ownership and ACTIVE status in one query
    const cart = await prisma.cart.findFirst({
      where: {
        id: cartId,
        status: CartStatus.ACTIVE,
        ...(userId ? { userId } : { sessionId }),
      },
      include: {
        items: {
          include: {
            product: {
              include: {
                store: true,
                productImages: {
                  orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
                  take: 1,
                },
              },
            },
            package: {
              include: { store: true }, // assume package belongs to a store
            },
          },
        },
      },
    });

    if (!cart) {
      throw new NotFoundException(
        'Active cart not found or you do not have access to it',
      );
    }

    // 3. Map cart items to a clean DTO
    const items = cart.items.map((item) => {
      if (item.itemType === 'PRODUCT') {
        const product = item.product;
        if (!product) {
          // Product may have been deleted – handle gracefully
          this.logger.warn(
            `Cart item ${item.id} references missing product ${item.productId}`,
          );
        }

        const imageUrl = product?.productImages?.[0]?.imageUrl || null;

        return {
          id: item.id,
          itemType: item.itemType,
          productId: item.productId,
          variantId: item.variantId,
          packageId: null,
          name: product?.productName || 'Product (deleted)',
          imageUrl,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          selectedAddons: Array.isArray(item.selectedAddons)
            ? item.selectedAddons
            : [],
          storeId: product?.storeId || null,
          storeName: product?.store?.storeName || null,
          specialInstructions: item.specialInstructions,
        };
      }

      // PACKAGE or DOCUMENT
      const pkg = item.package;
      if (!pkg) {
        this.logger.warn(
          `Cart item ${item.id} references missing package ${item.packageId}`,
        );
      }

      return {
        id: item.id,
        itemType: item.itemType,
        productId: null,
        variantId: null,
        packageId: item.packageId,
        name: pkg?.name || 'Package (deleted)',
        imageUrl: null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        selectedAddons: [],
        storeId: pkg?.storeId || null,
        storeName: pkg?.store?.storeName || null,
        specialInstructions: item.specialInstructions,
      };
    });

    // 4. Calculate subtotal
    const subtotal = items.reduce((sum, i) => sum + i.totalPrice, 0);

    // 5. Calculate fees – pass the transaction client for consistency
    //    (Implement these methods to accept the optional tx parameter)
    const [deliveryFee, serviceFee, taxAmount] = await Promise.all([
      this.calculateDeliveryFee(cartId, prisma),
      this.calculateServiceFee(subtotal, prisma),
      this.calculateTax(subtotal, prisma),
    ]);

    return {
      cartId: cart.id,
      items,
      subtotal,
      deliveryFee,
      serviceFee,
      taxAmount,
      totalAmount: subtotal + deliveryFee + serviceFee + taxAmount,
    };
  }

  async getCartSummaryRecent(
    cartId: string,
    userId?: string,
    sessionId?: string,
  ): Promise<CartSummaryDto> {
    if (!userId && !sessionId) {
      throw new UnauthorizedException('Unauthorized');
    }

    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: {
            product: {
              include: {
                store: true,
                productImages: {
                  orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
                  take: 1,
                },
              },
            },
            package: true,
          },
        },
      },
    });

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    // 🔒 Ownership check
    if (
      (userId && cart.userId !== userId) ||
      (!userId && cart.sessionId !== sessionId)
    ) {
      throw new ForbiddenException('Access denied to this cart');
    }

    const items = cart.items.map((item) => {
      if (item.itemType === 'PRODUCT') {
        const product = item.product;
        const imageUrl = product?.productImages?.[0]?.imageUrl || null;

        return {
          id: item.id,
          itemType: item.itemType,
          productId: item.productId,
          packageId: item.packageId,
          name: product?.productName || 'Product',
          imageUrl,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          selectedAddons: Array.isArray(item.selectedAddons)
            ? item.selectedAddons
            : [],
          storeName: product?.store?.storeName,
          specialInstructions: item.specialInstructions,
        };
      }

      // PACKAGE
      return {
        id: item.id,
        itemType: item.itemType,
        productId: null,
        packageId: item.packageId,
        name: item.package?.name || 'Package',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        specialInstructions: item.specialInstructions,
      };
    });

    // 💰 Calculations
    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);

    const [deliveryFee, serviceFee, taxAmount] = await Promise.all([
      this.calculateDeliveryFee(cartId),
      this.calculateServiceFee(subtotal),
      this.calculateTax(subtotal),
    ]);

    return {
      cartId: cart.id,
      items,
      subtotal,
      deliveryFee,
      serviceFee,
      taxAmount,
      totalAmount: subtotal + deliveryFee + serviceFee + taxAmount,
    };
  }

  async getCartSummaryOld(cartId: string): Promise<CartSummaryDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: true,
      },
    });

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    // Get full item details
    const items = await Promise.all(
      cart.items.map(async (item) => {
        if (item.itemType === 'PRODUCT') {
          const product = await this.prisma.product.findUnique({
            where: { id: item.productId },
            include: { store: true },
          });
          return {
            id: item.id,
            itemType: item.itemType,
            productId: item.productId,
            packageId: item.packageId,
            name: product?.productName || 'Product',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            selectedAddons: Array.isArray(item.selectedAddons)
              ? item.selectedAddons
              : [],
            storeName: product?.store?.storeName,
            specialInstructions: item.specialInstructions,
          };
        } else {
          const package_item = await this.prisma.package.findUnique({
            where: { id: item.packageId },
          });
          return {
            id: item.id,
            itemType: item.itemType,
            productId: null,
            packageId: item.packageId,
            name: package_item?.name || 'Package',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            specialInstructions: item.specialInstructions,
          };
        }
      }),
    );

    // Calculate fees and taxes
    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const deliveryFee = await this.calculateDeliveryFee(cartId);
    const serviceFee = await this.calculateServiceFee(subtotal);
    const taxAmount = await this.calculateTax(subtotal);

    return {
      cartId: cart.id,
      items,
      subtotal,
      deliveryFee,
      serviceFee,
      taxAmount,
      totalAmount: subtotal + deliveryFee + serviceFee + taxAmount,
    };
  }

  /**
   * Clear cart
   */
  async clearCart(cartId: string) {
    await this.prisma.cartItem.deleteMany({
      where: { cartId },
    });

    await this.prisma.cart.update({
      where: { id: cartId },
      data: { totalAmount: 0 },
    });
  }

  // Private helper methods
  private async getProductDetails(productId: string, variantId?: string) {
    if (variantId) {
      const variant = await this.prisma.variant.findUnique({
        where: { id: variantId },
      });
      if (!variant) throw new NotFoundException('Variant not found');
      return { price: variant.price };
    } else {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
      });
      if (!product) throw new NotFoundException('Product not found');
      return { price: product.basePrice };
    }
  }

  private async getAddonDetails(addonIds: string[]) {
    return this.prisma.addon.findMany({
      where: { id: { in: addonIds } },
    });
  }

  private async getPackageDetails(packageId: string) {
    const package_item = await this.prisma.package.findUnique({
      where: { id: packageId },
    });
    if (!package_item) throw new NotFoundException('Package not found');
    return package_item;
  }

  // private async updateCartTotal(cartId: string) {
  //   const items = await this.prisma.cartItem.findMany({
  //     where: { cartId },
  //   });

  //   const total = items.reduce((sum, item) => sum + item.totalPrice, 0);

  //   await this.prisma.cart.update({
  //     where: { id: cartId },
  //     data: { totalAmount: total },
  //   });
  // }

  // private async calculateDeliveryFee(cartId: string): Promise<number> {
  //   // In production, calculate based on distance and delivery option
  //   return 500; // Mock delivery fee
  // }

  // private async calculateServiceFee(subtotal: number): Promise<number> {
  //   const serviceFees = await this.prisma.serviceFee.findMany({
  //     where: { isActive: true },
  //   });

  //   let totalServiceFee = 0;
  //   for (const fee of serviceFees) {
  //     if (fee.feeType === 'PERCENTAGE') {
  //       totalServiceFee += (subtotal * fee.value) / 100;
  //     } else {
  //       totalServiceFee += fee.value;
  //     }
  //   }

  //   return totalServiceFee;
  // }

  // private async calculateTax(subtotal: number): Promise<number> {
  //   const taxes = await this.prisma.taxSetting.findMany({
  //     where: { isActive: true },
  //   });

  //   let totalTax = 0;
  //   for (const tax of taxes) {
  //     totalTax += (subtotal * tax.rate) / 100;
  //   }

  //   return totalTax;
  // }

  /**
   * Calculate delivery fee.
   * In production, compute based on distance and delivery option.
   * Accepts optional transaction client for use inside transactions.
   */
  async calculateDeliveryFee(
    cartId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    // Use provided transaction client or fallback to default
    const prisma = tx ?? this.prisma;

    // In production, calculate based on cart items, distance, delivery option, etc.
    // For now, return a mock fee.
    return 500;
  }

  /**
   * Calculate service fee based on active service fee configurations.
   * Supports both percentage and fixed fees.
   * Accepts optional transaction client for use inside transactions.
   */
  async calculateServiceFee(
    subtotal: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const prisma = tx ?? this.prisma;

    const serviceFees = await prisma.serviceFee.findMany({
      where: { isActive: true },
    });

    let totalServiceFee = 0;
    for (const fee of serviceFees) {
      if (fee.feeType === 'PERCENTAGE') {
        totalServiceFee += (subtotal * fee.value) / 100;
      } else {
        totalServiceFee += fee.value;
      }
    }

    return totalServiceFee;
  }

  /**
   * Calculate tax based on active tax settings.
   * Accepts optional transaction client for use inside transactions.
   */
  async calculateTax(
    subtotal: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const prisma = tx ?? this.prisma;

    const taxes = await prisma.taxSetting.findMany({
      where: { isActive: true },
    });

    let totalTax = 0;
    for (const tax of taxes) {
      totalTax += (subtotal * tax.rate) / 100;
    }

    return totalTax;
  }
}
