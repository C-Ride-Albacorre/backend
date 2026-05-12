// src/admin/admin.service.ts
import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ApproveVendorDto } from './dto/approve-vendor.dto';
import { ApproveStoreDto } from './dto/approve-store.dto';
import { VendorFilterDto } from './dto/vendor-filter.dto';
import { StoreFilterDto } from './dto/store-filter.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { StoreStatus, UserRole } from '../../shared/enums';
import Helper from '../../shared/utils/helpers';
import { OnBoardingStatus, UserStatus } from '@prisma/client';
import { AbstractUserRepository } from '../user/repositories/abstract-user.repository';
import { User } from '../user/entities/user.entity';
import {
  CreateSubcategoryDto,
  UpdateSubcategoryDto,
} from './dto/subcategory.dto';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CloudinaryService } from '../../shared/services/cloudinary.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userRepository: AbstractUserRepository,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // /**
  //  * Create a new admin (only super_admin can do this)
  //  */
  // async createAdmin(superAdminId: string, dto: CreateAdminDto) {
  //   this.logger.log(`Super admin ${superAdminId} creating new admin`);

  //   // Verify super admin exists and has correct role
  //   const superAdmin = await this.prisma.user.findUnique({
  //     where: { id: superAdminId },
  //   });

  //   if (!superAdmin || superAdmin.role !== UserRole.SUPER_ADMIN) {
  //     throw new ForbiddenException('Only super admins can create admins');
  //   }

  //   // Check if user already exists
  //   const existingUser = await this.prisma.user.findFirst({
  //     where: {
  //       email: dto.email,
  //     },
  //   });

  //   if (existingUser) {
  //     throw new BadRequestException(
  //       'User with this email or phone already exists',
  //     );
  //   }

  //   // Hash password
  //   const hashedPassword = await Helper.hashText(dto.password);

  //   // Create admin user
  //   const admin = await this.prisma.user.create({
  //     data: {
  //       email: dto.email,
  //       // phoneNumber: dto.phoneNumber,
  //       firstName: dto.firstName,
  //       lastName: dto.lastName,
  //       password: hashedPassword,
  //       role: UserRole.ADMIN,
  //       isActive: true,
  //       isVerified: true,
  //       verifiedAt: new Date(),
  //     },
  //     select: {
  //       id: true,
  //       email: true,
  //       phoneNumber: true,
  //       firstName: true,
  //       lastName: true,
  //       role: true,
  //       createdAt: true,
  //     },
  //   });

  //   this.logger.log(`Admin created: ${admin.email || admin.phoneNumber}`);

  //   return {
  //     success: true,
  //     message: 'Admin created successfully',
  //     data: admin,
  //   };
  // }

  /**
   * Get all vendors with filtering and pagination
   */
  async getAllVendors(filterDto: VendorFilterDto) {
    const { status, search, hasStores, page = 1, limit = 10 } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = {
      role: UserRole.VENDOR,
    };

    // Status filter
    if (status) {
      where.status = status;
    }

    // Search filter
    if (search) {
      where.OR = [
        {
          businessInfo: {
            businessName: { contains: search, mode: 'insensitive' },
          },
        },
        {
          businessInfo: {
            businessEmail: { contains: search, mode: 'insensitive' },
          },
        },
        {
          email: { contains: search, mode: 'insensitive' },
        },
      ];
    }

    // Store filter
    if (hasStores !== undefined) {
      where.stores = hasStores ? { some: {} } : { none: {} };
    }

    const [vendors, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          businessInfo: true,

          stores: {
            select: {
              id: true,
              storeName: true,
              status: true,
            },
          },

          documents: {
            select: {
              id: true,
              documentType: true,
              documentUrl: true,
              //publicId: true,
              createdAt: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },

          _count: {
            select: { stores: true },
          },
        },
      }),

      this.prisma.user.count({ where }),
    ]);

    // Optional: group documents by type (very useful for admin UI)
    const groupDocumentsByType = (documents: any[]) => {
      return documents.reduce((acc, doc) => {
        if (!acc[doc.documentType]) {
          acc[doc.documentType] = [];
        }
        acc[doc.documentType].push(doc);
        return acc;
      }, {});
    };

    const formattedVendors = vendors.map((vendor) => ({
      id: vendor.id,
      email: vendor.email,
      phoneNumber: vendor.phoneNumber,
      firstName: vendor.firstName,
      lastName: vendor.lastName,
      status: vendor.status,
      createdAt: vendor.createdAt,

      businessInfo: vendor.businessInfo,

      stores: vendor.stores,
      storeCount: vendor._count.stores,

      // Raw documents
      documents: vendor.documents,

      // Grouped documents (better for frontend)
      documentsByType: groupDocumentsByType(vendor.documents),

      // Helpful flag for admin
      hasDocuments: vendor.documents.length > 0,
    }));

    return {
      success: true,
      data: formattedVendors,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAllVendorsWithoutDoc(filterDto: VendorFilterDto) {
    const { status, search, hasStores, page = 1, limit = 10 } = filterDto;
    const skip = (page - 1) * limit;

    // Base where clause: only vendors
    const where: any = {
      role: UserRole.VENDOR,
    };

    // Optional status filter (directly on user)
    if (status) {
      where.status = status;
    }

    // Optional search filter
    if (search) {
      where.OR = [
        // Search in business info if it exists
        {
          businessInfo: {
            businessName: { contains: search, mode: 'insensitive' },
          },
        },
        {
          businessInfo: {
            businessEmail: { contains: search, mode: 'insensitive' },
          },
        },
        // Search fallback in user email
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Optional filter for stores
    if (hasStores !== undefined) {
      where.stores = hasStores ? { some: {} } : { none: {} };
    }

    // Fetch vendors with pagination
    const [vendors, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          businessInfo: true,
          stores: {
            select: {
              id: true,
              storeName: true,
              status: true,
            },
          },
          _count: {
            select: { stores: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Format response
    const formattedVendors = vendors.map((vendor) => ({
      id: vendor.id,
      email: vendor.email,
      phoneNumber: vendor.phoneNumber,
      firstName: vendor.firstName,
      lastName: vendor.lastName,
      status: vendor.status,
      createdAt: vendor.createdAt,
      businessInfo: vendor.businessInfo,
      stores: vendor.stores,
      storeCount: vendor._count.stores,
    }));

    return {
      success: true,
      data: formattedVendors,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAllVendorsbk(filterDto: VendorFilterDto) {
    const { status, search, hasStores, page = 1, limit = 10 } = filterDto;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      role: UserRole.VENDOR,
    };

    if (status) {
      where.user = {
        status,
      };
    }

    if (search) {
      where.businessInfo = {
        ...where.businessInfo,
        OR: [
          { businessName: { contains: search, mode: 'insensitive' } },
          { businessEmail: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    if (hasStores !== undefined) {
      where.stores = hasStores ? { some: {} } : { none: {} };
    }

    // Get vendors with pagination
    const [vendors, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          businessInfo: true,
          stores: {
            select: {
              id: true,
              storeName: true,
              status: true,
            },
          },
          _count: {
            select: {
              stores: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Format response
    const formattedVendors = vendors.map((vendor) => ({
      id: vendor.id,
      email: vendor.email,
      phoneNumber: vendor.phoneNumber,
      firstName: vendor.firstName,
      lastName: vendor.lastName,
      createdAt: vendor.createdAt,
      businessInfo: vendor.businessInfo,
      stores: vendor.stores,
      storeCount: vendor._count.stores,
    }));

    return {
      success: true,
      data: formattedVendors,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Approve or reject a vendor
   */
  // async approveVendor(
  //   adminId: string,
  //   vendorId: string,
  //   dto: ApproveVendorDto,
  // ) {
  //   this.logger.log(`Admin ${adminId} approving vendor ${vendorId}`);

  //   // Find vendor
  //   const vendor = await this.prisma.user.findFirst({
  //     where: {
  //       id: vendorId,
  //       role: UserRole.VENDOR,
  //     },
  //     include: {
  //       businessInfo: true,
  //     },
  //   });

  //   if (!vendor) {
  //     throw new NotFoundException('Vendor not found');
  //   }

  //   if (!vendor.businessInfo) {
  //     throw new BadRequestException('Vendor business profile not found');
  //   }

  //   // Check if already processed
  //   if (vendor.status !== UserStatus.UNDER_REVIEW) {
  //     throw new BadRequestException(
  //       `Vendor already ${vendor.status.toLowerCase()}`,
  //     );
  //   }

  //   // Process based on action
  //   let updatedProfile;
  //   const now = new Date();

  //   switch (dto.action) {
  //     case ApprovalAction.APPROVE:
  //       updatedProfile = await this.prisma.user.update({
  //         where: { userId: vendorId },
  //         data: {
  //           status: UserStatus.APPROVED,
  //           approvedAt: now,
  //           approvedBy: adminId,
  //           rejectionReason: null,
  //         },
  //       });
  //       this.logger.log(`Vendor ${vendorId} approved`);
  //       break;

  //     case ApprovalAction.REJECT:
  //       if (!dto.rejectionReason) {
  //         throw new BadRequestException('Rejection reason is required');
  //       }
  //       updatedProfile = await this.userRepository.update({
  //         where: { userId: vendorId },
  //         data: {
  //           status: UserStatus.REJECTED,
  //           approvedAt: null,
  //           approvedBy: adminId,
  //           rejectionReason: dto.rejectionReason,
  //         },
  //       });
  //       this.logger.log(`Vendor ${vendorId} rejected: ${dto.rejectionReason}`);
  //       break;

  //     case ApprovalAction.SUSPEND:
  //       updatedProfile = await this.prisma.businessInfo.update({
  //         where: { userId: vendorId },
  //         data: {
  //           status: UserStatus.SUSPENDED,
  //           approvedAt: null,
  //           approvedBy: adminId,
  //           rejectionReason: dto.rejectionReason,
  //         },
  //       });

  //       // Also suspend all vendor's stores
  //       await this.prisma.store.updateMany({
  //         where: { vendorId },
  //         data: { status: StoreStatus.SUSPENDED },
  //       });

  //       this.logger.log(`Vendor ${vendorId} suspended`);
  //       break;

  //     default:
  //       throw new BadRequestException('Invalid action');
  //   }

  //   return {
  //     success: true,
  //     message: `Vendor ${dto.action.toLowerCase()}d successfully`,
  //     data: updatedProfile,
  //   };
  // }

  async approveVendorbk(
    adminId: string,
    vendorId: string,
    dto: ApproveVendorDto,
  ) {
    this.logger.log(`Admin ${adminId} approving vendor ${vendorId}`);

    const vendor = await this.prisma.user.findFirst({
      where: {
        id: vendorId,
        role: UserRole.VENDOR,
      },
      include: {
        businessInfo: true,
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    if (!vendor.businessInfo) {
      throw new BadRequestException(
        'Vendor business profile not found. Kindly complete onboarding to proceed',
      );
    }

    // if (vendor.status === UserStatus.APPROVED) {
    //   throw new BadRequestException(
    //     `Vendor already ${vendor.status.toLowerCase()}`,
    //   );
    // }
    if (vendor.status === 'ACTIVE') {
      return {
        success: true,
        message: `Vendor already ${vendor.status.toLowerCase()}`,
        data: vendor,
      };
    }

    const now = new Date();
    let userUpdateData: Partial<User>;
    let updatedUser;

    switch (dto.action) {
      case UserStatus.APPROVED:
        userUpdateData = {
          status: UserStatus.APPROVED,
          approvedAt: now,
          approvedBy: adminId,
          rejectionReason: null,
        };

        updatedUser = await this.userRepository.update(
          vendor.id,
          userUpdateData,
        );

        this.logger.log(`Vendor ${vendorId} approved`);
        break;

      case UserStatus.REJECTED:
        if (!dto.rejectionReason) {
          throw new BadRequestException('Rejection reason is required');
        }

        userUpdateData = {
          status: UserStatus.REJECTED,
          approvedAt: null,
          approvedBy: adminId,
          rejectionReason: dto.rejectionReason,
        };

        updatedUser = await this.userRepository.update(
          vendor.id,
          userUpdateData,
        );

        this.logger.log(`Vendor ${vendorId} rejected: ${dto.rejectionReason}`);
        break;

      case UserStatus.SUSPENDED:
        userUpdateData = {
          status: UserStatus.SUSPENDED,
          approvedAt: null,
          approvedBy: adminId,
          rejectionReason: dto.rejectionReason,
        };

        updatedUser = await this.userRepository.update(
          vendor.id,
          userUpdateData,
        );

        await this.prisma.store.updateMany({
          where: { userId: vendorId },
          data: { status: StoreStatus.SUSPENDED },
        });

        this.logger.log(`Vendor ${vendorId} suspended`);
        break;

      default:
        throw new BadRequestException('Invalid action');
    }

    return {
      success: true,
      message: `Vendor ${dto.action.toLowerCase()} successfully`,
      role: updatedUser.role,
    };
  }

  async approveVendor(
    adminId: string,
    vendorId: string,
    dto: ApproveVendorDto,
  ) {
    this.logger.log(`Admin ${adminId} approving vendor ${vendorId}`);

    const vendor = await this.prisma.user.findFirst({
      where: {
        id: vendorId,
        role: UserRole.VENDOR,
      },
      include: {
        businessInfo: true,
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    if (!vendor.businessInfo) {
      throw new BadRequestException(
        'Vendor business profile not found. Kindly complete onboarding to proceed',
      );
    }

    // 🚨 Prevent approval if onboarding not completed
    const onboardingCompleted =
      vendor.onboardingStatus === OnBoardingStatus.COMPLETED;

    if (dto.action === UserStatus.APPROVED && !onboardingCompleted) {
      throw new BadRequestException(
        'Vendor has not completed onboarding. Approval not allowed.',
      );
    }

    if (vendor.status === UserStatus.ACTIVE) {
      return {
        success: true,
        message: `Vendor already ${vendor.status.toLowerCase()}`,
        data: vendor,
      };
    }

    const now = new Date();
    let userUpdateData: Partial<User>;
    let updatedUser;

    switch (dto.action) {
      case UserStatus.APPROVED:
        userUpdateData = {
          status: UserStatus.APPROVED,
          approvedAt: now,
          approvedBy: adminId,
          rejectionReason: null,
        };

        updatedUser = await this.userRepository.update(
          vendor.id,
          userUpdateData,
        );

        this.logger.log(`Vendor ${vendorId} approved`);
        break;

      case UserStatus.REJECTED:
        if (!dto.rejectionReason) {
          throw new BadRequestException('Rejection reason is required');
        }

        userUpdateData = {
          status: UserStatus.REJECTED,
          approvedAt: null,
          approvedBy: adminId,
          rejectionReason: dto.rejectionReason,
        };

        updatedUser = await this.userRepository.update(
          vendor.id,
          userUpdateData,
        );

        this.logger.log(`Vendor ${vendorId} rejected: ${dto.rejectionReason}`);
        break;

      case UserStatus.SUSPENDED:
        userUpdateData = {
          status: UserStatus.SUSPENDED,
          approvedAt: null,
          approvedBy: adminId,
          rejectionReason: dto.rejectionReason,
        };

        updatedUser = await this.userRepository.update(
          vendor.id,
          userUpdateData,
        );

        await this.prisma.store.updateMany({
          where: { userId: vendorId },
          data: { status: StoreStatus.SUSPENDED },
        });

        this.logger.log(`Vendor ${vendorId} suspended`);
        break;

      default:
        throw new BadRequestException('Invalid action');
    }

    return {
      success: true,
      message: `Vendor ${dto.action.toLowerCase()} successfully`,
      role: updatedUser.role,
    };
  }

  /**
   * Get all stores with filtering and pagination
   */
  async getAllStores(filterDto: StoreFilterDto) {
    const {
      status,
      search,
      vendorId,
      featured,
      page = 1,
      limit = 10,
    } = filterDto;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (vendorId) {
      where.vendorId = vendorId;
    }

    if (featured !== undefined) {
      where.featured = featured;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Get stores with pagination
    const [stores, total] = await Promise.all([
      this.prisma.store.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              businessInfo: {
                select: {
                  businessName: true,
                  businessEmail: true,
                },
              },
            },
          },
          _count: {
            select: {
              products: true,
            },
          },
        },
      }),
      this.prisma.store.count({ where }),
    ]);

    // Format response
    const formattedStores = stores.map((store) => ({
      id: store.id,
      name: store.storeName,
      //slug: store.slug,
      description: store.storeDescription,
      email: store.email,
      phoneNumber: store.phoneNumber,
      status: store.status,
      // featured: store.featured,
      totalProducts: store._count.products,
      createdAt: store.createdAt,
      user: {
        id: store.user.id,
        name: `${store.user.firstName} ${store.user.lastName}`,
        businessName: store.user.businessInfo?.businessName,
        email: store.user.email,
      },
    }));

    return {
      success: true,
      data: formattedStores,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Approve or reject a store
   */
  async approveStore(adminId: string, storeId: string, dto: ApproveStoreDto) {
    this.logger.log(`Admin ${adminId} approving store ${storeId}`);

    // Find store
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        user: true,
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    // Check if already processed
    // if (store.status !== StoreStatus.INACTIVE) {
    //   throw new BadRequestException(
    //     `Store already ${store.status.toLowerCase()}`,
    //   );
    // }
    if (store.status === 'ACTIVE') {
      return {
        success: true,
        message: `store already ${store.status.toLowerCase()}`,
        data: store,
      };
    }

    // Process based on action
    let updatedStore;
    const now = new Date();

    switch (dto.action) {
      case StoreStatus.ACTIVE:
        updatedStore = await this.prisma.store.update({
          where: { id: storeId },
          data: {
            status: StoreStatus.ACTIVE,
            approvedAt: now,
            approvedBy: adminId,
            rejectionReason: null,
            // commissionRate: dto.commissionRate || store.commissionRate,
          },
        });
        this.logger.log(`Store ${storeId} approved`);
        break;

      case StoreStatus.REJECTED:
        if (!dto.rejectionReason) {
          throw new BadRequestException('Rejection reason is required');
        }
        updatedStore = await this.prisma.store.update({
          where: { id: storeId },
          data: {
            status: StoreStatus.REJECTED,
            approvedAt: null,
            approvedBy: adminId,
            rejectionReason: dto.rejectionReason,
          },
        });
        this.logger.log(`Store ${storeId} rejected: ${dto.rejectionReason}`);
        break;

      case StoreStatus.SUSPENDED:
        updatedStore = await this.prisma.store.update({
          where: { id: storeId },
          data: {
            status: StoreStatus.SUSPENDED,
            approvedAt: null,
            approvedBy: adminId,
            rejectionReason: dto.rejectionReason,
          },
        });
        this.logger.log(`Store ${storeId} suspended`);
        break;

      default:
        throw new BadRequestException('Invalid action');
    }

    return {
      success: true,
      message: `Store ${dto.action.toLowerCase()} successfully`,
      data: updatedStore,
    };
  }

  /**
   * Get dashboard statistics
   */
  async getDashboardStats() {
    const [
      totalUsers,
      totalVendors,
      totalStores,
      totalProducts,
      pendingVendors,
      pendingStores,
      approvedVendors,
      approvedStores,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: UserRole.VENDOR } }),
      this.prisma.store.count(),
      this.prisma.product.count(),
      this.prisma.user.count({
        where: { status: UserStatus.UNDER_REVIEW },
      }),
      this.prisma.store.count({ where: { status: StoreStatus.INACTIVE } }),
      this.prisma.user.count({
        where: { status: UserStatus.APPROVED },
      }),
      this.prisma.store.count({ where: { status: StoreStatus.INACTIVE } }),
    ]);

    return {
      success: true,
      data: {
        totalUsers,
        totalVendors,
        totalStores,
        totalProducts,
        pendingApprovals: {
          vendors: pendingVendors,
          stores: pendingStores,
        },
        approved: {
          vendors: approvedVendors,
          stores: approvedStores,
        },
      },
    };
  }

  /**
   * Get vendor details by ID
   */
  async getVendorDetails(vendorId: string) {
    const vendor = await this.prisma.user.findFirst({
      where: {
        id: vendorId,
        role: UserRole.VENDOR,
      },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        countryCode: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        isVerified: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
        emailVerifiedAt: true,
        isEmailVerified: true,
        isPhoneVerified: true,
        onboardingCompletedAt: true,
        phoneVerifiedAt: true,
        status: true,
        profilePicture: true,
        onboardingStatus: true,
        onboardingStep: true,
        approvedAt: true,
        approvedBy: true,
        rejectionReason: true,
        isNewUser: true,

        businessInfo: true,

        stores: {
          include: {
            _count: {
              select: { products: true },
            },
          },
        },

        documents: {
          select: {
            id: true,
            documentType: true,
            documentUrl: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    return {
      success: true,
      data: vendor,
    };
  }

  async getVendorDetails2(vendorId: string) {
    const vendor = await this.prisma.user.findFirst({
      where: {
        id: vendorId,
        role: UserRole.VENDOR,
      },
      include: {
        businessInfo: true,
        stores: {
          include: {
            _count: {
              select: { products: true },
            },
          },
        },
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    return {
      success: true,
      data: vendor,
    };
  }

  /**
   * Get store details by ID
   */
  async getStoreDetails(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        user: {
          include: {
            businessInfo: true,
          },
        },
        products: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    return {
      success: true,
      data: store,
    };
  }

  // ========== CATEGORY SERVICES ==========
  async createCategory(
    dto: CreateCategoryDto,
    files?: {
      image?: Express.Multer.File[];
      icon?: Express.Multer.File[];
    },
  ) {
    try {
      let imageUrl: string | null = null;
      let iconUrl: string | null = null;

      // ✅ Upload image
      if (files?.image?.[0]) {
        const uploadResult = await this.cloudinaryService.uploadLogo(
          files.image[0],
        );
        imageUrl = uploadResult.secure_url;
      }

      // ✅ Upload icon
      if (files?.icon?.[0]) {
        const uploadResult = await this.cloudinaryService.uploadLogo(
          files.icon[0],
        );
        iconUrl = uploadResult.secure_url;
      }

      return await this.prisma.category.create({
        data: {
          name: dto.name,
          description: dto.description,
          icon: iconUrl, // 👈 now from Cloudinary
          image: imageUrl,
          isActive: dto.isActive ?? true,
          displayOrder: dto.displayOrder ?? 0,
        },
        include: {
          subcategories: true,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Category with this name already exists');
      }
      throw error;
    }
  }

  async createCategorywithouticonimage(dto: CreateCategoryDto) {
    try {
      return await this.prisma.category.create({
        data: {
          name: dto.name,
          description: dto.description,
          icon: dto.icon,
          image: dto.image,
          isActive: dto.isActive ?? true,
          displayOrder: dto.displayOrder ?? 0,
        },
        include: {
          subcategories: true,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Category with this name already exists');
      }
      throw error;
    }
  }

  async getAllCategories() {
    return this.prisma.category.findMany({
      include: {
        subcategories: {
          orderBy: { displayOrder: 'asc' },
        },
        _count: {
          select: { stores: true },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getCategoryById(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        subcategories: {
          orderBy: { displayOrder: 'asc' },
        },
        stores: {
          select: {
            id: true,
            storeName: true,
            status: true,
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return {
      id: category.id,
      name: category.name,
      image: category.image, // ✅ included
      icon: category.icon, // ✅ included
      isActive: category.isActive,
      subcategories: category.subcategories,
      stores: category.stores,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }

  async getCategoryByIdOld(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        subcategories: {
          orderBy: { displayOrder: 'asc' },
        },
        stores: {
          select: {
            id: true,
            storeName: true,
            status: true,
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryDto,
    files?: {
      image?: Express.Multer.File[];
      icon?: Express.Multer.File[];
    },
  ) {
    try {
      let imageUrl: string | null = null;
      let iconUrl: string | null = null;

      // ✅ Upload new image if provided
      if (files?.image?.[0]) {
        const uploadResult = await this.cloudinaryService.uploadLogo(
          files.image[0],
        );
        imageUrl = uploadResult.secure_url;
      }

      // ✅ Upload new icon if provided
      if (files?.icon?.[0]) {
        const uploadResult = await this.cloudinaryService.uploadLogo(
          files.icon[0],
        );
        iconUrl = uploadResult.secure_url;
      }

      return await this.prisma.category.update({
        where: { id },
        data: {
          ...dto,
          ...(imageUrl && { image: imageUrl }),
          ...(iconUrl && { icon: iconUrl }),
        },
        include: {
          subcategories: true,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Category with this name already exists');
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Category not found');
      }
      throw error;
    }
  }

  async updateCategoryWithimage(id: string, dto: UpdateCategoryDto) {
    try {
      return await this.prisma.category.update({
        where: { id },
        data: dto,
        include: {
          subcategories: true,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Category with this name already exists');
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Category not found');
      }
      throw error;
    }
  }

  async deleteCategory(id: string) {
    try {
      return await this.prisma.category.delete({
        where: { id },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new NotFoundException('Category not found');
      }
      throw error;
    }
  }

  async softDeleteCategory(id: string) {
    // Soft delete by setting isActive to false
    try {
      return await this.prisma.category.update({
        where: { id },
        data: { isActive: false },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new NotFoundException('Category not found');
      }
      throw error;
    }
  }

  async toggleCategoryStatus(id: string) {
    const category = await this.getCategoryById(id);

    return this.prisma.category.update({
      where: { id },
      data: { isActive: !category.isActive },
    });
  }

  async updateDisplayOrder(id: string, displayOrder: number) {
    return this.prisma.category.update({
      where: { id },
      data: { displayOrder },
    });
  }

  async bulkReorderCategories(
    categories: { id: string; displayOrder: number }[],
  ) {
    const updates = categories.map(({ id, displayOrder }) =>
      this.prisma.category.update({
        where: { id },
        data: { displayOrder },
      }),
    );

    return this.prisma.$transaction(updates);
  }

  // ========== SUBCATEGORY SERVICES ==========

  async createSubcategory(dto: CreateSubcategoryDto) {
    // Verify category exists
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    try {
      return await this.prisma.subcategory.create({
        data: {
          name: dto.name,
          description: dto.description,
          icon: dto.icon,
          image: dto.image,
          categoryId: dto.categoryId,
          isActive: dto.isActive ?? true,
          displayOrder: dto.displayOrder ?? 0,
        },
        include: {
          category: true,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Subcategory with this name already exists in this category',
        );
      }
      throw error;
    }
  }

  async getAllSubcategories() {
    return this.prisma.subcategory.findMany({
      include: {
        category: true,
        _count: {
          // select: { storeSubcategories: true },
          select: { products: true }, // ✅ FIXED
        },
      },
      orderBy: [{ categoryId: 'asc' }, { displayOrder: 'asc' }],
    });
  }

  async getSubcategoriesByCategory(categoryId: string) {
    return this.prisma.subcategory.findMany({
      where: { categoryId },
      include: {
        _count: {
          select: { products: true }, // ✅ FIXED
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getSubcategoryById(id: string) {
    const subcategory = await this.prisma.subcategory.findUnique({
      where: { id },
      include: {
        category: true,
        products: {
          include: {
            store: {
              select: {
                id: true,
                storeName: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!subcategory) {
      throw new NotFoundException('Subcategory not found');
    }

    // ✅ Extract unique stores
    const storesMap = new Map();

    subcategory.products.forEach((product) => {
      if (product.store) {
        storesMap.set(product.store.id, product.store);
      }
    });

    const stores = Array.from(storesMap.values());

    return {
      id: subcategory.id,
      name: subcategory.name,
      image: subcategory.image, // ✅ included
      icon: subcategory.icon, // ✅ included
      isActive: subcategory.isActive,
      category: subcategory.category,
      products: subcategory.products,
      stores,
      createdAt: subcategory.createdAt,
      updatedAt: subcategory.updatedAt,
    };
  }

  async getSubcategoryByIdold(id: string) {
    const subcategory = await this.prisma.subcategory.findUnique({
      where: { id },
      include: {
        category: true,
        products: {
          include: {
            store: {
              select: {
                id: true,
                storeName: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!subcategory) {
      throw new NotFoundException('Subcategory not found');
    }

    // ✅ Extract unique stores
    const storesMap = new Map();

    subcategory.products.forEach((product) => {
      if (product.store) {
        storesMap.set(product.store.id, product.store);
      }
    });

    const stores = Array.from(storesMap.values());

    return {
      ...subcategory,
      stores, // ✅ clean store list
    };
  }

  async updateSubcategory(
    id: string,
    dto: UpdateSubcategoryDto,
    files?: {
      image?: Express.Multer.File[];
      icon?: Express.Multer.File[];
    },
  ) {
    try {
      let imageUrl: string | null = null;
      let iconUrl: string | null = null;

      // ✅ Upload new image if provided
      if (files?.image?.[0]) {
        const uploadResult = await this.cloudinaryService.uploadLogo(
          files.image[0],
        );
        imageUrl = uploadResult.secure_url;
      }

      // ✅ Upload new icon if provided
      if (files?.icon?.[0]) {
        const uploadResult = await this.cloudinaryService.uploadLogo(
          files.icon[0],
        );
        iconUrl = uploadResult.secure_url;
      }

      return await this.prisma.subcategory.update({
        where: { id },
        data: {
          ...dto,
          ...(imageUrl && { image: imageUrl }),
          ...(iconUrl && { icon: iconUrl }),
        },
        include: {
          category: true,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Subcategory with this name already exists in this category',
        );
      }

      if (error.code === 'P2025') {
        throw new NotFoundException('Subcategory not found');
      }

      throw error;
    }
  }

  async updateSubcategoryold(id: string, dto: UpdateSubcategoryDto) {
    try {
      return await this.prisma.subcategory.update({
        where: { id },
        data: dto,
        include: {
          category: true,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Subcategory with this name already exists in this category',
        );
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Subcategory not found');
      }
      throw error;
    }
  }

  async deleteSubcategory(id: string) {
    try {
      return await this.prisma.subcategory.delete({
        where: { id },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new NotFoundException('Subcategory not found');
      }
      throw error;
    }
  }

  async softDeleteSubcategory(id: string) {
    // Soft delete by setting isActive to false
    try {
      return await this.prisma.subcategory.update({
        where: { id },
        data: { isActive: false },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new NotFoundException('Subcategory not found');
      }
      throw error;
    }
  }

  async toggleSubcategoryStatus(id: string) {
    const subcategory = await this.getSubcategoryById(id);

    return this.prisma.subcategory.update({
      where: { id },
      data: { isActive: !subcategory.isActive },
    });
  }

  async updateSubcategoryDisplayOrder(id: string, displayOrder: number) {
    return this.prisma.subcategory.update({
      where: { id },
      data: { displayOrder },
    });
  }
}
