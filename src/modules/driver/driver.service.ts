// src/drivers/services/driver-onboarding.service.ts
import {
  Injectable,
  Logger,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { DriverStep2Dto } from './dto/step2-driver.dto';
import { DriverStep3MetadataDto } from './dto/step3-driver.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { UserRole, UserStatus } from '../../shared/enums';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { NotificationType, OnBoardingStatus, Role } from '@prisma/client';
import { DriverOnboardingDto } from './dto/driver-onboarding.dto';
import { AbstractUserRepository } from '../user/repositories/abstract-user.repository';
import { DriverDocumentMetadataDto } from './dto/driver-document-metadata.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../modules/redis/redis.provider';
import { OrderStatus, AssignmentStatus, DriverStatus } from '@prisma/client';
import { MapGateway } from 'src/common/map-gateway/map.gateway';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ZohoEmailProvider } from '../verification/providers/zoho-email.provider';
import { VendorNotificationGateway } from 'src/common/map-gateway/vendor-notification.gateway';
import { OrderService } from '../order/order.service';

export enum DriverDocumentType {
  DRIVER_LICENSE = 'DRIVER_LICENSE',
  VEHICLE_INSURANCE = 'VEHICLE_INSURANCE',
  VEHICLE_REGISTRATION = 'VEHICLE_REGISTRATION',
}

type NearbyDriver = {
  userId: string;
  lat: number;
  lng: number;
};

const CLAIM_SCRIPT = `
  if redis.call('EXISTS', KEYS[1]) == 1 and redis.call('SETNX', KEYS[2], ARGV[1]) == 1 then
    redis.call('DEL', KEYS[1])
    return 1
  else
    return 0
  end
`;

@Injectable()
export class DriverService {
  private readonly logger = new Logger(DriverService.name);
  private readonly googleMapsApiKey: string;

  constructor(
    public readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly userRepository: AbstractUserRepository,
    @Inject(REDIS_CLIENT) public redis: Redis,
    @InjectQueue('driver-notification') private notificationQueue: Queue,
    @InjectQueue('driver-assignment') private assignmentQueue: Queue,
    private zohoEmailProvider: ZohoEmailProvider,
    private vendorNotificationGateway: VendorNotificationGateway,
    private mapGateway: MapGateway,
    private configService: ConfigService,
    private readonly orderService: OrderService,
  ) {
    this.googleMapsApiKey = this.configService.get('GOOGLE_MAPS_API_KEY');
    if (!this.googleMapsApiKey) {
      this.logger.warn(
        'Google Maps API key is missing – ETA calculation will fail',
      );
    }
  }

  async saveDriverOnboardingStep(
    driverId: string,
    step: number,
    dto: Partial<DriverOnboardingDto>,
  ) {
    // 1️⃣ Validate the driver exists and can continue onboarding
    const driver = await this.validateDriverForOnboarding(driverId);

    if (step > (driver.onboardingStep ?? 0) + 1) {
      throw new ConflictException(
        `Complete step ${(driver.onboardingStep ?? 0) + 1} first`,
      );
    }

    // 2️⃣ Step-based logic
    switch (step) {
      case 1:
        // Step 1: Personal Information → CREATE profile
        await this.prisma.driverProfile.create({
          data: {
            userId: driverId,
            // fullName: dto.fullName!,
            //phoneNumber: dto.phoneNumber!,
            //email: dto.email!,
            address: dto.address!,
            city: dto.city!,
            state: dto.state!,
          },
        });
        break;
      // case 1: {
      //   // 1️⃣ Build full address
      //   const parts = [
      //     dto.address,
      //     dto.city,
      //     dto.state,
      //     dto.country || 'Nigeria',
      //   ].filter(Boolean);

      //   const fullAddress = parts.join(', ');

      //   let latitude: number | undefined;
      //   let longitude: number | undefined;

      //   // 2️⃣ Geocode address
      //   const geo = await Helper.geocodeAddress(fullAddress);

      //   if (geo) {
      //     latitude = geo.lat;
      //     longitude = geo.lng;

      //     this.logger.log(
      //       `Driver coordinates resolved: ${latitude}, ${longitude}`,
      //     );
      //   } else {
      //     this.logger.warn(`Could not resolve coordinates for: ${fullAddress}`);
      //   }

      //   // 3️⃣ Create driver profile
      //   await this.prisma.driverProfile.create({
      //     data: {
      //       userId: driverId,
      //       address: dto.address,
      //       city: dto.city,
      //       state: dto.state,
      //       country: dto.country || 'NG',
      //       latitude,
      //       longitude,
      //       locationUpdatedAt: latitude && longitude ? new Date() : null,
      //     },
      //   });

      //   break;
      // }

      case 2:
        // Step 2: Vehicle Information → UPDATE profile
        await this.prisma.driverProfile.update({
          where: { userId: driverId },
          data: {
            vehicleType: dto.vehicleType!,
            vehicleMake: dto.vehicleMake!,
            vehicleModel: dto.vehicleModel!,
            year: dto.year!,
            licensePlate: dto.licensePlate!,
          },
        });
        break;

      case 3:
        // Step 3: Documents → must be uploaded via a separate service
        // Here we just mark the step as complete
        break;

      default:
        throw new BadRequestException('Invalid onboarding step');
    }

    // 3️⃣ Update the user's onboarding status and step
    const newStatus =
      step < 4 ? UserStatus.PENDING_DOCUMENTS : UserStatus.UNDER_REVIEW;

    const newOnboardingStatus =
      step < 4 ? OnBoardingStatus.IN_PROGRESS : OnBoardingStatus.COMPLETED;

    await this.userRepository.updateDriver(driverId, {
      onboardingStep: step,
      onboardingStatus: newOnboardingStatus,
      status: newStatus,
    });

    // 4️⃣ Return response
    return {
      success: true,
      message: `Step ${step} saved successfully`,
      onboardingStep: step,
      onboardingStatus: newOnboardingStatus,
      status: newStatus,
    };
  }

  async submitDriverOnboarding(
    driverId: string,
    files: Express.Multer.File[],
    metadata: DriverDocumentMetadataDto[],
  ) {
    const driver = await this.validateDriverForOnboarding(driverId);

    if (driver.onboardingStep < 2) {
      throw new ConflictException(
        'Complete previous steps before uploading documents',
      );
    }

    if (!files || files.length !== 3) {
      throw new BadRequestException('Exactly 3 document files are required');
    }

    if (metadata.length !== 3) {
      throw new BadRequestException('Exactly 3 metadata entries are required');
    }

    const requiredTypes: DriverDocumentType[] = [
      DriverDocumentType.DRIVER_LICENSE,
      DriverDocumentType.VEHICLE_INSURANCE,
      DriverDocumentType.VEHICLE_REGISTRATION,
    ];

    const providedTypes = metadata.map((m) => m.documentType);

    // ✅ Prevent duplicates
    const uniqueTypes = new Set(providedTypes);
    if (uniqueTypes.size !== providedTypes.length) {
      throw new BadRequestException('Duplicate document types not allowed');
    }

    // ✅ Ensure all required types exist
    for (const type of requiredTypes) {
      if (!providedTypes.includes(type)) {
        throw new BadRequestException(`${type} is required`);
      }
    }

    const uploadedDocs = await this.uploadDriverDocuments(
      driverId,
      files,
      metadata,
    );

    const updatedDriver = await this.userRepository.update(driverId, {
      onboardingStatus: OnBoardingStatus.COMPLETED,
      onboardingStep: 4,
      onboardingCompletedAt: new Date(),
      status: UserStatus.UNDER_REVIEW,
    });

    return {
      success: true,
      message: 'Driver onboarding submitted. Under review.',
      driver: {
        id: updatedDriver.id,
        email: updatedDriver.email,
        onboardingStep: updatedDriver.onboardingStep,
        onboardingStatus: updatedDriver.onboardingStatus,
        status: updatedDriver.status,
      },
      documents: uploadedDocs,
    };
  }

  async getDriverOnboardingState(driverId: string) {
    const driver = await this.userRepository.findById(driverId);

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    if (driver.role !== UserRole.DISPATCHER) {
      throw new ForbiddenException('User is not a driver');
    }

    return {
      onboardingStatus: driver.onboardingStatus,
      onboardingStep: driver.onboardingStep ?? 0,
      status: driver.status,

      // Helpful for frontend logic
      isOnboardingComplete:
        driver.onboardingStatus === OnBoardingStatus.COMPLETED,

      nextStep: this.getNextDriverStep(driver.onboardingStep),
    };
  }

  private getNextDriverStep(step?: number): number {
    if (!step) return 1;

    if (step >= 4) return 4;

    return step + 1;
  }

