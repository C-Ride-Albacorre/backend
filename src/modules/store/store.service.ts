import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  CreateStoreDto,
  UpdateStoreDto,
  OperatingHoursDto,
} from './dto/store.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { UserStatus } from 'src/shared/enums';

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  /**
   * Create a new store for a vendor
   */
  // async createStore(
  //   userId: string,
  //   dto: CreateStoreDto,
  //   logoFile?: Express.Multer.File,
  // ) {
  //   this.logger.log(`Creating store for vendor: ${userId}`);

  //   // Check vendor exists and is active
  //   const vendor = await this.prisma.user.findUnique({
  //     where: { id: userId },
  //     include: { businessInfo: true },
  //   });

  //   if (!vendor || vendor.role !== 'VENDOR') {
  //     throw new NotFoundException('Vendor not found');
  //   }

  //   if (vendor.status !== UserStatus.APPROVED) {
  //     throw new BadRequestException(
  //       'Vendor account must be approved to create stores',
  //     );
  //   }

  //   // Upload logo if provided
  //   // let logoUrl = null;
  //   // if (logoFile) {
  //   //   // Use your cloudinary service
  //   //   logoUrl = await this.cloudinaryService.uploadLogo(logoFile);
  //   // }
  //   let logoUrl: string | null = null;
  //   if (logoFile) {
  //     const uploadResult = await this.cloudinaryService.uploadLogo(logoFile);
  //     logoUrl = uploadResult.secure_url; // <-- store only the URL
  //   }

  //   // Create store with operating hours
  //   const store = await this.prisma.store.create({
  //     data: {
  //       storeName: dto.storeName,
  //       storeCategory: dto.storeCategory,
  //       storeDescription: dto.storeDescription,
  //       storeAddress: dto.storeAddress,
  //       phoneNumber: dto.phoneNumber,
  //       email: dto.email,
  //       minimumOrder: dto.minimumOrder,
  //       preparationTime: dto.preparationTime,
  //       deliveryFee: dto.deliveryFee,
  //       storeLogo: logoUrl,
  //       user: { connect: { id: userId } }, // <-- use relation
  //       operatingHours: {
  //         create: dto.operatingHours.map((hour) => ({
  //           dayOfWeek: hour.dayOfWeek,
  //           isOpen: hour.isOpen,
  //           openingTime: hour.openingTime,
  //           closingTime: hour.closingTime,
  //           breakStart: hour.breakStart,
  //           breakEnd: hour.breakEnd,
  //         })),
  //       },
  //     },
  //     include: {
  //       operatingHours: true,
  //     },
  //   });

  //   return {
  //     success: true,
  //     message: 'Store created successfully',
  //     store,
  //   };
  // }
  /**
   * Create a new store for a vendor
   */
  async createStore(
    userId: string,
    dto: CreateStoreDto,
    logoFile?: Express.Multer.File,
  ) {
    this.logger.log(`Creating store for vendor: ${userId}`);

    // Check vendor exists and is active
    const vendor = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { businessInfo: true },
    });

    if (!vendor || vendor.role !== 'VENDOR') {
      throw new NotFoundException('Vendor not found');
    }

    if (vendor.status !== 'APPROVED') {
      throw new BadRequestException(
        'Vendor account must be active to create stores',
      );
    }

    // Upload logo if provided
    let logoUrl: string | null = null;
    if (logoFile) {
      const uploadResult = await this.cloudinaryService.uploadLogo(logoFile);
      logoUrl = uploadResult.secure_url; // <-- store only the URL
    }

    // Create store with operating hours
    const store = await this.prisma.store.create({
      data: {
        storeName: dto.storeName,
        storeCategory: dto.storeCategory,
        storeDescription: dto.storeDescription,
        storeAddress: dto.storeAddress,
        phoneNumber: dto.phoneNumber,
        email: dto.email,
        minimumOrder: dto.minimumOrder,
        preparationTime: dto.preparationTime,
        deliveryFee: dto.deliveryFee,
        storeLogo: logoUrl,
        userId,
        operatingHours: {
          create: dto.operatingHours.map((hour) => ({
            dayOfWeek: hour.dayOfWeek,
            isOpen: hour.isOpen,
            openingTime: hour.openingTime,
            closingTime: hour.closingTime,
            breakStart: hour.breakStart,
            breakEnd: hour.breakEnd,
          })),
        },
      },
      include: {
        operatingHours: true,
      },
    });

    return {
      success: true,
      message: 'Store created successfully',
      store,
    };
  }

  /**
   * Get all stores for a vendor
   */
  async getVendorStores(userId: string) {
    const stores = await this.prisma.store.findMany({
      where: { userId },
      include: {
        operatingHours: {
          orderBy: { dayOfWeek: 'asc' },
        },
        products: {
          take: 5, // Just a preview
          include: {
            productImages: true,
          },
        },
      },
    });

    return stores;
  }

  /**
   * Update store details
   */
  async updateStore(
    storeId: string,
    userId: string,
    dto: UpdateStoreDto,
    logoFile?: Express.Multer.File,
  ) {
    // Verify store belongs to vendor
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, userId },
    });

    if (!store) {
      throw new NotFoundException('Store not found or access denied');
    }

    // Upload new logo if provided
    const logoUrl = store.storeLogo;
    if (logoFile) {
      // logoUrl = await this.cloudinaryService.uploadImage(logoFile);
    }

    // Update store
    const updatedStore = await this.prisma.store.update({
      where: { id: storeId },
      data: {
        storeName: dto.storeName,
        storeCategory: dto.storeCategory,
        storeDescription: dto.storeDescription,
        storeAddress: dto.storeAddress,
        phoneNumber: dto.phoneNumber,
        minimumOrder: dto.minimumOrder,
        preparationTime: dto.preparationTime,
        storeLogo: logoUrl,
        status: dto.status,
      },
      include: {
        operatingHours: true,
      },
    });

    return {
      success: true,
      message: 'Store updated successfully',
      store: updatedStore,
    };
  }

  /**
   * Update operating hours
   */
  async updateOperatingHours(
    storeId: string,
    userId: string,
    hours: OperatingHoursDto[],
  ) {
    // Verify store belongs to vendor
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, userId },
    });

    if (!store) {
      throw new NotFoundException('Store not found or access denied');
    }

    // Delete existing hours and create new ones
    await this.prisma.$transaction(async (prisma) => {
      await prisma.operatingHour.deleteMany({
        where: { storeId },
      });

      await prisma.operatingHour.createMany({
        data: hours.map((hour) => ({
          storeId,
          dayOfWeek: hour.dayOfWeek,
          isOpen: hour.isOpen,
          openingTime: hour.openingTime,
          closingTime: hour.closingTime,
          breakStart: hour.breakStart,
          breakEnd: hour.breakEnd,
        })),
      });
    });

    const updatedStore = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: { operatingHours: true },
    });

    return {
      success: true,
      message: 'Operating hours updated successfully',
      store: updatedStore,
    };
  }
}
