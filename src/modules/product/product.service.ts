import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CreateProductDto,
  UpdateProductDto,
  CreateVariantDto,
  CreateAddonDto,
} from './dto/product.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  /**
   * Create a new product (SINGLE or VARIABLE)
   */

  async createProduct(
    userId: string,
    storeId: string,
    dto: CreateProductDto,
    images: Express.Multer.File[],
  ) {
    this.logger.log(`Creating product for store: ${storeId}`);

    // Verify store belongs to vendor
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, userId },
    });

    if (!store) {
      throw new NotFoundException('Store not found or access denied');
    }

    // Upload images
    const uploadedImages: string[] = [];
    for (const image of images) {
      const uploadResult = await this.cloudinaryService.uploadLogo(image);
      uploadedImages.push(uploadResult.secure_url);
    }

    // ✅ IMPORTANT: explicitly type this
    const data: Prisma.ProductUncheckedCreateInput = {
      productName: dto.productName,
      // productCategory: dto.productCategory,
      sku: dto.sku,
      description: dto.description,
      productType: dto.productType,
      stockStatus: dto.stockStatus,
      productStatus: dto.productStatus,
      basePrice: dto.basePrice,
      stockQuantity: dto.stockQuantity,
      lowStockThreshold: dto.lowStockThreshold,
      storeId, // ✅ now valid
      subcategoryId: dto.subcategoryId, // ✅ FIX
      productImages: {
        create: uploadedImages.map((url, index) => ({
          imageUrl: url,
          isPrimary: index === 0,
          displayOrder: index,
        })),
      },
    };

    const product = await this.prisma.product.create({
      data,
      include: {
        productImages: true,
      },
    });

    // If VARIABLE product, create variants
    if (dto.productType === 'VARIABLE' && dto.variants?.length) {
      await this.createVariants(product.id, dto.variants);
    }

    // Create add-ons if provided
    if (dto.addons?.length) {
      await this.createAddons(product.id, dto.addons);
    }

    const completeProduct = await this.getProductWithDetails(product.id);

    return {
      success: true,
      message: 'Product created successfully',
      product: completeProduct,
    };
  }
  // async createProduct(
  //   userId: string,
  //   storeId: string,
  //   dto: CreateProductDto,
  //   images: Express.Multer.File[],
  // ) {
  //   this.logger.log(`Creating product for store: ${storeId}`);

  //   // Verify store belongs to vendor
  //   const store = await this.prisma.store.findFirst({
  //     where: { id: storeId, userId },
  //   });

  //   if (!store) {
  //     throw new NotFoundException('Store not found or access denied');
  //   }

  //   // Upload images
  //   const uploadedImages = [];
  //   for (const image of images) {
  //     const uploadResult = await this.cloudinaryService.uploadLogo(image);
  //     uploadedImages.push(uploadResult.secure_url);
  //   }

  //   // Create product with images
  //   const product = await this.prisma.product.create({
  //     data: {
  //       productName: dto.productName,
  //       productCategory: dto.productCategory,
  //       sku: dto.sku,
  //       description: dto.description,
  //       productType: dto.productType,
  //       stockStatus: dto.stockStatus,
  //       productStatus: dto.productStatus,
  //       basePrice: dto.basePrice,
  //       stockQuantity: dto.stockQuantity,
  //       lowStockThreshold: dto.lowStockThreshold,
  //       storeId,
  //       productImages: {
  //         create: uploadedImages.map((url, index) => ({
  //           imageUrl: url,
  //           isPrimary: index === 0,
  //           displayOrder: index,
  //         })),
  //       },
  //     },
  //     include: {
  //       productImages: true,
  //     },
  //   });

  //   // If VARIABLE product, create variants
  //   if (dto.productType === 'VARIABLE' && dto.variants?.length) {
  //     await this.createVariants(product.id, dto.variants);
  //   }

  //   // Create add-ons if provided
  //   if (dto.addons?.length) {
  //     await this.createAddons(product.id, dto.addons);
  //   }

  //   const completeProduct = await this.getProductWithDetails(product.id);

  //   return {
  //     success: true,
  //     message: 'Product created successfully',
  //     product: completeProduct,
  //   };
  // }

  /**
   * Create variants for a product
   */
  async createVariants(productId: string, variants: CreateVariantDto[]) {
    const variantData = variants.map((v) => ({
      ...v,
      productId,
      sku: v.sku || `${productId}-${v.variantName}`.toUpperCase(),
    }));

    await this.prisma.variant.createMany({
      data: variantData,
    });
  }

  /**
   * Create add-ons for a product
   */
  async createAddons(productId: string, addons: CreateAddonDto[]) {
    const addonData = addons.map((a) => ({
      ...a,
      productId,
    }));

    await this.prisma.addon.createMany({
      data: addonData,
    });
  }

  /**
   * Get product with all details
   */
  async getProductWithDetails(productId: string) {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        productImages: {
          orderBy: { displayOrder: 'asc' },
        },
        variants: true,
        addons: true,
        store: {
          select: {
            id: true,
            storeName: true,
            userId: true,
          },
        },
      },
    });
  }

  /**
   * Get all products for a store
   */
  async getStoreProducts(storeId: string, userId: string) {
    // Verify store belongs to vendor
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, userId },
    });

    if (!store) {
      throw new NotFoundException('Store not found or access denied');
    }

    const products = await this.prisma.product.findMany({
      where: { storeId },
      include: {
        productImages: {
          take: 1,
          where: { isPrimary: true },
        },
        variants: true,
        addons: true,
        _count: {
          select: {
            variants: true,
            addons: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return products;
  }

  /**
   * Update product
   */
  async updateProduct(
    productId: string,
    storeId: string,
    userId: string,
    dto: UpdateProductDto,
    newImages?: Express.Multer.File[],
  ) {
    // Verify store and product
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        storeId,
        store: { userId },
      },
      include: { productImages: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found or access denied');
    }

    // Handle new images if provided
    if (newImages?.length) {
      // Upload new images
      const uploadedImages = [];
      for (const image of newImages) {
        // const uploadResult = await this.cloudinaryService.uploadImage(image);
        // uploadedImages.push(uploadResult.secure_url);
      }

      // Add new images to product
      await this.prisma.productImage.createMany({
        data: uploadedImages.map((url, index) => ({
          productId,
          imageUrl: url,
          isPrimary: product.productImages.length === 0 && index === 0,
          displayOrder: product.productImages.length + index,
        })),
      });
    }

    // Update product
    const updatedProduct = await this.prisma.product.update({
      where: { id: productId },
      data: {
        productName: dto.productName,
        // productCategory: dto.productCategory,
        storeId, // ✅ now valid
        subcategoryId: dto.subcategoryId, // ✅ FIX
        description: dto.description,
        stockStatus: dto.stockStatus,
        productStatus: dto.productStatus,
        basePrice: dto.basePrice,
        stockQuantity: dto.stockQuantity,
        lowStockThreshold: dto.lowStockThreshold,
      },
      include: {
        productImages: true,
        variants: true,
        addons: true,
      },
    });

    return {
      success: true,
      message: 'Product updated successfully',
      product: updatedProduct,
    };
  }

  /**
   * Permanently delete product (hard delete)
   */
  async deleteProduct(productId: string, storeId: string, userId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        storeId,
        store: { userId },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found or access denied');
    }

    await this.prisma.product.delete({
      where: { id: productId },
    });

    return {
      success: true,
      message: 'Product deleted successfully',
    };
  }

  /**
   * Delete product (soft delete by setting status to INACTIVE)
   */
  async softDeleteProduct(productId: string, storeId: string, userId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        storeId,
        store: { userId },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found or access denied');
    }

    await this.prisma.product.update({
      where: { id: productId },
      data: { productStatus: 'INACTIVE' },
    });

    return {
      success: true,
      message: 'Product deleted successfully',
    };
  }
}