  async uploadDriverDocuments(
    userId: string,
    files: Express.Multer.File[],
    metadata: DriverDocumentMetadataDto[],
  ) {
    // ✅ Get DriverProfile ID (CRITICAL FIX)
    const driverProfile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });

    if (!driverProfile) {
      throw new NotFoundException('Driver profile not found');
    }

    const driverId = driverProfile.id;

    const uploadPromises = files.map(async (file, i) => {
      const meta = metadata[i];

      // 1️⃣ Upload file
      const uploadResult = await this.cloudinaryService.uploadLogo(file);

      // 2️⃣ Check if document already exists
      const existing = await this.prisma.driverDocument.findUnique({
        where: {
          driverId_documentType: {
            driverId,
            documentType: meta.documentType,
          },
        },
      });

      if (existing) {
        return existing; // skip duplicate
      }

      // 3️⃣ Create document
      return this.prisma.driverDocument.create({
        data: {
          driverId,
          documentType: meta.documentType,
          documentUrl: uploadResult.secure_url,
          publicId: uploadResult.public_id,
        },
      });
    });

    return Promise.all(uploadPromises);
  }

  /////////////////////////////////////////////////

  /**
   * Validate driver exists and is in correct state
   */
  async validateDriverForOnboarding(driverId: string) {
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: { driverProfile: true },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    if (driver.role !== UserRole.DISPATCHER) {
      throw new BadRequestException('User is not a driver');
    }

    return driver;
  }

  /**
   * Save Step 1: Personal Information
   */
  // async saveStep1(driverId: string, dto: DriverStep1Dto) {
  //   this.logger.log(`Saving step 1 for driver: ${driverId}`);

  //   const driver = await this.validateDriverForOnboarding(driverId);

  //   // Check sequential order
  //   if ((driver.onboardingStep ?? 0) > 1) {
  //     throw new ConflictException('Already completed step 1');
  //   }

  //   // Check if email or phone already exists for active users
  //   const existingUser = await this.prisma.user.findFirst({
  //     where: {
  //       OR: [{ email: dto.email }, { phoneNumber: dto.phoneNumber }],
  //       NOT: { id: driverId },
  //       //status: { not: 'DELETED' },
  //     },
  //   });

  //   if (existingUser) {
  //     throw new ConflictException('Email or phone number already in use');
  //   }

  //   // Update user basic info
  //   await this.prisma.user.update({
  //     where: { id: driverId },
  //     data: {
  //       email: dto.email,
  //       phoneNumber: dto.phoneNumber,
  //       firstName: dto.firstName,
  //       lastName: dto.lastName,
  //       // firstName: dto.fullName.split(' ')[0],
  //       // lastName: dto.fullName.split(' ').slice(1).join(' ') || '',
  //       onboardingStep: 1,
  //       onboardingStatus: OnBoardingStatus.IN_PROGRESS,
  //       status: UserStatus.PENDING_DOCUMENTS,
  //     },
  //   });

  //   // Create or update driver profile
  //   await this.prisma.driverProfile.upsert({
  //     where: { userId: driverId },
  //     create: {
  //       userId: driverId,
  //       firstName: dto.firstName,
  //       lastName: dto.lastName,
  //       phoneNumber: dto.phoneNumber,
  //       email: dto.email,
  //       address: dto.address,
  //       city: dto.city,
  //       state: dto.state,
  //       country: dto.country || 'NG',
  //       postalCode: dto.postalCode,
  //       // user: {
  //       //   connect: { id: driverId },
  //       // },
  //     },
  //     update: {
  //       firstName: dto.firstName,
  //       lastName: dto.lastName,
  //       phoneNumber: dto.phoneNumber,
  //       email: dto.email,
  //       address: dto.address,
  //       city: dto.city,
  //       state: dto.state,
  //       country: dto.country || 'NG',
  //       postalCode: dto.postalCode,
  //     },
  //   });

  //   return {
  //     success: true,
  //     message: 'Step 1 completed successfully',
  //     onboardingStep: 1,
  //     onboardingStatus: OnBoardingStatus.IN_PROGRESS,
  //     nextStep: 2,
  //   };
  // }

  /**
   * Save Step 2: Vehicle Information
   */
  async saveStep2(driverId: string, dto: DriverStep2Dto) {
    this.logger.log(`Saving step 2 for driver: ${driverId}`);

    const driver = await this.validateDriverForOnboarding(driverId);

    if (driver.onboardingStep !== 1) {
      throw new ConflictException('Please complete step 1 first');
    }

    // Check if license plate already exists
    const existingProfile = await this.prisma.driverProfile.findFirst({
      where: {
        licensePlate: dto.licensePlate,
        NOT: { userId: driverId },
      },
    });

    if (existingProfile) {
      throw new ConflictException('License plate already registered');
    }

    await this.prisma.driverProfile.update({
      where: { userId: driverId },
      data: {
        vehicleType: dto.vehicleType,
        vehicleMake: dto.vehicleMake,
        vehicleModel: dto.vehicleModel,
        year: dto.year,
        licensePlate: dto.licensePlate,
      },
    });

    await this.prisma.user.update({
      where: { id: driverId },
      data: { onboardingStep: 2 },
    });

    return {
      success: true,
      message: 'Step 2 completed successfully',
      onboardingStep: 2,
      onboardingStatus: OnBoardingStatus.IN_PROGRESS,
      nextStep: 3,
    };
  }

  /**
   * Save Step 3: Document Uploads
   */
  async saveStep3(
    driverId: string,
    files: {
      driverLicense?: Express.Multer.File[];
      vehicleInsurance?: Express.Multer.File[];
      vehicleRegistration?: Express.Multer.File[];
    },
    metadata?: DriverStep3MetadataDto,
  ) {
    this.logger.log(`Saving step 3 for driver: ${driverId}`);

    const driver = await this.validateDriverForOnboarding(driverId);

    if (driver.onboardingStep !== 2) {
      throw new ConflictException('Please complete step 2 first');
    }

    const uploads: any = {};

    // Upload driver license
    if (files.driverLicense && files.driverLicense[0]) {
      const result = await this.cloudinaryService.uploadDocument(
        files.driverLicense[0],
        {
          folder: `drivers/${driverId}/documents`,
          tags: ['driver-license', driverId],
        },
      );
      uploads.driverLicenseUrl = result.secure_url;
      uploads.driverLicensePublicId = result.public_id;
    } else if (metadata?.driverLicenseUrl) {
      uploads.driverLicenseUrl = metadata.driverLicenseUrl;
    }

    // Upload vehicle insurance
    if (files.vehicleInsurance && files.vehicleInsurance[0]) {
      const result = await this.cloudinaryService.uploadDocument(
        files.vehicleInsurance[0],
        {
          folder: `drivers/${driverId}/documents`,
          tags: ['vehicle-insurance', driverId],
        },
      );
      uploads.vehicleInsuranceUrl = result.secure_url;
      uploads.vehicleInsurancePublicId = result.public_id;
    } else if (metadata?.vehicleInsuranceUrl) {
      uploads.vehicleInsuranceUrl = metadata.vehicleInsuranceUrl;
    }

    // Upload vehicle registration
    if (files.vehicleRegistration && files.vehicleRegistration[0]) {
      const result = await this.cloudinaryService.uploadDocument(
        files.vehicleRegistration[0],
        {
          folder: `drivers/${driverId}/documents`,
          tags: ['vehicle-registration', driverId],
        },
      );
      uploads.vehicleRegistrationUrl = result.secure_url;
      uploads.vehicleRegistrationPublicId = result.public_id;
    } else if (metadata?.vehicleRegistrationUrl) {
      uploads.vehicleRegistrationUrl = metadata.vehicleRegistrationUrl;
    }

    await this.prisma.driverProfile.update({
      where: { userId: driverId },
      data: uploads,
    });

    await this.prisma.user.update({
      where: { id: driverId },
      data: { onboardingStep: 3 },
    });

    return {
      success: true,
      message: 'Step 3 completed successfully',
      onboardingStep: 3,
      onboardingStatus: OnBoardingStatus.IN_PROGRESS,
      nextStep: 4,
      uploadedDocuments: {
        driverLicense: !!uploads.driverLicenseUrl,
        vehicleInsurance: !!uploads.vehicleInsuranceUrl,
        vehicleRegistration: !!uploads.vehicleRegistrationUrl,
      },
    };
  }

  /**
   * Save Step 4: Review and Submit
   */
  // async saveStep4(driverId: string, dto: DriverStep4Dto) {
  //   this.logger.log(`Saving step 4 for driver: ${driverId}`);

  //   const driver = await this.validateDriverForOnboarding(driverId);

  //   if (driver.onboardingStep !== 3) {
  //     throw new ConflictException('Please complete step 3 first');
  //   }

  //   if (!dto.confirmInformation) {
  //     throw new BadRequestException(
  //       'Please confirm that all information is correct',
  //     );
  //   }

  //   // Get full driver profile to validate all fields
  //   const profile = await this.prisma.driverProfile.findUnique({
  //     where: { userId: driverId },
  //     include: {
  //       documents: true,
  //     },
  //   });

  //   if (!profile) {
  //     throw new BadRequestException('Driver profile not found');
  //   }

  //   // ✅ Validate required fields
  //   const requiredFields = [
  //     driver.firstName + ' ' + driver.lastName,
  //     driver.phoneNumber,
  //     driver.email,
  //     profile.address,
  //     profile.city,
  //     profile.state,
  //     profile.vehicleType,
  //     profile.vehicleMake,
  //     profile.vehicleModel,
  //     profile.year,
  //     profile.licensePlate,
  //   ];

  //   const hasAllRequiredFields = requiredFields.every(
  //     (field) => field !== null && field !== undefined && field !== '',
  //   );

  //   if (!hasAllRequiredFields) {
  //     throw new BadRequestException('Please complete all required fields');
  //   }

  //   // ✅ Validate required documents (FIXED)
  //   const docs = profile.documents || [];

  //   const requiredDocTypes = [
  //     'DRIVER_LICENSE',
  //     'VEHICLE_INSURANCE',
  //     'VEHICLE_REGISTRATION',
  //   ];

  //   const hasAllDocuments = requiredDocTypes.every((type) =>
  //     docs.some((doc) => {
  //       if (doc.documentType !== type) return false;

  //       // Works with your current schema
  //       return (
  //         doc.driverLicenseUrl ||
  //         doc.vehicleInsuranceUrl ||
  //         doc.vehicleRegistrationUrl
  //       );
  //     }),
  //   );

  //   if (!hasAllDocuments) {
  //     throw new BadRequestException('Please upload all required documents');
  //   }

  //   // Update user status to under review
  //   await this.prisma.user.update({
  //     where: { id: driverId },
  //     data: {
  //       onboardingStep: 4,
  //       onboardingStatus: OnBoardingStatus.COMPLETED,
  //       status: UserStatus.UNDER_REVIEW,
  //     },
  //   });

  //   return {
  //     success: true,
  //     message: 'Driver onboarding completed. Your application is under review.',
  //     onboardingStep: 4,
  //     onboardingStatus: OnBoardingStatus.COMPLETED,
  //     status: UserStatus.UNDER_REVIEW,
  //     nextSteps: [
  //       'Application is being reviewed by admin',
  //       'You will be notified once approved',
  //       'Approval typically takes 2-3 business days',
  //     ],
  //   };
  // }

  /**
   * Get current onboarding state
   */
  // async getOnboardingState(driverId: string) {
  //   const driver = await this.prisma.user.findUnique({
  //     where: { id: driverId },
  //     include: {
  //       driverProfile: {
  //         include: {
  //           documents: true,
  //         },
  //       },
  //     },
  //   });

  //   if (!driver) {
  //     throw new NotFoundException('Driver not found');
  //   }

  //   // Determine completed steps based on data
  //   const completedSteps: number[] = [];

  //   // ✅ Step 1: Use user's name instead of driverProfile.fullName
  //   if (driver.firstName && driver.lastName) completedSteps.push(1);

  //   if (driver.driverProfile?.vehicleType) completedSteps.push(2);

  //   // Step 3: Check documents
  //   const docs = driver.driverProfile?.documents || [];

  //   const hasDriverLicense = docs.some(
  //     (doc) => doc.documentType === 'DRIVER_LICENSE' && doc.driverLicenseUrl,
  //   );

  //   if (hasDriverLicense) completedSteps.push(3);

  //   if (driver.onboardingStatus === OnBoardingStatus.COMPLETED) {
  //     completedSteps.push(4);
  //   }

  //   // Determine next step
  //   const nextStep = driver.onboardingStep ? driver.onboardingStep + 1 : 1;

  //   return {
  //     onboardingStatus: driver.onboardingStatus,
  //     onboardingStep: driver.onboardingStep,
  //     accountStatus: driver.status,
  //     userRole: driver.role,
  //     nextStep: nextStep <= 4 ? nextStep : null,
  //     completedSteps,
  //     redirectUrl: this.getRedirectUrl(driver.status, driver.onboardingStatus),
  //     profile: {
  //       // ✅ Use user fields instead
  //       fullName: `${driver.firstName} ${driver.lastName}`,
  //       phoneNumber: driver.phoneNumber, // From User model
  //       email: driver.email, // From User model
  //       vehicleType: driver.driverProfile?.vehicleType,
  //       licensePlate: driver.driverProfile?.licensePlate,
  //       hasDocuments: !!(
  //         docs.some(
  //           (doc) =>
  //             doc.documentType === 'DRIVER_LICENSE' && doc.driverLicenseUrl,
  //         ) &&
  //         docs.some(
  //           (doc) =>
  //             doc.documentType === 'VEHICLE_INSURANCE' &&
  //             doc.vehicleInsuranceUrl,
  //         ) &&
  //         docs.some(
  //           (doc) =>
  //             doc.documentType === 'VEHICLE_REGISTRATION' &&
  //             doc.vehicleRegistrationUrl,
  //         )
  //       ),
  //     },
  //   };
  // }

  /**
   * Get driver dashboard data after approval
   */
  async getDriverDashboard(driverId: string) {
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: {
        driverProfile: true,
      },
    });

    if (!driver || driver.status !== 'ACTIVE') {
      throw new BadRequestException('Driver account is not active');
    }

    return {
      personalInfo: {
        id: driver.id,
        firstName: driver.firstName,
        lastName: driver.lastName,
        email: driver.email,
        phoneNumber: driver.phoneNumber,
        profileImage: driver.profilePicture,
        countryCode: driver.countryCode,
        createdAt: driver.createdAt,
        active: driver.isActive,
        verifiedAt: driver.verifiedAt,
        approvedAt: driver.approvedAt,
      },
      profile: driver.driverProfile,
      stats: {
        totalDeliveries: driver.driverProfile?.totalDeliveries || 0,
        rating: driver.driverProfile?.rating || 0,
        status: driver.driverProfile?.status,
      },
    };
  }

  async getDriverDashboardbk(driverId: string) {
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: {
        driverProfile: true,
      },
    });

    if (!driver || driver.status !== 'ACTIVE') {
      throw new BadRequestException('Driver account is not active');
    }

    return {
      profile: driver.driverProfile,
      stats: {
        totalDeliveries: driver.driverProfile?.totalDeliveries || 0,
        rating: driver.driverProfile?.rating || 0,
        staus: driver.driverProfile?.status,
      },
    };
  }

  private getRedirectUrl(
    status: string,
    onboardingStatus: OnBoardingStatus,
  ): string {
    if (status === 'ACTIVE') {
      return '/driver/dashboard';
    }
    if (status === 'UNDER_REVIEW') {
      return '/driver/onboarding/review-pending';
    }
    if (onboardingStatus === OnBoardingStatus.IN_PROGRESS) {
      return '/driver/onboarding';
    }
    return '/driver/onboarding/start';
  }

  //////////////DRIVER TRACKING////////////

  /**
   * Find available orders within a given radius of a driver's location.
   * Uses PostgreSQL earthdistance module with GiST index for efficient geo‑queries.
   * @param driverLat - Latitude of the driver (WGS84)
   * @param driverLng - Longitude of the driver (WGS84)
   * @param radiusKm - Search radius in kilometers (default 10)
   * @returns List of orders with store details and distance, optionally enriched with items.
   */


  async findAvailableOrders(
  driverLat: number,
  driverLng: number,
  radiusKm: number = 10,
) {
  if (!this.isValidLatitude(driverLat) || !this.isValidLongitude(driverLng)) {
    throw new Error('Invalid driver coordinates.');
  }

  // First, find stores within radius using Prisma
  const storesInRadius = await this.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "Store"
    WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND earth_box(ll_to_earth(${driverLat}, ${driverLng}), ${radiusKm * 1000}) @>
          ll_to_earth(latitude, longitude)
      AND earth_distance(
        ll_to_earth(latitude, longitude),
        ll_to_earth(${driverLat}, ${driverLng})
      ) <= ${radiusKm * 1000}
  `;

  const storeIds = storesInRadius.map(store => store.id);

  if (storeIds.length === 0) {
    return [];
  }

  // Then find orders that have items from these stores
  const orders = await this.prisma.order.findMany({
    where: {
      orderStatus: 'ORDER_ACCEPTED',
      items: {
        some: {
          storeId: { in: storeIds }
        }
      }
    },
    include: {
      items: {
        include: {
          store: {
            select: {
              id: true,
              storeName: true,
              latitude: true,
              longitude: true,
            }
          }
        }
      }
    },
    take: 20,
    orderBy: {
      createdAt: 'asc'
    }
  });

  // Calculate distances and format response
  return orders.map(order => {
    // Get the nearest store from the order items
    const stores = order.items
      .map(item => item.store)
      .filter((store): store is NonNullable<typeof store> => store !== null && store.latitude !== null && store.longitude !== null);

    if (stores.length === 0) return null;

    // Find the closest store in this order
    let closestStore = stores[0];
    let closestDistance = this.calculateDistance(
      driverLat, driverLng,
      closestStore.latitude!,
      closestStore.longitude!
    );

    for (const store of stores) {
      const distance = this.calculateDistance(
        driverLat, driverLng,
        store.latitude!,
        store.longitude!
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestStore = store;
      }
    }

    return {
      id: order.id,
      order_number: order.orderNumber,
      total_amount: order.totalAmount,
      pickup_location: order.pickupLocation,
      dropoff_location: order.dropoffLocation,
      created_at: order.createdAt,
      store_id: closestStore.id,
      store_name: closestStore.storeName,
      store_lat: closestStore.latitude,
      store_lng: closestStore.longitude,
      distance_meters: closestDistance,
      items: order.items.map(item => ({
        productName: item.productId || 'Unknown',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    };
  }).filter(order => order !== null);
}

// Helper to calculate distance between two points
private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = this.toRadians(lat2 - lat1);
  const dLon = this.toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

private toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

  async findAvailableOrders1(
    driverLat: number,
    driverLng: number,
    radiusKm: number = 10,
  ) {
    // 1. Input validation
    if (!this.isValidLatitude(driverLat) || !this.isValidLongitude(driverLng)) {
      throw new Error('Invalid driver coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.');
    }

    const radiusMeters = radiusKm * 1000;

    // 2. Raw query with earth_box pre‑filter (uses GiST index if available)
    // const availableOrders = await this.prisma.$queryRaw<Array<any>>`
    //   SELECT
    //     o.id,
    //     o.order_number,
    //     o.total_amount,
    //     o.pickup_location,
    //     o.dropoff_location,
    //     o.created_at,
    //     s.id AS store_id,
    //     s.store_name,
    //     s.latitude AS store_lat,
    //     s.longitude AS store_lng,
    //     earth_distance(
    //       ll_to_earth(s.latitude, s.longitude),
    //       ll_to_earth(${driverLat}, ${driverLng})
    //     ) AS distance_meters
    //   FROM orders o
    //   JOIN stores s ON s.id = o.store_id
    //   WHERE o.order_status = 'ORDER_ACCEPTED'
    //     AND s.latitude IS NOT NULL
    //     AND s.longitude IS NOT NULL
    //     -- bounding‑box pre‑filter (approx, uses index)
    //     AND earth_box(ll_to_earth(${driverLat}, ${driverLng}), ${radiusMeters}) @>
    //         ll_to_earth(s.latitude, s.longitude)
    //     -- exact distance filter
    //     AND earth_distance(
    //       ll_to_earth(s.latitude, s.longitude),
    //       ll_to_earth(${driverLat}, ${driverLng})
    //     ) <= ${radiusMeters}
    //   ORDER BY distance_meters ASC
    //   LIMIT 20
    // `;
    
  const availableOrders = await this.prisma.$queryRaw<Array<any>>`
    SELECT
      o.id,
      o.order_number,
      o.total_amount,
      o.pickup_location,
      o.dropoff_location,
      o.created_at,
      s.id AS store_id,
      s.store_name,
      s.latitude AS store_lat,
      s.longitude AS store_lng,
      earth_distance(
        ll_to_earth(s.latitude, s.longitude),
        ll_to_earth(${driverLat}, ${driverLng})
      ) AS distance_meters
    FROM "Order" o
    JOIN "Store" s ON s.id = o.store_id
    WHERE o.order_status = 'ORDER_ACCEPTED'
      AND s.latitude IS NOT NULL
      AND s.longitude IS NOT NULL
      AND earth_box(ll_to_earth(${driverLat}, ${driverLng}), ${radiusMeters}) @>
          ll_to_earth(s.latitude, s.longitude)
      AND earth_distance(
        ll_to_earth(s.latitude, s.longitude),
        ll_to_earth(${driverLat}, ${driverLng})
      ) <= ${radiusMeters}
    ORDER BY distance_meters ASC
    LIMIT 20
  `;

    // 3. (Optional) Enrich with order items summary
    if (availableOrders.length === 0) {
      return [];
    }

    const orderIds = availableOrders.map(order => String(order.id));
    const itemsSummary = await this.getOrderItemsSummary(orderIds);

    // Merge items into each order
    return availableOrders.map(order => ({
      ...order,
      items: itemsSummary[order.id] || [],
    }));
  }

  /**
   * Fetch a summary of items for multiple orders (e.g., item names, quantities).
   * Returns a map: orderId -> array of item summaries.
   */
  private async getOrderItemsSummary(orderIds: string[]): Promise<Record<string, any[]>> {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        orderId: true,
        quantity: true,
        unitPrice: true,
        productId: true,
      },
    });

    const productIds = [...new Set(items.map(item => item.productId).filter(Boolean))];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            productName: true,
          },
        })
      : [];

    const productNameById = products.reduce((acc, product) => {
      acc[product.id] = product.productName;
      return acc;
    }, {} as Record<string, string>);

    const summary: Record<number, any[]> = {};
    for (const item of items) {
      if (!summary[item.orderId]) summary[item.orderId] = [];
      summary[item.orderId].push({
        productName: item.productId ? productNameById[item.productId] || 'Unknown Product' : 'Unknown Product',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      });
    }
    return summary;
  }

  // Helper validators
  private isValidLatitude(lat: number): boolean {
    return typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
  }

  private isValidLongitude(lng: number): boolean {
    return typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180;
  }


  /**
   * Find orders that are available for pickup (ORDER_ACCEPTED) and whose vendor
   * is within a certain radius (default 10km) of the driver's current location.
   * Returns orders sorted by distance (closest first).
   */
  async findAvailableOrdersForMultipleStores(
    driverLat: number,
    driverLng: number,
    radiusKm: number = 10,
  ) {
    const radiusMeters = radiusKm * 1000;

    // Raw SQL using PostGIS earth_distance (ll_to_earth)
    const availableOrders = await this.prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_number,
        o.total_amount,
        o.pickup_location,
        o.dropoff_location,
        o.created_at,
        s.id as store_id,
        s.store_name,
        s.latitude as store_lat,
        s.longitude as store_lng,
        earth_distance(
          ll_to_earth(s.latitude, s.longitude),
          ll_to_earth(${driverLat}, ${driverLng})
        ) AS distance_meters
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN stores s ON s.id = oi.store_id
      WHERE o.order_status = 'ORDER_ACCEPTED'
        AND s.latitude IS NOT NULL 
        AND s.longitude IS NOT NULL
        AND earth_distance(
          ll_to_earth(s.latitude, s.longitude),
          ll_to_earth(${driverLat}, ${driverLng})
        ) <= ${radiusMeters}
      GROUP BY o.id, s.id, s.latitude, s.longitude
      ORDER BY distance_meters ASC
      LIMIT 20
    `;

    // Optionally enrich with item summaries
    return availableOrders;
  }

  /**
   * Log a driver's decline for an order.
   * Also removes the driver from the candidate pool in Redis (if using pending keys).
   */
  async declineOrder(orderId: string, driverId: string, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { orderStatus: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.orderStatus !== OrderStatus.ORDER_ACCEPTED) {
      throw new BadRequestException('Order is no longer available for action');
    }

    // Log decline in activity log
    await this.prisma.orderActivityLog.create({
      data: {
        orderId,
        actorId: driverId,
        actorRole: Role.DISPATCHER,
        action: 'DRIVER_DECLINED',
        reason: reason || 'No reason provided',
        metadata: { timestamp: new Date().toISOString() },
      },
    });

    // Optional: remove driver from Redis pending set for this order
    // (if you store a set of candidate drivers)
    const redis = this.redis; // assuming you have access to Redis
    if (redis) {
      await redis.srem(`order:${orderId}:candidates`, driverId);
    }

    this.logger.log(
      `Driver ${driverId} declined order ${orderId}, reason: ${reason || 'none'}`,
    );
    return { success: true };
  }

  /**
   * Confirm delivery: transition order to DELIVERED, update driver stats,
   * and trigger customer rating request.
   */
  async confirmDelivery(orderId: string, driverId: string) {
    // Verify that the driver is assigned to this order
    const assignment = await this.prisma.driverAssignment.findUnique({
      where: { orderId },
      select: { driverId: true, assignmentStatus: true },
    });

    if (!assignment || assignment.driverId !== driverId) {
      throw new BadRequestException('You are not assigned to this order');
    }
    if (assignment.assignmentStatus !== AssignmentStatus.ASSIGNED) {
      throw new BadRequestException('Order not in assigned state');
    }

    // Use the state machine to transition
    await this.orderService.transition(orderId, OrderStatus.DELIVERED, {
      actorId: driverId,
      actorRole: Role.DISPATCHER,
    });

    // Update driver profile: total deliveries +1, set status back to ONLINE
    await this.prisma.driverProfile.update({
      where: { userId: driverId },
      data: {
        status: DriverStatus.ONLINE,
        totalDeliveries: { increment: 1 },
      },
    });

    // Update driver assignment record
    await this.prisma.driverAssignment.update({
      where: { orderId },
      data: { deliveryConfirmedAt: new Date() },
    });

    // Trigger customer rating request (async – fire and forget)
    this.requestCustomerRating(orderId).catch((err) =>
      this.logger.error(`Failed to request rating for order ${orderId}`, err),
    );

    this.logger.log(`Order ${orderId} delivered by driver ${driverId}`);
    return { success: true, message: 'Order delivered successfully' };
  }

  /**
   * Private helper: send a push/in-app notification to the customer asking for rating.
   */
  private async requestCustomerRating(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, orderNumber: true },
    });
    if (!order) return;

    // Create in-app notification
    await this.prisma.notification.create({
      data: {
        userId: order.userId,
        type: 'RATING_REQUEST',
        title: 'Rate Your Delivery',
        body: `How was your delivery for order #${order.orderNumber}? Tap to rate.`,
        data: { orderId, orderNumber: order.orderNumber },
      },
    });

    // Send push notification if user has FCM token
    // await this.pushService.sendToCustomer(order.userId, { title: 'Rate your ride', ... });
  }

  ///////////////////////////////////

  // async initiateDriverSearch(
  //   orderId: string,
  //   vendorLocation: { lat: number; lng: number },
  // ) {
  //   try {
  //     // Create assignment record
  //     const assignment = await this.prisma.driverAssignment.create({
  //       data: { orderId, assignmentStatus: AssignmentStatus.PENDING },
  //     });

  //     // Enqueue the search job
  //     await this.assignmentQueue.add(
  //       'search-and-notify',
  //       { orderId, assignmentId: assignment.id, vendorLocation },
  //       { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  //     );
  //     this.logger.log(`Driver search initiated for order ${orderId}`);
  //   } catch (error) {
  //     this.logger.error(
  //       `Failed to initiate driver search for order ${orderId}`,
  //       error, //.stack,
  //     );
  //     throw error;
  //   }
  // }

  // async findAndNotifyDrivers(
  //   orderId: string,
  //   vendorLocation: { lat: number; lng: number },
  // ) {
  //   try {
  //     const drivers: NearbyDriver[] = await this.getNearbyDrivers(
  //       vendorLocation.lat,
  //       vendorLocation.lng,
  //       5000, // 5 km radius
  //     );

  //     if (drivers.length === 0) {
  //       await this.handleNoDrivers(orderId);
  //       return;
  //     }

  //     const pendingKey = `order:${orderId}:pending`;
  //     await this.redis.setex(pendingKey, 60, 'awaiting_driver');

  //     for (const driver of drivers) {
  //       await this.notificationQueue.add(
  //         'notify-driver',
  //         {
  //           driverId: driver.userId,
  //           orderId,
  //           vendorLocation,
  //           pendingKey,
  //         },
  //         {
  //           jobId: `notify-${orderId}-${driver.userId}`,
  //           attempts: 2,
  //           backoff: 1000,
  //         },
  //       );
  //     }

  //     // Timeout job (60 seconds) – if no driver claims, escalate
  //     await this.assignmentQueue.add(
  //       'assignment-timeout',
  //       { orderId, pendingKey },
  //       {
  //         delay: 60000,
  //         jobId: `timeout-${orderId}`,
  //         removeOnComplete: true,
  //       },
  //     );

  //     this.logger.log(
  //       `Notified ${drivers.length} drivers for order ${orderId}`,
  //     );
  //   } catch (error) {
  //     this.logger.error(
  //       `Error in findAndNotifyDrivers for order ${orderId}`,
  //       error.stack,
  //     );
  //     throw error;
  //   }
  // }

  // async getNearbyDrivers(
  //   lat: number,
  //   lng: number,
  //   radiusMeters: number,
  // ): Promise<NearbyDriver[]> {
  //   // Assumes PostGIS extension (earthdistance) is enabled
  //   return this.prisma.$queryRaw<NearbyDriver[]>`
  //     SELECT
  //       dp.user_id AS "userId",
  //       dp.latitude AS "lat",
  //       dp.longitude AS "lng"
  //     FROM driver_profiles dp
  //     WHERE dp.status = 'ONLINE'
  //       AND earth_distance(
  //         ll_to_earth(${lat}, ${lng}),
  //         ll_to_earth(dp.latitude, dp.longitude)
  //       ) <= ${radiusMeters}
  //     ORDER BY earth_distance(
  //       ll_to_earth(${lat}, ${lng}),
  //       ll_to_earth(dp.latitude, dp.longitude)
  //     ) ASC
  //     LIMIT 10
  //   `;
  // }

  // async driverAccepts(orderId: string, driverId: string): Promise<boolean> {
  //   const pendingKey = `order:${orderId}:pending`;
  //   const claimKey = `order:${orderId}:claimed_by`;

  //   const claimed = await this.redis.eval(
  //     CLAIM_SCRIPT,
  //     2,
  //     pendingKey,
  //     claimKey,
  //     driverId,
  //   );
  //   if (!claimed) {
  //     this.logger.warn(
  //       `Driver ${driverId} tried to claim already assigned order ${orderId}`,
  //     );
  //     return false;
  //   }

  //   try {
  //     await this.prisma.$transaction(async (tx) => {
  //       // Update assignment record
  //       await tx.driverAssignment.update({
  //         where: { orderId },
  //         data: {
  //           driverId,
  //           assignmentStatus: AssignmentStatus.ASSIGNED,
  //           assignedAt: new Date(),
  //         },
  //       });

  //       // Update order status (transition is handled via OrderStatusService later, but we update directly for consistency)
  //       // await tx.order.update({
  //       //   where: { id: orderId },
  //       //   data: {
  //       //     orderStatus: OrderStatus.ORDER_ASSIGNED,
  //       //     assignedDriverId: driverId,
  //       //   },
  //       // });

  //       // Update order status (transition is handled via OrderStatusService later, but we update directly for consistency)
  //       await tx.order.update({
  //         where: { id: orderId },
  //         data: { orderStatus: OrderStatus.ORDER_ASSIGNED }, // ✅ removed assignedDriverId
  //       });

  //       // Mark driver as busy
  //       await tx.driverProfile.update({
  //         where: { userId: driverId },
  //         data: { status: DriverStatus.BUSY },
  //       });

  //       // Log activity
  //       await tx.orderActivityLog.create({
  //         data: {
  //           orderId,
  //           actorId: driverId,
  //           actorRole: Role.DISPATCHER,
  //           action: 'DRIVER_ACCEPTED',
  //           toStatus: OrderStatus.ORDER_ASSIGNED,
  //         },
  //       });
  //     });

  //     // Cancel the timeout job
  //     await this.assignmentQueue.remove(`timeout-${orderId}`);

  //     // Start ETA & navigation
  //     await this.startEtaAndNavigation(orderId, driverId);

  //     this.logger.log(
  //       `Driver ${driverId} successfully assigned to order ${orderId}`,
  //     );
  //     return true;
  //   } catch (error) {
  //     this.logger.error(
  //       `Database transaction failed for driver ${driverId} on order ${orderId}`,
  //       error.stack,
  //     );
  //     // Release the claim in Redis? Not needed – the order is now in inconsistent state.
  //     // Better to delete the claim key so that another driver can try.
  //     await this.redis.del(claimKey);
  //     throw error;
  //   }
  // }

  // private async startEtaAndNavigation(orderId: string, driverId: string) {
  //   try {
  //     // Fetch order details with driver, store, and customer location
  //     const order = await this.prisma.order.findUnique({
  //       where: { id: orderId },
  //       include: {
  //         items: {
  //           include: { store: true },
  //         },
  //       },
  //     });
  //     if (!order) throw new Error('Order not found');

  //     const driver = await this.prisma.driverProfile.findUnique({
  //       where: { userId: driverId },
  //     });
  //     if (!driver || !driver.latitude || !driver.longitude) {
  //       throw new Error('Driver location not available');
  //     }

  //     // Get vendor location from first store (or from order.pickupLocation)
  //     const store = order.items[0]?.store;
  //     // const vendorLat =
  //     //    store?.latitude ?? JSON.parse(order.pickupLocation || '{}').lat;
  //     // const vendorLng =
  //     //   store?.longitude ?? JSON.parse(order.pickupLocation || '{}').lng;
  //     const pickupLocation = order.pickupLocation as any;

  //     const vendorLat =
  //       store?.latitude ?? pickupLocation?.latitude ?? pickupLocation?.lat;

  //     const vendorLng =
  //       store?.longitude ?? pickupLocation?.longitude ?? pickupLocation?.lng;

  //     if (!vendorLat || !vendorLng) {
  //       throw new Error('Vendor location not available');
  //     }

  //     // Leg 1: Driver → Vendor
  //     const etaToVendor = await this.calculateEta(
  //       { lat: driver.latitude, lng: driver.longitude },
  //       { lat: vendorLat, lng: vendorLng },
  //     );

  //     // Emit initial ETA via WebSocket
  //     await this.mapGateway.emitEta(orderId, etaToVendor, 'to-vendor');
  //     await this.mapGateway.emitDriverLocation(orderId, {
  //       lat: driver.latitude,
  //       lng: driver.longitude,
  //       heading: 0,
  //     });

  //     // Start periodic driver location polling (e.g., every 5 seconds)
  //     // This would be handled by a separate process (e.g., driver sends location updates via WebSocket)
  //     // We'll just set up a one-time event to switch leg when pickup is confirmed.

  //     // Store leg state in Redis for later use
  //     await this.redis.setex(`order:${orderId}:leg`, 3600, 'to-vendor');

  //     this.logger.log(
  //       `ETA & navigation started for order ${orderId}, leg to vendor: ${etaToVendor}s`,
  //     );
  //   } catch (error) {
  //     this.logger.error(
  //       `Failed to start ETA/navigation for order ${orderId}`,
  //       error.stack,
  //     );
  //     // Fallback: still notify vendor/customer via push?
  //     await this.sendGenericAlert(
  //       orderId,
  //       'Navigation temporarily unavailable',
  //     );
  //   }
  // }

  // async switchToCustomerLeg(orderId: string, driverId: string) {
  //   // Called after driver confirms pickup (PICKED_UP status)
  //   const order = await this.prisma.order.findUnique({
  //     where: { id: orderId },
  //   });
  //   if (!order) return;

  //   const dropoff = order.dropoffLocation as any;
  //   if (!dropoff?.lat || !dropoff?.lng) {
  //     this.logger.error(`No dropoff location for order ${orderId}`);
  //     return;
  //   }

  //   const driver = await this.prisma.driverProfile.findUnique({
  //     where: { userId: driverId },
  //   });
  //   if (!driver?.latitude || !driver?.longitude) return;

  //   const etaToCustomer = await this.calculateEta(
  //     { lat: driver.latitude, lng: driver.longitude },
  //     { lat: dropoff.lat, lng: dropoff.lng },
  //   );

  //   await this.mapGateway.emitEta(orderId, etaToCustomer, 'to-customer');
  //   await this.redis.setex(`order:${orderId}:leg`, 3600, 'to-customer');
  //   this.logger.log(
  //     `Switched to customer leg for order ${orderId}, ETA: ${etaToCustomer}s`,
  //   );
  // }

  // private async calculateEta(
  //   origin: { lat: number; lng: number },
  //   destination: { lat: number; lng: number },
  // ): Promise<number> {
  //   if (!this.googleMapsApiKey) {
  //     // Fallback: simple Euclidean distance approximation (km) * 2 min per km
  //     const R = 6371; // km
  //     const dLat = ((destination.lat - origin.lat) * Math.PI) / 180;
  //     const dLng = ((destination.lng - origin.lng) * Math.PI) / 180;
  //     const a =
  //       Math.sin(dLat / 2) * Math.sin(dLat / 2) +
  //       Math.cos((origin.lat * Math.PI) / 180) *
  //         Math.cos((destination.lat * Math.PI) / 180) *
  //         Math.sin(dLng / 2) *
  //         Math.sin(dLng / 2);
  //     const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  //     const distanceKm = R * c;
  //     return Math.round(distanceKm * 120); // 2 min per km => seconds
  //   }

  //   try {
  //     const response = await axios.get(
  //       'https://maps.googleapis.com/maps/api/distancematrix/json',
  //       {
  //         params: {
  //           origins: `${origin.lat},${origin.lng}`,
  //           destinations: `${destination.lat},${destination.lng}`,
  //           key: this.googleMapsApiKey,
  //           units: 'metric',
  //         },
  //         timeout: 5000,
  //       },
  //     );
  //     const element = response.data.rows[0]?.elements[0];
  //     if (element?.status === 'OK') {
  //       return element.duration.value; // seconds
  //     }
  //     throw new Error(`Google Maps returned status: ${element?.status}`);
  //   } catch (error) {
  //     this.logger.warn(`ETA calculation failed, using fallback`, error.message);
  //     // Fallback to simple straight‑line estimate (60 km/h)
  //     const dx =
  //       (destination.lng - origin.lng) *
  //       111320 *
  //       Math.cos((origin.lat * Math.PI) / 180);
  //     const dy = (destination.lat - origin.lat) * 110574;
  //     const distanceMeters = Math.sqrt(dx * dx + dy * dy);
  //     return Math.round(distanceMeters / 16.667); // 16.667 m/s = 60 km/h
  //   }
  // }

  // async handleNoDrivers(orderId: string) {
  //   this.logger.warn(`No drivers found for order ${orderId}`);

  //   await this.prisma.$transaction(async (tx) => {
  //     await tx.driverAssignment.update({
  //       where: { orderId },
  //       data: { assignmentStatus: AssignmentStatus.FAILED },
  //     });

  //     // Optional: Cancel order or put on hold
  //     // await this.orderStatusService.transition(orderId, OrderStatus.CANCELLED, {
  //     //   actorId: 'system',
  //     //   reason: 'No available drivers',
  //     // });

  //     // Log activity
  //     await tx.orderActivityLog.create({
  //       data: {
  //         orderId,
  //         actorId: 'system',
  //         action: 'NO_DRIVERS_FOUND',
  //         metadata: { timestamp: new Date().toISOString() },
  //       },
  //     });
  //   });

  //   // Notify dispatcher/admin (e.g., via email or internal dashboard)
  //   await this.notifyDispatcherNoDrivers(orderId);

  //   // Optionally retry after a delay (e.g., expand radius and reschedule)
  //   await this.assignmentQueue.add(
  //     'retry-driver-search',
  //     { orderId, radius: 10000 }, // 10 km
  //     { delay: 30000, jobId: `retry-${orderId}`, attempts: 2 },
  //   );
  // }

  // /**
  //  * Notify all admins/dispatchers that no driver is available for an order.
  //  * Sends email + creates in‑app notification.
  //  */
  // async notifyDispatcherNoDrivers(orderId: string): Promise<void> {
  //   try {
  //     // Fetch order details for context
  //     const order = await this.prisma.order.findUnique({
  //       where: { id: orderId },
  //       select: { orderNumber: true, totalAmount: true, userId: true },
  //     });
  //     if (!order) {
  //       this.logger.warn(
  //         `Order ${orderId} not found when notifying dispatchers`,
  //       );
  //       return;
  //     }

  //     // Fetch all users with role ADMIN or DISPATCHER
  //     const dispatchers = await this.prisma.user.findMany({
  //       where: { role: { in: [Role.ADMIN, Role.DISPATCHER] }, isActive: true },
  //       select: { id: true, email: true, firstName: true },
  //     });

  //     if (dispatchers.length === 0) {
  //       this.logger.warn(
  //         `No active admin/dispatcher users found for order ${orderId}`,
  //       );
  //       return;
  //     }

  //     // Create a database notification for each dispatcher
  //     const notificationPromises = dispatchers.map((dispatcher) =>
  //       this.prisma.notification.create({
  //         data: {
  //           userId: dispatcher.id,
  //           type: NotificationType.DRIVER_ASSIGNMENT,
  //           title: 'No Driver Available',
  //           body: `Order #${order.orderNumber} (₦${order.totalAmount}) has no nearby drivers. Please take action.`,
  //           data: {
  //             orderId,
  //             orderNumber: order.orderNumber,
  //             type: 'no_drivers',
  //           },
  //         },
  //       }),
  //     );

  //     // Send email to each dispatcher
  //     const emailPromises = dispatchers.map((dispatcher) =>
  //       this.zohoEmailProvider.sendEmail(
  //         dispatcher.email,
  //         'Urgent: No Driver Available for Order',
  //         `
  //           <h2>No Driver Found</h2>
  //           <p>Order #${order.orderNumber} (Amount: ₦${order.totalAmount}) has no available drivers within the search radius.</p>
  //           <p>Please log in to the admin dashboard to manually assign a driver or expand the search area.</p>
  //           <a href="${process.env.ADMIN_PANEL_URL}/orders/${orderId}">View Order</a>
  //         `,
  //       ),
  //     );

  //     await Promise.all([...notificationPromises, ...emailPromises]);

  //     // Optional: Send a WebSocket event to all connected admin/dispatcher clients
  //     // (if you have an admin gateway)
  //     // await this.adminGateway.emitNoDriversAlert(orderId, order.orderNumber);

  //     this.logger.log(
  //       `Notified ${dispatchers.length} dispatchers about order ${orderId} having no drivers`,
  //     );
  //   } catch (error) {
  //     this.logger.error(
  //       `Failed to notify dispatchers for order ${orderId}`,
  //       error.stack,
  //     );
  //     // Do not throw – non‑critical failure
  //   }
  // }

  // /**
  //  * Send a generic alert to both vendor and customer (and optionally dispatcher).
  //  * Used for fallback messages like "Navigation temporarily unavailable".
  //  */
  // async sendGenericAlert(orderId: string, message: string): Promise<void> {
  //   try {
  //     // Fetch order details with vendor and customer
  //     const order = await this.prisma.order.findUnique({
  //       where: { id: orderId },
  //       include: {
  //         items: { include: { store: { select: { userId: true } } } },
  //         user: { select: { id: true, email: true, firstName: true } },
  //       },
  //     });
  //     if (!order) {
  //       this.logger.warn(`Order ${orderId} not found for generic alert`);
  //       return;
  //     }

  //     // Get vendor IDs (unique stores)
  //     const vendorIds = [
  //       ...new Set(
  //         order.items.map((item) => item.store?.userId).filter(Boolean),
  //       ),
  //     ];

  //     // Prepare notification data
  //     const notificationData = {
  //       orderId,
  //       orderNumber: order.orderNumber,
  //       alertMessage: message,
  //     };

  //     // 1. Create in‑app notifications for customer
  //     if (order.user?.id) {
  //       await this.prisma.notification.create({
  //         data: {
  //           userId: order.user.id,
  //           type: NotificationType.ORDER_STATUS,
  //           title: 'Order Alert',
  //           body: message,
  //           data: notificationData,
  //         },
  //       });
  //     }

  //     // 2. Create in‑app notifications for each vendor
  //     for (const vendorId of vendorIds) {
  //       await this.prisma.notification.create({
  //         data: {
  //           userId: vendorId,
  //           type: NotificationType.ORDER_STATUS,
  //           title: 'Order Alert',
  //           body: message,
  //           data: notificationData,
  //         },
  //       });
  //     }

  //     // 3. Send real‑time WebSocket events (if gateways are available)
  //     if (order.user?.id) {
  //       // Assuming you have a customer gateway
  //       // await this.customerGateway.sendAlert(order.user.id, message);
  //     }
  //     for (const vendorId of vendorIds) {
  //       this.vendorNotificationGateway.sendToVendor(vendorId, 'order-alert', {
  //         orderId,
  //         message,
  //       });
  //     }

  //     // 4. Optionally also send email for critical alerts (e.g., navigation failure)
  //     const isCritical =
  //       message.toLowerCase().includes('unavailable') ||
  //       message.toLowerCase().includes('failed');
  //     if (isCritical) {
  //       // Send email to customer
  //       if (order.user?.email) {
  //         await this.zohoEmailProvider.sendEmail(
  //           order.user.email,
  //           `Order #${order.orderNumber} Alert`,
  //           `<p>${message}</p><p>We are working to resolve the issue. Please check the app for updates.</p>`,
  //         );
  //       }
  //       // Send email to vendors
  //       for (const vendorId of vendorIds) {
  //         const vendor = await this.prisma.user.findUnique({
  //           where: { id: vendorId },
  //           select: { email: true },
  //         });
  //         if (vendor?.email) {
  //           await this.zohoEmailProvider.sendEmail(
  //             vendor.email,
  //             `Order #${order.orderNumber} Alert`,
  //             `<p>${message}</p><p>Please monitor the order in your vendor portal.</p>`,
  //           );
  //         }
  //       }
  //     }

  //     this.logger.log(`Generic alert sent for order ${orderId}: "${message}"`);
  //   } catch (error) {
  //     this.logger.error(
  //       `Failed to send generic alert for order ${orderId}`,
  //       error.stack,
  //     );
  //     // Swallow – non‑critical
  //   }
  // }

  // // /**
  // //  * Send order cancelled notification to customer (used in vendor decline flow).
  // //  */
  // // async sendOrderCancelled(
  // //   customerId: string,
  // //   orderNumber: string,
  // //   reason?: string,
  // // ): Promise<void> {
  // //   try {
  // //     const body = reason
  // //       ? `Your order #${orderNumber} has been cancelled by the vendor. Reason: ${reason}`
  // //       : `Your order #${orderNumber} has been cancelled.`;

  // //     await this.prisma.notification.create({
  // //       data: {
  // //         userId: customerId,
  // //         type: NotificationType.ORDER_STATUS,
  // //         title: 'Order Cancelled',
  // //         body,
  // //         data: { orderNumber, reason },
  // //       },
  // //     });

  // //     // Send email
  // //     const user = await this.prisma.user.findUnique({
  // //       where: { id: customerId },
  // //       select: { email: true },
  // //     });
  // //     if (user?.email) {
  // //       await this.zohoEmailProvider.sendEmail(
  // //         user.email,
  // //         `Order #${orderNumber} Cancelled`,
  // //         `<p>${body}</p><p>If you have any questions, please contact support.</p>`,
  // //       );
  // //     }
  // //   } catch (error) {
  // //     this.logger.error(
  // //       `Failed to send order cancelled notification for order ${orderNumber}`,
  // //       error.stack,
  // //     );
  // //   }
  // // }

  // /**
  //  * Notify driver about a new delivery request (push + in-app).
  //  * Called from DriverNotificationProcessor.
  //  */
  // async sendDriverPickupAlert(
  //   driverId: string,
  //   orderId: string,
  //   vendorLocation: any,
  // ): Promise<void> {
  //   try {
  //     const order = await this.prisma.order.findUnique({
  //       where: { id: orderId },
  //       select: { orderNumber: true, pickupLocation: true },
  //     });
  //     if (!order) return;

  //     await this.prisma.notification.create({
  //       data: {
  //         userId: driverId,
  //         type: NotificationType.DRIVER_ASSIGNMENT,
  //         title: 'New Delivery Request',
  //         body: `Order #${order.orderNumber} - Tap to accept or decline`,
  //         data: { orderId, vendorLocation, orderNumber: order.orderNumber },
  //       },
  //     });

  //     // Push notification (FCM/APNS) – integrate with your push service
  //     // await this.pushService.sendToDriver(driverId, { title: 'New Order', body: '...' });
  //   } catch (error) {
  //     this.logger.error(
  //       `Failed to send driver pickup alert for order ${orderId}`,
  //       error.stack,
  //     );
  //   }
  // }

  // /**
  //  * Notify vendor that a new order has been placed.
  //  */
  // async sendVendorOrderPlaced(
  //   vendorId: string,
  //   orderId: string,
  //   orderNumber: string,
  // ): Promise<void> {
  //   await this.prisma.notification.create({
  //     data: {
  //       userId: vendorId,
  //       type: NotificationType.VENDOR_ACTION_REQUIRED,
  //       title: 'New Order',
  //       body: `Order #${orderNumber} requires your action`,
  //       data: { orderId, orderNumber },
  //     },
  //   });
  //   this.vendorNotificationGateway.sendToVendor(vendorId, 'order-placed', {
  //     orderId,
  //     orderNumber,
  //   });
  // }

  // // async initiateDriverSearch(
  // //   orderId: string,
  // //   vendorLocation: { lat: number; lng: number },
  // // ) {
  // //   // Create assignment record
  // //   const assignment = await this.prisma.driverAssignment.create({
  // //     data: { orderId, assignmentStatus: AssignmentStatus.PENDING },
  // //   });

  // //   // Enqueue the search job
  // //   await this.assignmentQueue.add(
  // //     'search-and-notify',
  // //     { orderId, assignmentId: assignment.id, vendorLocation },
  // //     { attempts: 3, backoff: 'exponential' as any },
  // //   );
  // // }

  // // // async findAndNotifyDrivers(
  // // //   orderId: string,
  // // //   vendorLocation: { lat: number; lng: number },
  // // // ) {
  // // //   // 1. Find nearby online drivers (Redis GEORADIUS)
  // // //   const drivers = await this.getNearbyDrivers(
  // // //     vendorLocation.lat,
  // // //     vendorLocation.lng,
  // // //     5000,
  // // //   )// 5km radius
  // // //   if (drivers.length === 0) {
  // // //     await this.handleNoDrivers(orderId);
  // // //     return;
  // // //   }

  // // //   // 2. Store pending order in Redis with 60s TTL
  // // //   const pendingKey = `order:${orderId}:pending`;
  // // //   await this.redis.setex(pendingKey, 60, 'awaiting_driver');

  // // //   // 3. Send push notifications to each driver
  // // //   for (const driver of drivers) {
  // // //     await this.notificationQueue.add(
  // // //       'notify-driver',
  // // //       { driverId: driver.userId, orderId, vendorLocation, pendingKey },
  // // //       { jobId: `notify-${orderId}-${driver.userId}` },
  // // //     );
  // // //   }

  // // //   // 4. Schedule timeout job (60s)
  // // //   await this.assignmentQueue.add(
  // // //     'assignment-timeout',
  // // //     { orderId, pendingKey },
  // // //     { delay: 60000, jobId: `timeout-${orderId}` },
  // // //   );
  // // // }

  // // async findAndNotifyDrivers(
  // //   orderId: string,
  // //   vendorLocation: { lat: number; lng: number },
  // // ) {
  // //   const drivers: NearbyDriver[] = await this.getNearbyDrivers(
  // //     vendorLocation.lat,
  // //     vendorLocation.lng,
  // //     5000,
  // //   );

  // //   if (drivers.length === 0) {
  // //     await this.handleNoDrivers(orderId);
  // //     return;
  // //   }

  // //   const pendingKey = `order:${orderId}:pending`;

  // //   await this.redis.setex(pendingKey, 60, 'awaiting_driver');

  // //   for (const driver of drivers) {
  // //     await this.notificationQueue.add(
  // //       'notify-driver',
  // //       {
  // //         driverId: driver.userId,
  // //         orderId,
  // //         vendorLocation,
  // //         pendingKey,
  // //       },
  // //       {
  // //         jobId: `notify-${orderId}-${driver.userId}`,
  // //       },
  // //     );
  // //   }

  // //   await this.assignmentQueue.add(
  // //     'assignment-timeout',
  // //     { orderId, pendingKey },
  // //     {
  // //       delay: 60000,
  // //       jobId: `timeout-${orderId}`,
  // //     },
  // //   );
  // // }

  // // private async getNearbyDrivers(
  // //   lat: number,
  // //   lng: number,
  // //   radiusMeters: number,
  // // ): Promise<NearbyDriver[]> {
  // //   return this.prisma.$queryRaw<NearbyDriver[]>`
  // //   SELECT
  // //     dp.user_id AS "userId",
  // //     dp.latitude AS "lat",
  // //     dp.longitude AS "lng"
  // //   FROM driver_profiles dp
  // //   WHERE dp.status = 'ONLINE'
  // //     AND earth_distance(
  // //       ll_to_earth(${lat}, ${lng}),
  // //       ll_to_earth(dp.latitude, dp.longitude)
  // //     ) <= ${radiusMeters}
  // //   ORDER BY earth_distance(
  // //     ll_to_earth(${lat}, ${lng}),
  // //     ll_to_earth(dp.latitude, dp.longitude)
  // //   ) ASC
  // //   LIMIT 10
  // // `;
  // // }

  // // // private async getNearbyDrivers(
  // // //   lat: number,
  // // //   lng: number,
  // // //   radiusMeters: number,
  // // // ) {
  // // //   // Option A: Use Redis GEORADIUS (drivers' locations must be stored in Redis sorted set)
  // // //   // Assume key "drivers:online" with member = userId, score = geohash.
  // // //   // If not, fallback to PostgreSQL with PostGIS.
  // // //   // Here we'll use raw SQL with PostGIS if available, otherwise implement Redis variant.
  // // //   // For brevity, using Prisma raw query with PostGIS (ll_to_earth extension):
  // // //   return this.prisma.$queryRaw`
  // // //     SELECT dp.user_id, dp.latitude, dp.longitude
  // // //     FROM driver_profiles dp
  // // //     WHERE dp.status = 'ONLINE'
  // // //       AND earth_distance(ll_to_earth(${lat}, ${lng}), ll_to_earth(dp.latitude, dp.longitude)) <= ${radiusMeters}
  // // //     ORDER BY earth_distance(...) ASC
  // // //     LIMIT 10
  // // //   `;
  // // // }

  // // // async driverAcceptsold(orderId: string, driverId: string): Promise<boolean> {
  // // //   const pendingKey = `order:${orderId}:pending`;
  // // //   const claimKey = `order:${orderId}:claimed_by`;

  // // //   // Lua script for atomic claim
  // // //   const script = `
  // // //     if redis.call('EXISTS', KEYS[1]) == 1 and redis.call('SETNX', KEYS[2], ARGV[1]) == 1 then
  // // //       redis.call('DEL', KEYS[1])
  // // //       return 1
  // // //     else
  // // //       return 0
  // // //     end
  // // //   `;
  // // //   const claimed = await this.redis.eval(
  // // //     script,
  // // //     2,
  // // //     pendingKey,
  // // //     claimKey,
  // // //     driverId,
  // // //   );
  // // //   if (!claimed) return false;

  // // //   // Update database
  // // //   await this.prisma.$transaction(async (tx) => {
  // // //     await tx.driverAssignment.update({
  // // //       where: { orderId },
  // // //       data: {
  // // //         driverId,
  // // //         assignmentStatus: AssignmentStatus.ASSIGNED,
  // // //         assignedAt: new Date(),
  // // //       },
  // // //     });
  // // //     await tx.order.update({
  // // //       where: { id: orderId },
  // // //       data: {
  // // //         assignedDriverId: driverId,
  // // //         orderStatus: OrderStatus.ORDER_ASSIGNED,
  // // //       },
  // // //     });
  // // //     await tx.driverProfile.update({
  // // //       where: { userId: driverId },
  // // //       data: { status: DriverStatus.BUSY },
  // // //     });
  // // //     await tx.orderActivityLog.create({
  // // //       data: {
  // // //         orderId,
  // // //         actorId: driverId,
  // // //         actorRole: Role.DISPATCHER,
  // // //         action: 'DRIVER_ACCEPTED',
  // // //         toStatus: OrderStatus.ORDER_ASSIGNED,
  // // //       },
  // // //     });
  // // //   });

  // // //   // Cancel timeout job
  // // //   await this.assignmentQueue.remove(`timeout-${orderId}`);
  // // //   // Trigger navigation/ETA
  // // //   await this.startEtaAndNavigation(orderId, driverId);
  // // //   return true;
  // // // }

  // // async driverAccepts(orderId: string, driverId: string): Promise<boolean> {
  // //   const pendingKey = `order:${orderId}:pending`;
  // //   const claimKey = `order:${orderId}:claimed_by`;

  // //   const script = `...`; // same Lua script

  // //   const claimed = await this.redis.eval(
  // //     script,
  // //     2,
  // //     pendingKey,
  // //     claimKey,
  // //     driverId,
  // //   );
  // //   if (!claimed) return false;

  // //   await this.prisma.$transaction(async (tx) => {
  // //     await tx.driverAssignment.update({
  // //       where: { orderId },
  // //       data: {
  // //         driverId,
  // //         assignmentStatus: AssignmentStatus.ASSIGNED,
  // //         assignedAt: new Date(),
  // //       },
  // //     });
  // //     await tx.order.update({
  // //       where: { id: orderId },
  // //       data: { orderStatus: OrderStatus.ORDER_ASSIGNED }, // ✅ removed assignedDriverId
  // //     });
  // //     await tx.driverProfile.update({
  // //       where: { userId: driverId },
  // //       data: { status: DriverStatus.BUSY },
  // //     });
  // //     await tx.orderActivityLog.create({
  // //       data: {
  // //         orderId,
  // //         actorId: driverId,
  // //         actorRole: Role.DISPATCHER,
  // //         action: 'DRIVER_ACCEPTED',
  // //         toStatus: OrderStatus.ORDER_ASSIGNED,
  // //       },
  // //     });
  // //   });

  // //   await this.assignmentQueue.remove(`timeout-${orderId}`);
  // //   await this.startEtaAndNavigation(orderId, driverId);
  // //   return true;
  // // }

  // // private async startEtaAndNavigation(orderId: string, driverId: string) {
  // //   // Emit WebSocket event to vendor & customer (see MapGateway below)
  // //   // Implementation will be called after assignment
  // // }

  // // private async handleNoDrivers(orderId: string) {
  // //   this.logger.warn(`No drivers found for order ${orderId}`);
  // //   await this.prisma.driverAssignment.update({
  // //     where: { orderId },
  // //     data: { assignmentStatus: AssignmentStatus.FAILED },
  // //   });
  // //   // Notify admin/dispatcher
  // // }
}
