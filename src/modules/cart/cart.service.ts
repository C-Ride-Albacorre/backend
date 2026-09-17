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
import { CartStatus, CommissionStatus, Prisma } from '@prisma/client';
import { JsonValue } from '@prisma/client/runtime/library';

export interface DeliveryOptionDto {
  id: string;
  name: string;
  deliveryType: string;
  icon: string | null;
  location: string;
  distanceKm: number;          // now road distance when Routes API succeeds
  deliveryFee: number;
  deliveryRadiusKm: number;
  isOutOfRange: boolean;

  // ── ETA ─────────────────────────────────────────────────────────────
  etaMinutesMin: number;
  etaMinutesMax: number;
  etaLabel: string;

  // ── Diagnostics (optional, useful while you tune) ───────────────────
  distanceSource: 'google_routes' | 'haversine';
}

export interface DeliveryOptionDtoOld {
  id: string;              // VehicleTypeConfig.id  → pass back as dto.deliveryOptionId
  name: string;
  deliveryType: string;
  icon: string | null;
  location: string;
  distanceKm: number;
  deliveryFee: number;
  deliveryRadiusKm: number;
  isOutOfRange: boolean;
}

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private prisma: PrismaService) { }


  // Small helper — keeps the mapping consistent between in-range and fallback
  private toDeliveryOptionDto(
    config: {
      id: string;
      name: string;
      deliveryType: string;
      icon: string | null;
      location: string;
      deliveryRadiusKm: number;
      minDeliveryFee: Prisma.Decimal | number;
      perKmRate: Prisma.Decimal | number;
      distanceBands?: Array<{
        minDistanceKm: number;
        maxDistanceKm: number;
        fee?: Prisma.Decimal | number | null;
        ratePerKm?: Prisma.Decimal | number | null;
      }>;
    },
    distanceKm: number,
    durationSeconds: number | null,
    distanceSource: 'google_routes' | 'haversine',
    isOutOfRange: boolean,
  ): DeliveryOptionDto {
    const eta = this.computeEtaRangeFromDuration(
      durationSeconds ?? Math.max(60, (distanceKm / 25) * 3600),
    );

    return {
      id: config.id,
      name: config.name,
      deliveryType: config.deliveryType,
      icon: config.icon,
      location: config.location,
      distanceKm: Number(distanceKm.toFixed(2)),
      deliveryFee: Number(
        Helper.computeFeeFromConfig(
          {
            minDeliveryFee: Number(config.minDeliveryFee),
            perKmRate: Number(config.perKmRate),
            distanceBands: config.distanceBands?.map((band) => ({
              minDistanceKm: band.minDistanceKm,
              maxDistanceKm: band.maxDistanceKm,
              ...(band.fee != null ? { fee: Number(band.fee) } : {}),
              ...(band.ratePerKm != null
                ? { ratePerKm: Number(band.ratePerKm) }
                : {}),
            })),
          },
          distanceKm,
        ).toFixed(2),
      ),
      deliveryRadiusKm: config.deliveryRadiusKm,
      isOutOfRange,
      etaMinutesMin: eta.min,
      etaMinutesMax: eta.max,
      etaLabel: eta.label,
      distanceSource,
    };
  }
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
    this.logger.log(
      `getOrCreateCart called: hasUserId=${!!userId}, hasSessionId=${!!sessionId}, usingTransaction=${!!tx}`,
    );

    if (!userId && !sessionId) {
      this.logger.warn('getOrCreateCart called without userId or sessionId');
      throw new BadRequestException('User or sessionId must be provided');
    }

    const prisma = tx ?? this.prisma;
    const safeSessionId = sessionId?.trim() || null;
    const hasUser = !!userId;

    try {
      if (hasUser) {
        this.logger.log(`Looking for active cart for user ${userId}`);

        // 1. Try to find an ACTIVE cart
        let cart = await prisma.cart.findFirst({
          where: {
            userId,
            status: CartStatus.ACTIVE,
          },
          include: { items: true },
        });

        if (cart) {
          this.logger.log(
            `Found active cart ${cart.id} for user ${userId} with ${cart.items.length} item(s)`,
          );

          return cart;
        }

        this.logger.log(
          `No active cart found for user ${userId}, checking for existing carts`,
        );

        // 2. Find ANY existing cart for this user
        const existingCart = await prisma.cart.findFirst({
          where: { userId },
          include: { items: true },
        });

        if (existingCart) {
          this.logger.log(
            `Found existing cart ${existingCart.id} for user ${userId} with status ${existingCart.status}. Resetting cart`,
          );

          // 3. Reuse existing cart
          cart = await prisma.cart.update({
            where: { id: existingCart.id },
            data: {
              status: CartStatus.ACTIVE,
              items: { deleteMany: {} },
              checkedOutAt: null,
              totalAmount: 0,
            },
            include: { items: true },
          });

          this.logger.log(
            `Reset existing cart ${cart.id} to ACTIVE for user ${userId}`,
          );

          return cart;
        }

        this.logger.log(
          `No existing cart found for user ${userId}, creating a new cart`,
        );

        // 4. No cart at all – create a fresh one
        cart = await prisma.cart.create({
          data: {
            userId,
            status: CartStatus.ACTIVE,
          },
          include: { items: true },
        });

        this.logger.log(
          `Created new active cart ${cart.id} for user ${userId}`,
        );

        return cart;
      }

      // Guest flow
      this.logger.log(
        `Guest cart flow started for session ${safeSessionId}`,
      );

      // 1. Try to find an ACTIVE cart
      let cart = await prisma.cart.findFirst({
        where: {
          sessionId: safeSessionId,
          status: CartStatus.ACTIVE,
        },
        include: { items: true },
      });

      if (cart) {
        this.logger.log(
          `Found active guest cart ${cart.id} for session ${safeSessionId} with ${cart.items.length} item(s)`,
        );

        return cart;
      }

      this.logger.log(
        `No active guest cart found for session ${safeSessionId}, checking for existing carts`,
      );

      // 2. Find ANY existing guest cart
      const existingGuestCart = await prisma.cart.findFirst({
        where: { sessionId: safeSessionId },
        include: { items: true },
      });

      if (existingGuestCart) {
        this.logger.log(
          `Found existing guest cart ${existingGuestCart.id} with status ${existingGuestCart.status}. Resetting cart`,
        );

        // 3. Reuse existing guest cart
        cart = await prisma.cart.update({
          where: { id: existingGuestCart.id },
          data: {
            status: CartStatus.ACTIVE,
            items: { deleteMany: {} },
            checkedOutAt: null,
            totalAmount: 0,
          },
          include: { items: true },
        });

        this.logger.log(
          `Reset existing guest cart ${cart.id} to ACTIVE for session ${safeSessionId}`,
        );

        return cart;
      }

      this.logger.log(
        `No existing guest cart found for session ${safeSessionId}, creating a new cart`,
      );

      // 4. Create fresh guest cart
      cart = await prisma.cart.create({
        data: {
          sessionId: safeSessionId,
          status: CartStatus.ACTIVE,
        },
        include: { items: true },
      });

      this.logger.log(
        `Created new active guest cart ${cart.id} for session ${safeSessionId}`,
      );

      return cart;
    } catch (error) {
      this.logger.error(
        `Failed to get or create cart: ${error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );

      throw error;
    }
  }


  async getOrCreateCartbk0(userId?: string, sessionId?: string, tx?: Prisma.TransactionClient) {
    if (!userId && !sessionId) {
      throw new BadRequestException('User or sessionId must be provided');
    }

    const prisma = tx ?? this.prisma;
    const safeSessionId = sessionId?.trim() || null;
    const hasUser = !!userId;

    if (hasUser) {
      // 1. Try to find an ACTIVE cart
      let cart = await prisma.cart.findFirst({
        where: { userId, status: CartStatus.ACTIVE },
        include: { items: true },
      });

      if (!cart) {
        // 2. Find ANY existing cart for this user (regardless of status)
        const existingCart = await prisma.cart.findFirst({
          where: { userId },
          include: { items: true },
        });

        if (existingCart) {
          // 3. Reuse the existing cart: set status to ACTIVE and clear all items & totals
          cart = await prisma.cart.update({
            where: { id: existingCart.id },
            data: {
              status: CartStatus.ACTIVE,
              items: { deleteMany: {} },   // remove all old items
              checkedOutAt: null,
              totalAmount: 0,
            },
            include: { items: true },
          });
          this.logger.log(`Reset existing cart ${cart.id} to active for user ${userId}`);
        } else {
          // 4. No cart at all – create a fresh one
          cart = await prisma.cart.create({
            data: { userId, status: CartStatus.ACTIVE },
            include: { items: true },
          });
          this.logger.log(`Created new active cart ${cart.id} for user ${userId}`);
        }
      }
      return cart;
    } else {
      // Guest flow (no unique constraint on sessionId, but still safe to reuse)
      let cart = await prisma.cart.findFirst({
        where: { sessionId: safeSessionId, status: CartStatus.ACTIVE },
        include: { items: true },
      });

      if (!cart) {
        const existingGuestCart = await prisma.cart.findFirst({
          where: { sessionId: safeSessionId },
          include: { items: true },
        });
        if (existingGuestCart) {
          cart = await prisma.cart.update({
            where: { id: existingGuestCart.id },
            data: {
              status: CartStatus.ACTIVE,
              items: { deleteMany: {} },
              checkedOutAt: null,
              totalAmount: 0,
            },
            include: { items: true },
          });
          this.logger.log(`Reset existing guest cart ${cart.id} to active for session ${safeSessionId}`);
        } else {
          cart = await prisma.cart.create({
            data: { sessionId: safeSessionId, status: CartStatus.ACTIVE },
            include: { items: true },
          });
          this.logger.log(`Created new active cart ${cart.id} for guest session ${safeSessionId}`);
        }
      }
      return cart;
    }
  }

  async getOrCreateCartVRecent(
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
   * Add item to cart – uses active cart (creates one if needed).
   */

  async addToCart(
    userId: string | null,
    dto: AddToCartDto,
    sessionId?: string,
  ) {
    const cart = await this.getOrCreateCart(userId || undefined, sessionId);

    // Get storeId of the incoming item
    let incomingStoreId: string;

    if (dto.itemType === 'PRODUCT') {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { storeId: true },
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      incomingStoreId = product.storeId;
    } else {
      const pkg = await this.prisma.package.findUnique({
        where: { id: dto.packageId },
        select: { storeId: true },
      });

      if (!pkg) {
        throw new NotFoundException('Package not found');
      }

      incomingStoreId = pkg.storeId;
    }

    // Check existing cart store
    const existingItem = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id },
      include: {
        product: {
          select: { storeId: true },
        },
        package: {
          select: { storeId: true },
        },
      },
    });

    if (existingItem) {
      const existingStoreId =
        existingItem.product?.storeId || existingItem.package?.storeId;

      if (existingStoreId !== incomingStoreId) {
        throw new BadRequestException(
          'You can only add items from one store per cart',
        );
      }
    }
    // const cart = await this.getOrCreateCart(userId || undefined, sessionId);

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
        ///added this new////
        let addonsTotal = 0;
        if (dto.addonIds?.length) {
          selectedAddons = await this.getAddonDetails(dto.addonIds);
          addonsTotal = selectedAddons.reduce((sum, addon) => sum + addon.price, 0);
        }
        // unitPrice = productDetails.price + addonsTotal;   // includes add‑ons
        // totalPrice = unitPrice * dto.quantity;
        // // unitPrice = productDetails.price;
        // // totalPrice = unitPrice * dto.quantity;
        // if (dto.addonIds?.length) {
        //   selectedAddons = await this.getAddonDetails(dto.addonIds);
        //   const addonsTotal = selectedAddons.reduce(
        //     (sum, addon) => sum + addon.price,
        //     0,
        //   );
        //   totalPrice += addonsTotal * dto.quantity;
        // }
        unitPrice = productDetails.price + addonsTotal;   // 18,000
        totalPrice = unitPrice * dto.quantity;            // 18,000

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
  async mergeGuestCart(userId: string, sessionId: string): Promise<CartSummaryDto> {
    if (!userId || !sessionId) {
      throw new BadRequestException('Both userId and sessionId are required');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // ------------------------------------------------------
        // 1. Get or create an ACTIVE cart for the user
        // ------------------------------------------------------
        let userCart = await tx.cart.findFirst({
          where: { userId, status: CartStatus.ACTIVE },
          include: { items: true },
        });

        if (!userCart) {
          // Check if a cart exists for this user (any status)
          const existingCart = await tx.cart.findFirst({
            where: { userId },
            include: { items: true },
          });

          if (existingCart) {
            // Reuse the existing cart: set status to ACTIVE and clear old items
            userCart = await tx.cart.update({
              where: { id: existingCart.id },
              data: {
                status: CartStatus.ACTIVE,
                items: { deleteMany: {} },   // remove all previous items
                checkedOutAt: null,           // reset checkout timestamp
              },
              include: { items: true },
            });
            this.logger.log(
              `Reused existing cart ${userCart.id} for user ${userId} (was ${existingCart.status})`,
            );
          } else {
            // No cart at all – create a fresh one
            userCart = await tx.cart.create({
              data: { userId, status: CartStatus.ACTIVE },
              include: { items: true },
            });
            this.logger.log(`Created new active cart ${userCart.id} for user ${userId}`);
          }
        }

        // ------------------------------------------------------
        // 2. Get guest's ACTIVE cart
        // ------------------------------------------------------
        const guestCart = await tx.cart.findFirst({
          where: { sessionId, status: CartStatus.ACTIVE },
          include: { items: true },
        });

        if (!guestCart || guestCart.items.length === 0) {
          // Nothing to merge – return current user cart summary
          return this.getCartSummary(
            userCart.id,
            userId,
            undefined,
            undefined,
            undefined,
            tx,
          );
        }

        // ------------------------------------------------------
        // 3. Merge guest items into user cart
        // ------------------------------------------------------
        for (const guestItem of guestCart.items) {
          const existingItem = await tx.cartItem.findFirst({
            where: {
              cartId: userCart.id,
              itemType: guestItem.itemType,
              productId: guestItem.productId,
              packageId: guestItem.packageId,
              variantId: guestItem.variantId,
              selectedAddons: { equals: this.normalizeAddons(guestItem.selectedAddons) },
            },
          });

          if (existingItem) {
            await tx.cartItem.update({
              where: { id: existingItem.id },
              data: {
                quantity: existingItem.quantity + guestItem.quantity,
                totalPrice: Number(existingItem.totalPrice) + Number(guestItem.totalPrice),
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

        // ------------------------------------------------------
        // 4. Delete the guest cart
        // ------------------------------------------------------
        await tx.cart.delete({ where: { id: guestCart.id } });

        // ------------------------------------------------------
        // 5. Update user cart total
        // ------------------------------------------------------
        await this.updateCartTotal(userCart.id, tx);

        // ------------------------------------------------------
        // 6. Return merged cart summary
        // ------------------------------------------------------
        return this.getCartSummary(userCart.id, userId, undefined, undefined, undefined, tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    );
  }

  // async mergeGuestCartOld(userId: string, sessionId: string): Promise<CartSummaryDto> {
  //   if (!userId || !sessionId) {
  //     throw new BadRequestException('Both userId and sessionId are required');
  //   }

  //   return this.prisma.$transaction(
  //     async (tx) => {
  //       // ------------------------------------------------------
  //       // 1. Get or create an ACTIVE cart for the user
  //       // ------------------------------------------------------
  //       let userCart = await tx.cart.findFirst({
  //         where: { userId, status: CartStatus.ACTIVE },
  //         include: { items: true },
  //       });

  //       if (!userCart) {
  //         // Check if a cart exists for this user (any status)
  //         const existingCart = await tx.cart.findFirst({
  //           where: { userId },
  //           include: { items: true },
  //         });

  //         if (existingCart) {
  //           // Reuse the existing cart: set status to ACTIVE and clear old items
  //           userCart = await tx.cart.update({
  //             where: { id: existingCart.id },
  //             data: {
  //               status: CartStatus.ACTIVE,
  //               items: { deleteMany: {} },   // remove all previous items
  //               checkedOutAt: null,           // reset checkout timestamp
  //             },
  //             include: { items: true },
  //           });
  //           this.logger.log(
  //             `Reused existing cart ${userCart.id} for user ${userId} (was ${existingCart.status})`,
  //           );
  //         } else {
  //           // No cart at all – create a fresh one
  //           userCart = await tx.cart.create({
  //             data: { userId, status: CartStatus.ACTIVE },
  //             include: { items: true },
  //           });
  //           this.logger.log(`Created new active cart ${userCart.id} for user ${userId}`);
  //         }
  //       }

  //       // ------------------------------------------------------
  //       // 2. Get guest's ACTIVE cart
  //       // ------------------------------------------------------
  //       const guestCart = await tx.cart.findFirst({
  //         where: { sessionId, status: CartStatus.ACTIVE },
  //         include: { items: true },
  //       });

  //       if (!guestCart || guestCart.items.length === 0) {
  //         // Nothing to merge – return current user cart summary
  //         return this.getCartSummary(userCart.id, userId, undefined, tx);
  //       }

  //       // ------------------------------------------------------
  //       // 3. Merge guest items into user cart
  //       // ------------------------------------------------------
  //       for (const guestItem of guestCart.items) {
  //         const existingItem = await tx.cartItem.findFirst({
  //           where: {
  //             cartId: userCart.id,
  //             itemType: guestItem.itemType,
  //             productId: guestItem.productId,
  //             packageId: guestItem.packageId,
  //             variantId: guestItem.variantId,
  //             selectedAddons: { equals: this.normalizeAddons(guestItem.selectedAddons) },
  //           },
  //         });

  //         if (existingItem) {
  //           await tx.cartItem.update({
  //             where: { id: existingItem.id },
  //             data: {
  //               quantity: existingItem.quantity + guestItem.quantity,
  //               totalPrice: Number(existingItem.totalPrice) + Number(guestItem.totalPrice),
  //             },
  //           });
  //         } else {
  //           await tx.cartItem.create({
  //             data: {
  //               cartId: userCart.id,
  //               itemType: guestItem.itemType,
  //               productId: guestItem.productId,
  //               packageId: guestItem.packageId,
  //               variantId: guestItem.variantId,
  //               quantity: guestItem.quantity,
  //               unitPrice: guestItem.unitPrice,
  //               totalPrice: guestItem.totalPrice,
  //               selectedAddons: guestItem.selectedAddons,
  //               specialInstructions: guestItem.specialInstructions,
  //             },
  //           });
  //         }
  //       }

  //       // ------------------------------------------------------
  //       // 4. Delete the guest cart
  //       // ------------------------------------------------------
  //       await tx.cart.delete({ where: { id: guestCart.id } });

  //       // ------------------------------------------------------
  //       // 5. Update user cart total
  //       // ------------------------------------------------------
  //       await this.updateCartTotal(userCart.id, tx);

  //       // ------------------------------------------------------
  //       // 6. Return merged cart summary
  //       // ------------------------------------------------------
  //       return this.getCartSummary(userCart.id, userId, undefined, tx);
  //     },
  //     {
  //       isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  //       timeout: 10000,
  //     },
  //   );
  // }

  // async mergeGuestCartVeryRecent(
  //   userId: string,
  //   sessionId: string,
  // ): Promise<CartSummaryDto> {
  //   if (!userId || !sessionId) {
  //     throw new BadRequestException('Both userId and sessionId are required');
  //   }

  //   return this.prisma.$transaction(
  //     async (tx) => {
  //       // 1. Get or create user's active cart
  //       let userCart = await tx.cart.findFirst({
  //         where: { userId, status: CartStatus.ACTIVE },
  //         include: { items: true },
  //       });
  //       if (!userCart) {
  //         userCart = await tx.cart.create({
  //           data: { userId, status: CartStatus.ACTIVE },
  //           include: { items: true },
  //         });
  //         this.logger.log(
  //           `Created new active cart ${userCart.id} for user ${userId}`,
  //         );
  //       }

  //       // 2. Get guest's active cart (ignore non-active)
  //       const guestCart = await tx.cart.findFirst({
  //         where: { sessionId, status: CartStatus.ACTIVE },
  //         include: { items: true },
  //       });

  //       if (!guestCart || guestCart.items.length === 0) {
  //         return this.getCartSummary(userCart.id, userId, undefined, tx);
  //       }

  //       // 3. Merge items
  //       for (const guestItem of guestCart.items) {
  //         const existingItem = await tx.cartItem.findFirst({
  //           where: {
  //             cartId: userCart.id,
  //             itemType: guestItem.itemType,
  //             productId: guestItem.productId,
  //             packageId: guestItem.packageId,
  //             variantId: guestItem.variantId,
  //             selectedAddons: {
  //               equals: this.normalizeAddons(guestItem.selectedAddons as any),
  //             },
  //           },
  //         });

  //         if (existingItem) {
  //           await tx.cartItem.update({
  //             where: { id: existingItem.id },
  //             data: {
  //               quantity: existingItem.quantity + guestItem.quantity,
  //               totalPrice:
  //                 Number(existingItem.totalPrice) +
  //                 Number(guestItem.totalPrice),
  //             },
  //           });
  //         } else {
  //           await tx.cartItem.create({
  //             data: {
  //               cartId: userCart.id,
  //               itemType: guestItem.itemType,
  //               productId: guestItem.productId,
  //               packageId: guestItem.packageId,
  //               variantId: guestItem.variantId,
  //               quantity: guestItem.quantity,
  //               unitPrice: guestItem.unitPrice,
  //               totalPrice: guestItem.totalPrice,
  //               selectedAddons: guestItem.selectedAddons,
  //               specialInstructions: guestItem.specialInstructions,
  //             },
  //           });
  //         }
  //       }

  //       // 4. Delete guest cart
  //       await tx.cart.delete({ where: { id: guestCart.id } });
  //       // 5. Update total
  //       await this.updateCartTotal(userCart.id, tx);
  //       // 6. Return summary
  //       return this.getCartSummary(userCart.id, userId, undefined, tx);
  //     },
  //     {
  //       isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  //       timeout: 10000,
  //     },
  //   );
  // }

  // async mergeGuestCartMostRecent(
  //   userId: string,
  //   sessionId: string,
  // ): Promise<CartSummaryDto> {
  //   // Validate inputs
  //   if (!userId || !sessionId) {
  //     throw new BadRequestException('Both userId and sessionId are required');
  //   }

  //   // Use serializable transaction for maximum consistency
  //   return this.prisma.$transaction(
  //     async (tx) => {
  //       // 1. Get or create user's ACTIVE cart (inside transaction)
  //       let userCart = await tx.cart.findFirst({
  //         where: {
  //           userId,
  //           status: CartStatus.ACTIVE,
  //         },
  //         include: { items: true },
  //       });

  //       if (!userCart) {
  //         userCart = await tx.cart.create({
  //           data: {
  //             userId,
  //             status: CartStatus.ACTIVE,
  //           },
  //           include: { items: true },
  //         });
  //         this.logger.log(
  //           `Created new active cart ${userCart.id} for user ${userId}`,
  //         );
  //       }

  //       // 2. Get guest's ACTIVE cart (ignore non-active or non-existent)
  //       const guestCart = await tx.cart.findFirst({
  //         where: {
  //           sessionId,
  //           status: CartStatus.ACTIVE,
  //         },
  //         include: { items: true },
  //       });

  //       // 3. If no guest cart or guest cart is empty, return current user cart summary
  //       if (!guestCart || guestCart.items.length === 0) {
  //         this.logger.log(
  //           `No active guest cart to merge for session ${sessionId}`,
  //         );
  //         // Use transaction client to get summary
  //         return this.getCartSummary(userCart.id, userId, undefined, tx);
  //       }

  //       this.logger.log(
  //         `Merging ${guestCart.items.length} items from guest cart ${guestCart.id} to user cart ${userCart.id}`,
  //       );

  //       // 4. Merge each guest item into user cart
  //       for (const guestItem of guestCart.items) {
  //         // Find existing identical item in user cart (same type, IDs, and addons)
  //         const existingItem = await tx.cartItem.findFirst({
  //           where: {
  //             cartId: userCart.id,
  //             itemType: guestItem.itemType,
  //             productId: guestItem.productId,
  //             packageId: guestItem.packageId,
  //             variantId: guestItem.variantId,
  //             // Compare addons in a stable way
  //             selectedAddons: {
  //               equals: this.normalizeAddons(guestItem.selectedAddons as any),
  //             },
  //           },
  //         });

  //         if (existingItem) {
  //           // Combine quantities and total price
  //           await tx.cartItem.update({
  //             where: { id: existingItem.id },
  //             data: {
  //               quantity: existingItem.quantity + guestItem.quantity,
  //               totalPrice:
  //                 Number(existingItem.totalPrice) +
  //                 Number(guestItem.totalPrice),
  //             },
  //           });
  //           this.logger.log(
  //             `Updated existing item ${existingItem.id}, new quantity = ${existingItem.quantity + guestItem.quantity}`,
  //           );
  //         } else {
  //           // Create new cart item
  //           await tx.cartItem.create({
  //             data: {
  //               cartId: userCart.id,
  //               itemType: guestItem.itemType,
  //               productId: guestItem.productId,
  //               packageId: guestItem.packageId,
  //               variantId: guestItem.variantId,
  //               quantity: guestItem.quantity,
  //               unitPrice: guestItem.unitPrice,
  //               totalPrice: guestItem.totalPrice,
  //               selectedAddons: guestItem.selectedAddons,
  //               specialInstructions: guestItem.specialInstructions,
  //             },
  //           });
  //           this.logger.log(`Created new cart item from guest item`);
  //         }
  //       }

  //       // 5. Delete the guest cart (only after successful merge)
  //       await tx.cart.delete({
  //         where: { id: guestCart.id },
  //       });
  //       this.logger.log(`Deleted guest cart ${guestCart.id}`);

  //       // 6. Recalculate user cart total inside transaction
  //       await this.updateCartTotal(userCart.id);

  //       // 7. Return the merged cart summary using the same transaction
  //       const summary = await this.getCartSummary(
  //         userCart.id,
  //         userId,
  //         undefined,
  //         tx,
  //       );
  //       this.logger.log(
  //         `Cart merge completed. User cart ${userCart.id} now has ${summary.items.length} items, total ${summary.totalAmount}`,
  //       );
  //       return summary;
  //     },
  //     {
  //       isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  //       maxWait: 5000, // maximum time to wait for transaction to start
  //       timeout: 10000, // maximum time the transaction can run
  //     },
  //   );
  // }

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

  private normalizeAddons(addons: JsonValue): JsonValue {
    if (!addons || !Array.isArray(addons)) return addons ?? [];
    return [...addons].sort((a, b) =>
      String((a as any)?.id ?? a).localeCompare(String((b as any)?.id ?? b)),
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
    dropoffAddress?: string,
    deliveryOptionId?: string,
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
                store: { include: { category: true } },
                productImages: {
                  orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
                  take: 1,
                },
              },
            },
            variant: true,
            package: {
              include: { store: { include: { category: true } } },
            },
          },
        },
      },
    });

    if (!cart) {
      throw new NotFoundException('Active cart not found or access denied');
    }

    // ---- Map items (unchanged) -------------------------------------------
    const items: CartItemDto[] = cart.items.map((item) => {
      if (item.itemType === 'PRODUCT') {
        const product = item.product;
        return {
          id: item.id,
          itemType: item.itemType,
          productId: item.productId,
          variantId: item.variantId,
          variantType: item.variant?.variantName ?? null,
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
          categoryId: product?.store?.categoryId || null,
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
        categoryId: pkg?.store?.categoryId || null,
        specialInstructions: item.specialInstructions,
      };
    });

    const subtotal = items.reduce((sum, i) => sum + i.totalPrice, 0);

    // ---- Resolve the single vendor store ---------------------------------
    const store =
      cart.items[0]?.product?.store ?? cart.items[0]?.package?.store ?? null;

    // ---- Fees ------------------------------------------------------------
    // Delivery fee: only computable when an address has been supplied.
    let deliveryFee = 0;
    if (dropoffAddress && items.length > 0 && store) {
      // Geocode outside the fee calc so the fee method stays pure
      const coords = await Helper.geocodeAddress(dropoffAddress);

      if (!coords) {
        throw new BadRequestException(
          'Invalid dropoff address. Unable to determine location.',
        );
      }

      deliveryFee = await this.calculateDeliveryFee(
        cartId,
        { latitude: coords.lat, longitude: coords.lng },
        deliveryOptionId,
        prisma,
      );
    }

    // Service fee: single vendor → one commission lookup
    let serviceFee = 0;
    if (store) {
      serviceFee = await this.calculateServiceFee(
        subtotal,
        store.userId,
        prisma,
      );
    }

    // Tax: from GlobalSetting.taxRate
    const taxAmount = await this.calculateTax(subtotal, prisma);

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      cartId: cart.id,
      storeId: store?.id ?? null,
      storeName: store?.storeName ?? null,
      items,
      // subtotal,
      // deliveryFee,
      // serviceFee,
      // taxAmount,
      // totalAmount: subtotal + deliveryFee + serviceFee + taxAmount,
      subtotal: round2(subtotal),
      deliveryFee: round2(deliveryFee),
      serviceFee: round2(serviceFee),
      taxAmount: round2(taxAmount),
      totalAmount: round2(subtotal + deliveryFee + serviceFee + taxAmount),
    };
  }

  async getCartSummaryold(
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
                store: {
                  include: {
                    category: true, // Include category to get categoryId
                  },
                },
                productImages: {
                  orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
                  take: 1,
                },
              },
            },
            variant: true, // <-- Add this
            package: {
              include: {
                store: {
                  include: {
                    category: true, // Include category for package store
                  },
                },
              },
            },
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
          variantType: item.variant?.variantName ?? null,
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
          categoryId: product?.store?.categoryId || null, // Added categoryId
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
        categoryId: pkg?.store?.categoryId || null, // Added categoryId
        specialInstructions: item.specialInstructions,
      };
    });

    const subtotal = items.reduce((sum, i) => sum + i.totalPrice, 0);
    const [deliveryFee, serviceFee, taxAmount] = await Promise.all([
      this.calculateDeliveryFee(cartId, null, undefined, prisma),
      // 
      this.calculateServiceFee(
        subtotal,
        cart.items[0]?.product?.store?.userId ||
        cart.items[0]?.package?.store?.userId ||
        '',
        prisma,
      ),

      this.calculateTax(subtotal, prisma),

    ]);

    return {
      cartId: cart.id,
      storeId: cart.items[0]?.product?.storeId || cart.items[0]?.package?.storeId || null,
      storeName: cart.items[0]?.product?.store?.storeName || cart.items[0]?.package?.store?.storeName || null,
      items,
      subtotal,
      deliveryFee,
      serviceFee,
      taxAmount,
      totalAmount: subtotal + deliveryFee + serviceFee + taxAmount,
    };
  }

  //  async getCartSummary(
  //   cartId: string,
  //   userId?: string,
  //   sessionId?: string,
  //   tx?: Prisma.TransactionClient,
  // ): Promise<CartSummaryDto> {
  //   if (!userId && !sessionId) {
  //     throw new UnauthorizedException(
  //       'Either userId or sessionId must be provided',
  //     );
  //   }

  //   const prisma = tx ?? this.prisma;

  //   const cart = await prisma.cart.findFirst({
  //     where: {
  //       id: cartId,
  //       status: CartStatus.ACTIVE,
  //       ...(userId ? { userId } : { sessionId }),
  //     },
  //     include: {
  //       items: {
  //         include: {
  //           product: {
  //             include: {
  //               store: {
  //                 include: {
  //                   category: true, // Include category to get categoryId
  //                 },
  //               },
  //               productImages: {
  //                 orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
  //                 take: 1,
  //               },
  //             },
  //           },
  //           variant: true, // <-- Add this
  //           package: {
  //             include: {
  //               store: {
  //                 include: {
  //                   category: true, // Include category for package store
  //                 },
  //               },
  //             },
  //           },
  //         },
  //       },
  //     },
  //   });

  //   if (!cart) {
  //     throw new NotFoundException('Active cart not found or access denied');
  //   }

  //   const items: CartItemDto[] = cart.items.map((item) => {
  //     if (item.itemType === 'PRODUCT') {
  //       const product = item.product;
  //       return {
  //         id: item.id,
  //         itemType: item.itemType,
  //         productId: item.productId,
  //         variantId: item.variantId,
  //         variantType: item.variant?.variantName ?? null,
  //         packageId: null,
  //         name: product?.productName || 'Product (deleted)',
  //         imageUrl: product?.productImages?.[0]?.imageUrl || null,
  //         quantity: item.quantity,
  //         unitPrice: item.unitPrice,
  //         totalPrice: item.totalPrice,
  //         selectedAddons: Array.isArray(item.selectedAddons)
  //           ? item.selectedAddons
  //           : [],
  //         storeId: product?.storeId || null,
  //         storeName: product?.store?.storeName || null,
  //         categoryId: product?.store?.categoryId || null, // Added categoryId
  //         specialInstructions: item.specialInstructions,
  //       };
  //     }
  //     const pkg = item.package;
  //     return {
  //       id: item.id,
  //       itemType: item.itemType,
  //       productId: null,
  //       variantId: null,
  //       packageId: item.packageId,
  //       name: pkg?.name || 'Package (deleted)',
  //       imageUrl: null,
  //       quantity: item.quantity,
  //       unitPrice: item.unitPrice,
  //       totalPrice: item.totalPrice,
  //       selectedAddons: [],
  //       storeId: pkg?.storeId || null,
  //       storeName: pkg?.store?.storeName || null,
  //       categoryId: pkg?.store?.categoryId || null, // Added categoryId
  //       specialInstructions: item.specialInstructions,
  //     };
  //   });

  //   const subtotal = items.reduce((sum, i) => sum + i.totalPrice, 0);
  //   const [deliveryFee, serviceFee, taxAmount] = await Promise.all([
  //     this.calculateDeliveryFee(cartId, prisma),
  //     this.calculateServiceFee(subtotal, prisma),
  //     this.calculateTax(subtotal, prisma),
  //   ]);

  //   return {
  //     cartId: cart.id,
  //     storeId: cart.items[0]?.product?.storeId || cart.items[0]?.package?.storeId || null,
  //     storeName: cart.items[0]?.product?.store?.storeName || cart.items[0]?.package?.store?.storeName || null,
  //     items,
  //     subtotal,
  //     deliveryFee,
  //     serviceFee,
  //     taxAmount,
  //     totalAmount: subtotal + deliveryFee + serviceFee + taxAmount,
  //   };
  // }


  // async getCartSummaryWithoutStoreIdandCategoryId(
  //   cartId: string,
  //   userId?: string,
  //   sessionId?: string,
  //   tx?: Prisma.TransactionClient,
  // ): Promise<CartSummaryDto> {
  //   if (!userId && !sessionId) {
  //     throw new UnauthorizedException(
  //       'Either userId or sessionId must be provided',
  //     );
  //   }

  //   const prisma = tx ?? this.prisma;

  //   const cart = await prisma.cart.findFirst({
  //     where: {
  //       id: cartId,
  //       status: CartStatus.ACTIVE,
  //       ...(userId ? { userId } : { sessionId }),
  //     },
  //     include: {
  //       items: {
  //         include: {
  //           product: {
  //             include: {
  //               store: true,
  //               productImages: {
  //                 orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
  //                 take: 1,
  //               },
  //             },
  //           },
  //           package: { include: { store: true } },
  //         },
  //       },
  //     },
  //   });

  //   if (!cart) {
  //     throw new NotFoundException('Active cart not found or access denied');
  //   }

  //   const items: CartItemDto[] = cart.items.map((item) => {
  //     if (item.itemType === 'PRODUCT') {
  //       const product = item.product;
  //       return {
  //         id: item.id,
  //         itemType: item.itemType,
  //         productId: item.productId,
  //         variantId: item.variantId,
  //         packageId: null,
  //         name: product?.productName || 'Product (deleted)',
  //         imageUrl: product?.productImages?.[0]?.imageUrl || null,
  //         quantity: item.quantity,
  //         unitPrice: item.unitPrice,
  //         totalPrice: item.totalPrice,
  //         selectedAddons: Array.isArray(item.selectedAddons)
  //           ? item.selectedAddons
  //           : [],
  //         storeId: product?.storeId || null,
  //         storeName: product?.store?.storeName || null,
  //         specialInstructions: item.specialInstructions,
  //       };
  //     }
  //     const pkg = item.package;
  //     return {
  //       id: item.id,
  //       itemType: item.itemType,
  //       productId: null,
  //       variantId: null,
  //       packageId: item.packageId,
  //       name: pkg?.name || 'Package (deleted)',
  //       imageUrl: null,
  //       quantity: item.quantity,
  //       unitPrice: item.unitPrice,
  //       totalPrice: item.totalPrice,
  //       selectedAddons: [],
  //       storeId: pkg?.storeId || null,
  //       storeName: pkg?.store?.storeName || null,
  //       specialInstructions: item.specialInstructions,
  //     };
  //   });

  //   const subtotal = items.reduce((sum, i) => sum + i.totalPrice, 0);
  //   const [deliveryFee, serviceFee, taxAmount] = await Promise.all([
  //     this.calculateDeliveryFee(cartId, prisma),
  //     this.calculateServiceFee(subtotal, prisma),
  //     this.calculateTax(subtotal, prisma),
  //   ]);

  //   return {
  //     cartId: cart.id,
  //     storeId: cart.items[0]?.product?.storeId || cart.items[0]?.package?.storeId || null,
  //     storeName: cart.items[0]?.product?.store?.storeName || cart.items[0]?.package?.store?.storeName || null,
  //     items,
  //     subtotal,
  //     deliveryFee,
  //     serviceFee,
  //     taxAmount,
  //     totalAmount: subtotal + deliveryFee + serviceFee + taxAmount,
  //   };
  // }



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
  /**
 * Get effective product price.
 * - Without variant: returns product.basePrice.
 * - With variant: treats variant.price as a delta, returning product.basePrice + variant.price.
 * 
 * @param productId - The product ID
 * @param variantId - Optional variant ID (if not provided, returns base price)
 * @returns { price: number } – the final unit price (base + variant delta)
 * @throws NotFoundException if product or variant not found
 */
  private async getProductDetails(productId: string, variantId?: string): Promise<{ price: number }> {
    if (variantId) {
      // Fetch variant with its product (to access basePrice)
      const variant = await this.prisma.variant.findUnique({
        where: { id: variantId },
        include: { product: true },
      });
      if (!variant) {
        throw new NotFoundException(`Variant ${variantId} not found`);
      }

      // Calculate final price: basePrice + variant.price (delta)
      const finalPrice = variant.product.basePrice + variant.price;

      return { price: finalPrice };
    } else {
      // No variant – use product's base price
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
      });
      if (!product) {
        throw new NotFoundException(`Product ${productId} not found`);
      }
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


  /**
 * Turn a routing duration into a friendly ETA range.
 *
 * Google already accounts for traffic. We add:
 *   - prep/handoff time at the store (rider collects from vendor)
 *   - a variance band (traffic jitter, drop-off search, gate access)
 */
  private computeEtaRangeFromDuration(
    durationSeconds: number,
    config?: {
      minDeliveryMinutes?: number | null;
      maxDeliveryMinutes?: number | null;
    },
  ): { min: number; max: number; label: string } {
    // ── Explicit config wins (ops override) ───────────────────────────────
    if (
      config?.minDeliveryMinutes != null &&
      config?.maxDeliveryMinutes != null
    ) {
      return {
        min: config.minDeliveryMinutes,
        max: config.maxDeliveryMinutes,
        label: `${config.minDeliveryMinutes} – ${config.maxDeliveryMinutes} min`,
      };
    }

    // ── Derive from routing duration ──────────────────────────────────────
    const PREP_MINUTES = 10;  // rider pickup + handoff at store
    const MIN_VARIANCE = 0.90; // best case: 10% faster than Google's estimate
    const MAX_VARIANCE = 1.30; // worst case: 30% slower

    const baseMinutes = durationSeconds / 60 + PREP_MINUTES;

    const rawMin = baseMinutes * MIN_VARIANCE;
    const rawMax = baseMinutes * MAX_VARIANCE;

    // Round to nearest 5 for a human-friendly label
    const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
    const min = round5(rawMin);
    const max = round5(rawMax);

    return { min, max, label: `${min} – ${max} min` };
  }


  async getDeliveryOptions(
    cartId: string,
    dropoffAddress: string,
  ): Promise<DeliveryOptionDto[]> {
    this.logger.log(
      `Getting delivery options | cartId=${cartId} | dropoffAddress="${dropoffAddress}"`,
    );

    // ── 1. Geocode dropoff ─────────────────────────────────────────────────
    this.logger.debug(
      `Geocoding dropoff address | cartId=${cartId}`,
    );

    const coords = await Helper.geocodeAddress(dropoffAddress);

    if (!coords) {
      this.logger.warn(
        `Unable to geocode dropoff address | cartId=${cartId} | ` +
        `dropoffAddress="${dropoffAddress}"`,
      );

      throw new BadRequestException(
        'Invalid dropoff address. Unable to determine location.',
      );
    }

    this.logger.debug(
      `Dropoff address geocoded | cartId=${cartId} | ` +
      `latitude=${coords.lat} | longitude=${coords.lng}`,
    );

    // ── 2. Load cart + vendor store ────────────────────────────────────────
    this.logger.debug(
      `Loading cart and vendor store | cartId=${cartId}`,
    );

    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: {
            product: { include: { store: true } },
            package: { include: { store: true } },
          },
        },
      },
    });

    if (!cart) {
      this.logger.warn(`Cart not found | cartId=${cartId}`);
      throw new NotFoundException('Cart not found');
    }

    if (cart.items.length === 0) {
      this.logger.warn(`Cart is empty | cartId=${cartId}`);
      throw new BadRequestException('Cart is empty');
    }

    this.logger.debug(
      `Cart loaded | cartId=${cartId} | itemCount=${cart.items.length}`,
    );

    const firstItem = cart.items[0];
    const store = firstItem?.product?.store ?? firstItem?.package?.store;

    if (!store) {
      this.logger.warn(
        `No vendor store found for cart | cartId=${cartId}`,
      );

      throw new BadRequestException('No vendor store found for cart');
    }

    if (store.latitude == null || store.longitude == null) {
      this.logger.warn(
        `Store coordinates are not configured | cartId=${cartId} | ` +
        `storeId=${store.id} | vendorId=${store.userId}`,
      );

      throw new BadRequestException('Store coordinates are not configured');
    }

    this.logger.debug(
      `Vendor store resolved | cartId=${cartId} | ` +
      `storeId=${store.id} | vendorId=${store.userId} | ` +
      `latitude=${store.latitude} | longitude=${store.longitude}`,
    );

    const origin = {
      latitude: store.latitude,
      longitude: store.longitude,
    };

    const destination = {
      latitude: coords.lat,
      longitude: coords.lng,
    };

    // ── 3. One routing call for the whole request ──────────────────────────
    this.logger.debug(
      `Requesting route details | cartId=${cartId} | ` +
      `storeId=${store.id}`,
    );

    const route = await Helper.getRouteDetails(origin, destination);

    let distanceKm: number;
    let distanceSource: 'google_routes' | 'haversine';
    let durationSeconds: number | null = null;

    if (route) {
      distanceKm = route.distanceMeters / 1000;
      durationSeconds = route.durationSeconds;
      distanceSource = 'google_routes';

      this.logger.log(
        `Route calculated using Google Routes | cartId=${cartId} | ` +
        `distance=${distanceKm.toFixed(2)}km | ` +
        `duration=${durationSeconds}s`,
      );
    } else {
      // Graceful fallback — never block the customer on Google being down
      distanceKm = Helper.haversineDistanceKm(
        origin.latitude,
        origin.longitude,
        destination.latitude,
        destination.longitude,
      );

      distanceSource = 'haversine';

      this.logger.warn(
        `Google Routes unavailable, using Haversine distance | cartId=${cartId} | ` +
        `distance=${distanceKm.toFixed(2)}km`,
      );
    }

    // ── 4. Options within radius (road km basis when Routes succeeded) ─────
    this.logger.debug(
      `Finding delivery options within radius | cartId=${cartId} | ` +
      `distance=${distanceKm.toFixed(2)}km | ` +
      `distanceSource=${distanceSource}`,
    );

    const inRange = await this.prisma.vehicleTypeConfig.findMany({
      where: {
        isActive: true,
        deliveryRadiusKm: { gte: distanceKm },
      },
      include: { distanceBands: true },
      orderBy: { displayOrder: 'asc' },
    });

    if (inRange.length > 0) {
      this.logger.log(
        `Delivery options found | cartId=${cartId} | ` +
        `optionCount=${inRange.length} | ` +
        `distance=${distanceKm.toFixed(2)}km`,
      );

      const options = inRange.map((config) =>
        this.toDeliveryOptionDto(
          {
            ...config,
            distanceBands: config.distanceBands.map((band) => ({
              minDistanceKm: band.fromKm,
              maxDistanceKm: band.toKm,
              fee: band.flatFee,
            })),
          },
          distanceKm,
          durationSeconds,
          distanceSource,
          false,
        ),
      );

      this.logger.debug(
        `Delivery options prepared | cartId=${cartId} | ` +
        `optionCount=${options.length}`,
      );

      return options;
    }

    // ── 5. Fallback — nothing in range ────────────────────────────────────
    this.logger.warn(
      `No delivery option covers the distance | cartId=${cartId} | ` +
      `distance=${distanceKm.toFixed(2)}km | ` +
      `attempting fallback configuration`,
    );

    const fallback = await this.prisma.vehicleTypeConfig.findFirst({
      where: { isActive: true },
      orderBy: { minDeliveryFee: 'asc' },
      include: { distanceBands: true },
    });

    if (!fallback) {
      this.logger.error(
        `No active delivery configuration found | cartId=${cartId} | ` +
        `storeId=${store.id} | vendorId=${store.userId}`,
      );

      throw new BadRequestException(
        'Delivery is not configured for this vendor',
      );
    }

    this.logger.warn(
      `Using fallback delivery option | cartId=${cartId} | ` +
      `configId=${fallback.id} | ` +
      `distance=${distanceKm.toFixed(2)}km | ` +
      `minDeliveryFee=${Number(fallback.minDeliveryFee)}`,
    );

    const fallbackDto = this.toDeliveryOptionDto(
      {
        ...fallback,
        distanceBands: fallback.distanceBands.map((band) => ({
          minDistanceKm: band.fromKm,
          maxDistanceKm: band.toKm,
          fee: band.flatFee,
        })),
      },
      distanceKm,
      durationSeconds,
      distanceSource,
      true,
    );

    // ETA is meaningless outside the vehicle's radius — override the label
    const result = [
      {
        ...fallbackDto,
        etaLabel: 'Subject to dispatcher confirmation',
      },
    ];

    this.logger.log(
      `Fallback delivery option prepared | cartId=${cartId} | ` +
      `configId=${fallback.id} | etaLabel="Subject to dispatcher confirmation"`,
    );

    return result;
  }


  async getDeliveryOptionsWithoutRouteDetails(
    cartId: string,
    dropoffAddress: string,
  ): Promise<DeliveryOptionDto[]> {
    // ── 1. Geocode ────────────────────────────────────────────────────────
    const coordinates = await Helper.geocodeAddress(dropoffAddress);
    if (!coordinates) {
      throw new BadRequestException(
        'Invalid dropoff address. Unable to determine location.',
      );
    }

    // ── 2. Cart + vendor store ────────────────────────────────────────────
    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: {
            product: { include: { store: true } },
            package: { include: { store: true } },
          },
        },
      },
    });
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.items.length === 0) throw new BadRequestException('Cart is empty');

    const firstItem = cart.items[0];
    const store = firstItem?.product?.store ?? firstItem?.package?.store;
    if (!store) throw new BadRequestException('No vendor store found for cart');
    if (store.latitude == null || store.longitude == null) {
      throw new BadRequestException('Store coordinates are not configured');
    }

    // ── 3. Distance ───────────────────────────────────────────────────────
    const distanceKm = Helper.haversineDistanceKm(
      store.latitude,
      store.longitude,
      coordinates.lat,
      coordinates.lng,
    );

    // ── 4. Options within radius ──────────────────────────────────────────
    const inRange = await this.prisma.vehicleTypeConfig.findMany({
      where: {
        isActive: true,
        deliveryRadiusKm: { gte: distanceKm },
      },
      include: { distanceBands: true },
      orderBy: { displayOrder: 'asc' },
    });

    if (inRange.length > 0) {
      return inRange.map((c) =>
        this.toDeliveryOptionDto(
          {
            ...c,
            distanceBands: c.distanceBands.map((band) => ({
              minDistanceKm: band.fromKm,
              maxDistanceKm: band.toKm,
              fee: band.flatFee,
            })),
          },
          distanceKm,
          null,
          'haversine',
          false,
        ),
      );
    }

    // ── 5. Fallback — nothing in range ────────────────────────────────────
    // Per business rule: resolve to the minimumDeliveryFee option.
    const fallback = await this.prisma.vehicleTypeConfig.findFirst({
      where: { isActive: true },
      orderBy: { minDeliveryFee: 'asc' },
      include: { distanceBands: true },
    });

    if (!fallback) {
      // No active configs at all — the vendor's delivery is misconfigured.
      throw new BadRequestException(
        'Delivery is not configured for this vendor',
      );
    }

    // Price the fallback using the flat minimum, ignoring distance bands,
    // since the distance is out of range anyway.
    return [
      {
        id: fallback.id,
        name: fallback.name,
        deliveryType: fallback.deliveryType,
        icon: fallback.icon,
        location: fallback.location,
        distanceKm: Number(distanceKm.toFixed(2)),
        deliveryFee: Number(Number(fallback.minDeliveryFee).toFixed(2)),
        deliveryRadiusKm: fallback.deliveryRadiusKm,
        isOutOfRange: true,
        etaMinutesMin: 0,
        etaMinutesMax: 0,
        etaLabel: 'Subject to dispatcher confirmation',
        distanceSource: 'haversine',
      },
    ];
  }

  // async getDeliveryOptionsWithoutFallback(
  //   cartId: string,
  //   dropoffAddress: string,
  // ): Promise<DeliveryOptionDto[]> {
  //   // ── 1. Geocode the address up front ────────────────────────────────
  //   this.logger.log(`Geocoding dropoff address: ${dropoffAddress}`);
  //   const coordinates = await Helper.geocodeAddress(dropoffAddress);

  //   if (!coordinates) {
  //     this.logger.error(`Failed to geocode address: ${dropoffAddress}`);
  //     throw new BadRequestException(
  //       'Invalid dropoff address. Unable to determine location.',
  //     );
  //   }
  //   this.logger.log(`Geocoded coordinates: ${coordinates.lat}, ${coordinates.lng}`);
  //   // ── 2. Load the cart + its (single) vendor store ───────────────────
  //   const cart = await this.prisma.cart.findUnique({
  //     where: { id: cartId },
  //     include: {
  //       items: {
  //         include: {
  //           product: { include: { store: true } },
  //           package: { include: { store: true } },
  //         },
  //       },
  //     },
  //   });
  //   if (!cart) throw new NotFoundException('Cart not found');
  //   if (cart.items.length === 0) {
  //     throw new BadRequestException('Cart is empty');
  //   }

  //   const firstItem = cart.items[0];
  //   const store = firstItem?.product?.store ?? firstItem?.package?.store;
  //   this.logger.log(`Using store: ${store?.id}`);

  //   if (!store) throw new BadRequestException('No vendor store found for cart');
  //   if (store.latitude == null || store.longitude == null) {
  //     throw new BadRequestException('Store coordinates are not configured');
  //   }

  //   // ── 3. Distance + eligible vehicle configs ─────────────────────────
  //   const distanceKm = Helper.haversineDistanceKm(
  //     store.latitude,
  //     store.longitude,
  //     coordinates.lat,
  //     coordinates.lng,
  //   );
  //   this.logger.log(`Calculated distance: ${distanceKm.toFixed(2)} km`);
  //   const configs = await this.prisma.vehicleTypeConfig.findMany({
  //     where: {
  //       isActive: true,
  //       deliveryRadiusKm: { gte: distanceKm },
  //     },
  //     include: { distanceBands: true },
  //     orderBy: { displayOrder: 'asc' },
  //   });
  //   this.logger.log(`Found eligible vehicle configs: ${configs.length}`);

  //   return configs.map((c) => ({
  //     id: c.id,
  //     name: c.name,
  //     deliveryType: c.deliveryType,
  //     icon: c.icon,
  //     location: c.location,
  //     distanceKm: Number(distanceKm.toFixed(2)),
  //     deliveryFee: Helper.computeFeeFromConfig(
  //       {
  //         ...c,
  //         minDeliveryFee: Number(c.minDeliveryFee),
  //         perKmRate: Number(c.perKmRate),
  //         distanceBands: c.distanceBands.map((band) => ({
  //           minDistanceKm: band.fromKm,
  //           maxDistanceKm: band.toKm,
  //           fee: Number(band.flatFee),
  //         })),
  //       },
  //       distanceKm,
  //     ), deliveryRadiusKm: c.deliveryRadiusKm,
  //   }));
  // }

  // async getDeliveryOptionsbk(
  //   cartId: string,
  //   dropoffLocation: { latitude: number; longitude: number },
  //   tx?: Prisma.TransactionClient,
  // ): Promise<DeliveryOptionDto[]> {
  //   const prisma = tx ?? this.prisma;

  //   const cart = await prisma.cart.findUnique({
  //     where: { id: cartId },
  //     include: {
  //       items: {
  //         include: {
  //           product: { include: { store: true } },
  //           package: { include: { store: true } },
  //         },
  //       },
  //     },
  //   });
  //   if (!cart) throw new NotFoundException('Cart not found');

  //   const firstItem = cart.items[0];
  //   const store = firstItem?.product?.store ?? firstItem?.package?.store;
  //   if (!store) throw new BadRequestException('No vendor store found for cart');
  //   if (store.latitude == null || store.longitude == null) {
  //     throw new BadRequestException('Store coordinates are not configured');
  //   }

  //   const distanceKm = Helper.haversineDistanceKm(
  //     store.latitude,
  //     store.longitude,
  //     dropoffLocation.latitude,
  //     dropoffLocation.longitude,
  //   );

  //   const configs = await prisma.vehicleTypeConfig.findMany({
  //     where: {
  //       isActive: true,
  //       deliveryRadiusKm: { gte: distanceKm },
  //     },
  //     include: { distanceBands: true },
  //     orderBy: { displayOrder: 'asc' },
  //   });

  //   return configs.map((c) => ({
  //     id: c.id,
  //     name: c.name,
  //     deliveryType: c.deliveryType,
  //     icon: c.icon,
  //     location: c.location,
  //     distanceKm: Number(distanceKm.toFixed(2)),
  //     deliveryFee: Helper.computeFeeFromConfig(
  //       {
  //         ...c,
  //         minDeliveryFee: Number(c.minDeliveryFee),
  //         perKmRate: Number(c.perKmRate),
  //         distanceBands: c.distanceBands.map((band) => ({
  //           minDistanceKm: band.fromKm,
  //           maxDistanceKm: band.toKm,
  //           fee: Number(band.flatFee),
  //         })),
  //       },
  //       distanceKm,
  //     ),
  //     deliveryRadiusKm: c.deliveryRadiusKm,
  //   }));
  // }



  /**
   * Calculate delivery fee.
   * In production, compute based on distance and delivery option.
   * Accepts optional transaction client for use inside transactions.
   */
  async calculateDeliveryFeeOld(
    cartId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    // Use provided transaction client or fallback to default
    const prisma = tx ?? this.prisma;

    // In production, calculate based on cart items, distance, delivery option, etc.
    // For now, return a mock fee.
    return 500;
  }

  async calculateDeliveryFee(
    cartId: string,
    dropoffLocation: { latitude: number; longitude: number } | null,
    selectedVehicleTypeConfigId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const prisma = tx ?? this.prisma;

    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: {
            product: { include: { store: true } },
            package: { include: { store: true } },
          },
        },
      },
    });
    if (!cart) throw new NotFoundException('Cart not found');

    const firstItem = cart.items[0];
    const store = firstItem?.product?.store ?? firstItem?.package?.store;
    if (!store) throw new BadRequestException('No vendor store found for cart');

    // Delivery fee cannot be computed until the customer provides a dropoff
    if (!dropoffLocation || store.latitude == null || store.longitude == null) {
      return 0;
    }

    const distanceKm = Helper.haversineDistanceKm(
      store.latitude,
      store.longitude,
      dropoffLocation.latitude,
      dropoffLocation.longitude,
    );
    this.logger.log(`Calculated distance: ${distanceKm.toFixed(2)} km`);
    // ── (a) Customer already chose a vehicle type → price with it ────────────
    if (selectedVehicleTypeConfigId) {
      const config = await prisma.vehicleTypeConfig.findUnique({
        where: { id: selectedVehicleTypeConfigId },
        include: { distanceBands: true },
      });

      if (!config || !config.isActive) {
        throw new BadRequestException('Selected delivery option is unavailable');
      }
      if (distanceKm > config.deliveryRadiusKm) {
        throw new BadRequestException(
          `Selected vehicle cannot deliver ${distanceKm.toFixed(1)} km`,
        );
      }
      return Helper.computeFeeFromConfig(
        {
          minDeliveryFee: Number(config.minDeliveryFee),
          perKmRate: Number(config.perKmRate),
          distanceBands: config.distanceBands.map((band) => ({
            minDistanceKm: band.fromKm,
            maxDistanceKm: band.toKm,
            fee: Number(band.flatFee),
          })),
        },
        distanceKm,
      );
    }

    // ── (b) No selection → find cheapest option within radius ────────────────
    const inRange = await prisma.vehicleTypeConfig.findMany({
      where: {
        isActive: true,
        deliveryRadiusKm: { gte: distanceKm },
      },
      include: { distanceBands: true },
    });

    if (inRange.length > 0) {
      return Math.min(
        ...inRange.map((c) =>
          Helper.computeFeeFromConfig(
            {
              ...c,
              minDeliveryFee: Number(c.minDeliveryFee),
              perKmRate: Number(c.perKmRate),
              distanceBands: c.distanceBands.map((band) => ({
                minDistanceKm: band.fromKm,
                maxDistanceKm: band.toKm,
                fee: Number(band.flatFee),
              })),
            },
            distanceKm,
          ),
        ),
      );
    }

    // ── (c) No option covers the distance → fall back to minimumDeliveryFee ──
    // Take the smallest minDeliveryFee across all active configs.
    const fallback = await prisma.vehicleTypeConfig.findFirst({
      where: { isActive: true },
      orderBy: { minDeliveryFee: 'asc' },
      select: { minDeliveryFee: true },
    });

    return fallback ? Number(fallback.minDeliveryFee) : 0;
  }



  /**
   * Calculate service fee based on active service fee configurations.
   * Supports both percentage and fixed fees.
   * Accepts optional transaction client for use inside transactions.
   */
  async calculateServiceFeeOld(
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

  async calculateServiceFee(
    subtotal: number,
    vendorId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const prisma = tx ?? this.prisma;

    const commission = await prisma.commission.findFirst({
      where: {
        vendorId,
        status: CommissionStatus.ACTIVE,
      },
    });

    if (!commission) {
      // No commission configured → no service fee.
      // You may prefer to throw BadRequestException instead.
      return 0;
    }

    return (subtotal * commission.serviceCharge) / 100;
  }

  /**
   * Calculate tax based on active tax settings.
   * Accepts optional transaction client for use inside transactions.
   */
  async calculateTaxOld(
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

  async calculateTax(
    subtotal: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const prisma = tx ?? this.prisma;

    const settings = await prisma.globalSetting.findUnique({
      where: { id: 'global' },
      select: { taxRate: true },
    });

    if (!settings || !settings.taxRate) return 0;

    return (subtotal * settings.taxRate) / 100;
  }
}
