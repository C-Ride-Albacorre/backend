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
import Helper from '../../shared/utils/helpers';
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
        unitPrice = productDetails.price + addonsTotal;   
        totalPrice = unitPrice * dto.quantity;            

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



  /**
   * Helper to normalize addons for consistent comparison.
   * Sorts addons by a stable key (e.g., addon id) before stringifying.
   */


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

    const t = serviceFee + taxAmount;

    return {
      cartId: cart.id,
      storeId: store?.id ?? null,
      storeName: store?.storeName ?? null,
      items,
      subtotal: round2(subtotal),
      deliveryFee: round2(deliveryFee),
      serviceFee: round2(t),
      taxAmount: round2(taxAmount),
      totalAmount: round2(subtotal + deliveryFee + t),
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
  requestId: string = crypto.randomUUID(),
): Promise<DeliveryOptionDto[]> {
  this.logger.log(
    `[${requestId}] Getting delivery options | cartId=${cartId} | ` +
      `dropoffAddress="${dropoffAddress}"`,
  );

  // ── 1. Geocode dropoff ───────────────────────────────────────────────────
  this.logger.debug(
    `[${requestId}] Geocoding dropoff address | cartId=${cartId}`,
  );

  const coords = await Helper.geocodeAddress(dropoffAddress);

  if (!coords) {
    this.logger.warn(
      `[${requestId}] Unable to geocode dropoff address | cartId=${cartId} | ` +
        `dropoffAddress="${dropoffAddress}"`,
    );
    throw new BadRequestException(
      'Invalid dropoff address. Unable to determine location.',
    );
  }

  this.logger.debug(
    `[${requestId}] Dropoff address geocoded | cartId=${cartId} | ` +
      `latitude=${coords.lat} | longitude=${coords.lng}`,
  );

  // ── 2. Load cart + vendor store ──────────────────────────────────────────
  this.logger.debug(
    `[${requestId}] Loading cart and vendor store | cartId=${cartId}`,
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
    this.logger.warn(`[${requestId}] Cart not found | cartId=${cartId}`);
    throw new NotFoundException('Cart not found');
  }

  if (cart.items.length === 0) {
    this.logger.warn(`[${requestId}] Cart is empty | cartId=${cartId}`);
    throw new BadRequestException('Cart is empty');
  }

  this.logger.debug(
    `[${requestId}] Cart loaded | cartId=${cartId} | ` +
      `itemCount=${cart.items.length}`,
  );

  const firstItem = cart.items[0];
  const store = firstItem?.product?.store ?? firstItem?.package?.store;

  if (!store) {
    this.logger.warn(
      `[${requestId}] No vendor store found for cart | cartId=${cartId}`,
    );
    throw new BadRequestException('No vendor store found for cart');
  }

  if (store.latitude == null || store.longitude == null) {
    this.logger.warn(
      `[${requestId}] Store coordinates are not configured | cartId=${cartId} | ` +
        `storeId=${store.id} | vendorId=${store.userId}`,
    );
    throw new BadRequestException('Store coordinates are not configured');
  }

  this.logger.debug(
    `[${requestId}] Vendor store resolved | cartId=${cartId} | ` +
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

  // ── 3. Distance resolution — SINGLE source of truth ──────────────────────
  //     Identical resolver used by calculateDeliveryFee so the fee shown
  //     here is the fee charged at checkout.
  this.logger.debug(
    `[${requestId}] Resolving distance | cartId=${cartId} | storeId=${store.id}`,
  );

  const { distanceKm, durationSeconds, distanceSource } =
    await Helper.resolveDistanceKm(origin, destination, {
      log: (m) =>
        this.logger.log(
          `[${requestId}] ${m} | cartId=${cartId} | storeId=${store.id}`,
        ),
      warn: (m) =>
        this.logger.warn(
          `[${requestId}] ${m} | cartId=${cartId} | storeId=${store.id}`,
        ),
    });

  // ── 4. Options within radius ─────────────────────────────────────────────
  this.logger.debug(
    `[${requestId}] Finding delivery options within radius | cartId=${cartId} | ` +
      `distance=${distanceKm.toFixed(2)}km | distanceSource=${distanceSource}`,
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
      `[${requestId}] Delivery options found | cartId=${cartId} | ` +
        `optionCount=${inRange.length} | distance=${distanceKm.toFixed(2)}km | ` +
        `distanceSource=${distanceSource}`,
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
      `[${requestId}] Delivery options prepared | cartId=${cartId} | ` +
        `optionCount=${options.length}`,
    );

    return options;
  }

  // ── 5. Fallback — nothing in range ───────────────────────────────────────
  this.logger.warn(
    `[${requestId}] No delivery option covers the distance | cartId=${cartId} | ` +
      `distance=${distanceKm.toFixed(2)}km | attempting fallback configuration`,
  );

  const fallback = await this.prisma.vehicleTypeConfig.findFirst({
    where: { isActive: true },
    orderBy: { minDeliveryFee: 'asc' },
    include: { distanceBands: true },
  });

  if (!fallback) {
    this.logger.error(
      `[${requestId}] No active delivery configuration found | cartId=${cartId} | ` +
        `storeId=${store.id} | vendorId=${store.userId}`,
    );
    throw new BadRequestException('Delivery is not configured for this vendor');
  }

  this.logger.warn(
    `[${requestId}] Using fallback delivery option | cartId=${cartId} | ` +
      `configId=${fallback.id} | distance=${distanceKm.toFixed(2)}km | ` +
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
    `[${requestId}] Fallback delivery option prepared | cartId=${cartId} | ` +
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



  /**
   * Calculate delivery fee.
   * In production, compute based on distance and delivery option.
   * Accepts optional transaction client for use inside transactions.
   */

async calculateDeliveryFee(
  cartId: string,
  dropoffLocation: { latitude: number; longitude: number } | null,
  selectedVehicleTypeConfigId?: string,
  tx?: Prisma.TransactionClient,
  requestId?: string,
): Promise<number> {
  const meta = await this.calculateDeliveryFeeWithMeta(
    cartId, dropoffLocation, selectedVehicleTypeConfigId, tx, requestId,
  );
  return meta.fee;
}

async calculateDeliveryFeeWithMeta(
  cartId: string,
  dropoffLocation: { latitude: number; longitude: number } | null,
  selectedVehicleTypeConfigId?: string,
  tx?: Prisma.TransactionClient,
  requestId?: string,
): Promise<{
  fee: number;
  distanceKm: number | null;
  distanceSource: 'google_routes' | 'haversine' | null;
}> {

  const prisma = tx ?? this.prisma;
  const logCtx = requestId ? `[${requestId}] ` : '';

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
    return { fee: 0, distanceKm: null, distanceSource: null };
  }

  // ⬇️ Same resolver used by getDeliveryOptions — guarantees band parity
  const { distanceKm, distanceSource } = await Helper.resolveDistanceKm(
    { latitude: store.latitude, longitude: store.longitude },
    { latitude: dropoffLocation.latitude, longitude: dropoffLocation.longitude },
    {
      log: (m) =>
        this.logger.log(`${logCtx}${m} | cartId=${cartId} | storeId=${store.id}`),
      warn: (m) =>
        this.logger.warn(`${logCtx}${m} | cartId=${cartId} | storeId=${store.id}`),
    },
  );

  this.logger.log(
    `${logCtx}Calculated distance | cartId=${cartId} | storeId=${store.id} | ` +
      `distance=${distanceKm.toFixed(2)}km | source=${distanceSource} | ` +
      `selectedConfigId=${selectedVehicleTypeConfigId ?? 'none'}`,
  );

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
    return {
      fee: Helper.computeFeeFromConfig(
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
      ),
      distanceKm,
      distanceSource,
    };
  }

  // ── (b) No selection → cheapest option within radius ─────────────────────
  const inRange = await prisma.vehicleTypeConfig.findMany({
    where: { isActive: true, deliveryRadiusKm: { gte: distanceKm } },
    include: { distanceBands: true },
  });

  if (inRange.length > 0) {
    return {
      fee: Math.min(
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
      ),
      distanceKm,
      distanceSource,
    };
  }

  // ── (c) Fallback ─────────────────────────────────────────────────────────
  const fallback = await prisma.vehicleTypeConfig.findFirst({
    where: { isActive: true },
    orderBy: { minDeliveryFee: 'asc' },
    select: { minDeliveryFee: true },
  });

  return {
    fee: fallback ? Number(fallback.minDeliveryFee) : 0,
    distanceKm,
    distanceSource,
  };
}


  /**
   * Calculate service fee based on active service fee configurations.
   * Supports both percentage and fixed fees.
   * Accepts optional transaction client for use inside transactions.
   */


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
