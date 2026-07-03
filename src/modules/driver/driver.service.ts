// src/drivers/services/driver-onboarding.service.ts
import {
  Injectable,
  Logger,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { DriverStep2Dto } from './dto/step2-driver.dto';
import { DriverStep3MetadataDto } from './dto/step3-driver.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { UserRole, UserStatus } from '../../shared/enums';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { OnBoardingStatus, Role } from '@prisma/client';
import { DriverOnboardingDto } from './dto/driver-onboarding.dto';
import { AbstractUserRepository } from '../user/repositories/abstract-user.repository';
import { DriverDocumentMetadataDto } from './dto/driver-document-metadata.dto';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../modules/redis/redis.provider';
import { OrderStatus, AssignmentStatus, DriverStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { OrderService } from '../order/order.service';
import { RatingService } from '../rating/rating.service';

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
    private configService: ConfigService,
    @Inject(forwardRef(() => OrderService))
    private readonly orderService: OrderService,
    private readonly ratingService: RatingService,
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
    driverId: string,
    driverLat: number,
    driverLng: number,
    radiusKm: number,
  ) {

    console.log(`Finding orders for driver ${driverId} at (${driverLat}, ${driverLng}) within ${radiusKm} km`);
    if (
      !this.isValidLatitude(driverLat) ||
      !this.isValidLongitude(driverLng)
    ) {
      throw new Error(
        'Invalid driver coordinates. Latitude must be between -90 and 90 and longitude between -180 and 180.',
      );
    }

    const radiusMeters = radiusKm * 1000;
    const TTL_SECONDS = 300; // 5 minutes - match your broadcast TTL

    // 1. Get available orders
    const availableOrders = await this.prisma.$queryRaw<
      Array<{
        order_id: string;
        order_number: string;
        order_status: string;
        total_amount: number;
        pickup_location: any;
        dropoff_location: any;
        created_at: Date;
        store_id: string;
        store_name: string;
        store_logo: string | null;
        store_lat: number;
        store_lng: number;
        distance_meters: number;
      }>
    >`
    WITH order_store_distances AS (
      SELECT
        o.id AS order_id,
        o."orderNumber" AS order_number,
        o."orderStatus" AS order_status,
        o."totalAmount" AS total_amount,
        o."pickupLocation" AS pickup_location,
        o."dropoffLocation" AS dropoff_location,
        o."createdAt" AS created_at,

        s.id AS store_id,
        s."storeName" AS store_name,
        s."storeLogo" AS store_logo,
        s.latitude AS store_lat,
        s.longitude AS store_lng,

        (
          6371000 * acos(
            cos(radians(${driverLat}))
            * cos(radians(s.latitude))
            * cos(radians(s.longitude) - radians(${driverLng}))
            + sin(radians(${driverLat}))
            * sin(radians(s.latitude))
          )
        ) AS distance_meters,

        ROW_NUMBER() OVER (
          PARTITION BY o.id
          ORDER BY (
            6371000 * acos(
              cos(radians(${driverLat}))
              * cos(radians(s.latitude))
              * cos(radians(s.longitude) - radians(${driverLng}))
              + sin(radians(${driverLat}))
              * sin(radians(s.latitude))
            )
          )
        ) AS rn

      FROM "Order" o
      JOIN "OrderItem" oi
        ON oi."orderId" = o.id
      JOIN "Store" s
        ON s.id = oi."storeId"

      WHERE o."orderStatus" = 'ORDER_ACCEPTED'
        AND s.latitude IS NOT NULL
        AND s.longitude IS NOT NULL

        -- Bounding box pre-filter (~10km)
        AND s.latitude BETWEEN ${driverLat - 0.1} AND ${driverLat + 0.1}
        AND s.longitude BETWEEN ${driverLng - 0.1} AND ${driverLng + 0.1}
    )

    SELECT *
    FROM order_store_distances
    WHERE rn = 1
      AND distance_meters <= ${radiusKm * 1000}
    ORDER BY distance_meters ASC
    LIMIT 20;
  `;

    if (!availableOrders.length) {
      return [];
    }

    // 2. Renew TTL for pending keys of this driver
    const pipeline = this.redis.pipeline();

    for (const order of availableOrders) {
      const pendingKey = `order:${order.order_id}:pending:${driverId}`;
      const driverPendingSet = `driver:${driverId}:pending_claims`;

      // Check if the key exists and renew it
      pipeline.expire(pendingKey, TTL_SECONDS);
      // Add to driver's pending set if not already there
      pipeline.sadd(driverPendingSet, order.order_id);
    }

    await pipeline.exec();

    // 3. Get items summary
    const orderIds = availableOrders.map(
      (order) => order.order_id,
    );

    const itemsSummary = await this.getOrderItemsSummary(orderIds);

    return availableOrders.map((order) => ({
      ...order,
      items: itemsSummary[order.order_id] || [],
    }));
  }


  public async getOrderItemsSummary(
    orderIds: string[],
  ): Promise<Record<string, any[]>> {
    const items =
      await this.prisma.orderItem.findMany({
        where: {
          orderId: {
            in: orderIds,
          },
        },
        select: {
          orderId: true,
          quantity: true,
          unitPrice: true,
          productId: true,
        },
      });

    const productIds = [
      ...new Set(
        items
          .map((item) => item.productId)
          .filter(
            (id): id is string =>
              Boolean(id),
          ),
      ),
    ];

    const products =
      productIds.length > 0
        ? await this.prisma.product.findMany({
          where: {
            id: {
              in: productIds,
            },
          },
          select: {
            id: true,
            productName: true,
          },
        })
        : [];

    const productNameById =
      products.reduce(
        (
          acc,
          product,
        ) => {
          acc[product.id] =
            product.productName;
          return acc;
        },
        {} as Record<
          string,
          string
        >,
      );

    const summary: Record<
      string,
      any[]
    > = {};

    for (const item of items) {
      if (
        !summary[item.orderId]
      ) {
        summary[item.orderId] =
          [];
      }

      summary[item.orderId].push({
        productName:
          item.productId
            ? productNameById[
            item.productId
            ] ||
            'Unknown Product'
            : 'Unknown Product',
        quantity:
          item.quantity,
        unitPrice:
          item.unitPrice,
      });
    }

    return summary;
  }

  private isValidLatitude(
    lat: number,
  ): boolean {
    return (
      typeof lat === 'number' &&
      !isNaN(lat) &&
      lat >= -90 &&
      lat <= 90
    );
  }

  private isValidLongitude(
    lng: number,
  ): boolean {
    return (
      typeof lng === 'number' &&
      !isNaN(lng) &&
      lng >= -180 &&
      lng <= 180
    );
  }



  async findAvailableOrdersbk(
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
  // private async getOrderItemsSummary(orderIds: string[]): Promise<Record<string, any[]>> {
  //   const items = await this.prisma.orderItem.findMany({
  //     where: { orderId: { in: orderIds } },
  //     select: {
  //       orderId: true,
  //       quantity: true,
  //       unitPrice: true,
  //       productId: true,
  //     },
  //   });

  //   const productIds = [...new Set(items.map(item => item.productId).filter(Boolean))];
  //   const products = productIds.length
  //     ? await this.prisma.product.findMany({
  //         where: { id: { in: productIds } },
  //         select: {
  //           id: true,
  //           productName: true,
  //         },
  //       })
  //     : [];

  //   const productNameById = products.reduce((acc, product) => {
  //     acc[product.id] = product.productName;
  //     return acc;
  //   }, {} as Record<string, string>);

  //   const summary: Record<number, any[]> = {};
  //   for (const item of items) {
  //     if (!summary[item.orderId]) summary[item.orderId] = [];
  //     summary[item.orderId].push({
  //       productName: item.productId ? productNameById[item.productId] || 'Unknown Product' : 'Unknown Product',
  //       quantity: item.quantity,
  //       unitPrice: item.unitPrice,
  //     });
  //   }
  //   return summary;
  // }

  // // Helper validators
  // private isValidLatitude(lat: number): boolean {
  //   return typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
  // }

  // private isValidLongitude(lng: number): boolean {
  //   return typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180;
  // }


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


  async findAvailableOrder(orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        orderStatus: OrderStatus.ORDER_ACCEPTED,
      },
      include: {
        items: {
          include: {
            store: {
              select: {
                id: true,
                storeName: true,
                storeLogo: true,
                storeAddress: true,
                latitude: true,
                longitude: true,
                phoneNumber: true,
              },
            },
            product: {
              select: {
                id: true,
                productName: true,
                productImages: true,
              },
            },
            package: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const storesMap = new Map();

    order.items.forEach((item) => {
      if (item.store) {
        storesMap.set(item.store.id, {
          id: item.store.id,
          storeName: item.store.storeName,
          storeLogo: item.store.storeLogo,
          storeAddress: item.store.storeAddress,
          latitude: item.store.latitude,
          longitude: item.store.longitude,
          phoneNumber: item.store.phoneNumber,
        });
      }
    });

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      orderCode: order.orderCode,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,

      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      serviceFee: order.serviceFee,
      taxAmount: order.taxAmount,
      totalAmount: order.totalAmount,

      pickupLocation: order.pickupLocation,
      dropoffLocation: order.dropoffLocation,

      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      deliveryInstructions: order.deliveryInstructions,

      createdAt: order.createdAt,

      stores: Array.from(storesMap.values()),

      items: order.items.map((item) => ({
        id: item.id,
        itemType: item.itemType,

        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,

        productId: item.productId,
        productName: item.product?.productName ?? null,

        productImage: item.product?.productImages?.[0] ?? null,

        packageId: item.packageId,
        packageName: item.package?.name ?? null,

        specialInstructions: item.specialInstructions,

        store: item.store
          ? {
            id: item.store.id,
            storeName: item.store.storeName,
            storeLogo: item.store.storeLogo,
          }
          : null,
      })),
    };
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
      respondedAt: new Date()
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
      data: {
        deliveryConfirmedAt: new Date(), assignmentStatus: AssignmentStatus.EXPIRED

      },
    });


    // Fetch order details including its items to know which stores are involved
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        userId: true,          // customer
        orderNumber: true,
        items: {
          select: { storeId: true },
          where: { storeId: { not: null } }, // only items that belong to a store
        },
      },
    });

    if (!order) throw new BadRequestException('Order not found');

    // 1. Customer rating request (always)
    await this.ratingService.createRatingRequest(orderId, order.userId, Role.CUSTOMER, driverId)
      .catch(err => this.logger.error(`Customer rating request failed for order ${orderId}`, err));

    // 2. Vendor rating requests (one per unique store)
    const storeIds = [...new Set(order.items.map(item => item.storeId).filter(Boolean))];
    for (const storeId of storeIds) {
      // Get the store's vendor (user) ID
      const store = await this.prisma.store.findUnique({
        where: { id: storeId! },
        select: { userId: true },
      });
      if (store?.userId) {
        await this.ratingService.createRatingRequest(orderId, store.userId, Role.VENDOR, driverId)
          .catch(err => this.logger.error(`Vendor rating request failed for order ${orderId}, store ${storeId}`, err));
      } else {
        this.logger.warn(`Store ${storeId} not found or has no vendor; skipping vendor rating for order ${orderId}`);
      }
    }

      // Trigger customer rating request (async – fire and forget)
    this.requestCustomerRating(orderId).catch((err) =>
      this.logger.error(`Failed to request rating for order ${orderId}`, err),
    );


    this.logger.log(`Order ${orderId} delivered by driver ${driverId}`);
    return { success: true, message: 'Order delivered successfully' };
  }




  async confirmDeliverybk(orderId: string, driverId: string) {
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
      data: {
        deliveryConfirmedAt: new Date(), assignmentStatus: AssignmentStatus.EXPIRED

      },
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


}
