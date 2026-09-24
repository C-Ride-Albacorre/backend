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
import { OnBoardingStatus, Prisma, Role } from '@prisma/client';
import { DriverOnboardingDto } from './dto/driver-onboarding.dto';
import { AbstractUserRepository } from '../user/repositories/abstract-user.repository';
import { DriverDocumentMetadataDto } from './dto/driver-document-metadata.dto';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../modules/redis/redis.provider';
import { OrderStatus, AssignmentStatus, DriverStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { OrderService } from '../order/order.service';
import { RatingService } from '../rating/rating.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Helper from '../../shared/utils/helpers';

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

  private readonly DEFAULT_RADIUS_KM = 10;
  private readonly MAX_RADIUS_KM = 10;
  private readonly TTL_SECONDS = 300;

  constructor(
    public readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly userRepository: AbstractUserRepository,
    @Inject(REDIS_CLIENT) public redis: Redis,
    private configService: ConfigService,
    @Inject(forwardRef(() => OrderService))
    private readonly orderService: OrderService,
    private readonly ratingService: RatingService,
    @InjectQueue('driver-assignment') private assignmentQueue: Queue,

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


  //////////////DRIVER TRACKING////////////

  /**
   * Find orders available to a driver based on the driver's
   * CURRENT latitude/longitude.
   *
   * IMPORTANT:
   * - Location comes from the current request.
   * - Redis is NOT used to determine geographic eligibility.
   * - An order must be within radiusKm of its pickup store.
   */
  async findAvailableOrders(
    driverId: string,
    driverLat: number,
    driverLng: number,
    radiusKm: number = this.DEFAULT_RADIUS_KM,
  ) {
    console.log(
      `[AVAILABLE ORDERS] driver=${driverId} ` +
      `lat=${driverLat} lng=${driverLng} radius=${radiusKm}km`,
    );

    // ---------------------------------------------------------
    // 1. Validate driver ID
    // ---------------------------------------------------------

    if (!driverId) {
      throw new BadRequestException('Driver ID is required');
    }

    // ---------------------------------------------------------
    // 2. Validate coordinates
    // ---------------------------------------------------------

    if (!this.isValidLatitude(driverLat)) {
      throw new BadRequestException(
        'Invalid driver latitude. Latitude must be between -90 and 90.',
      );
    }

    if (!this.isValidLongitude(driverLng)) {
      throw new BadRequestException(
        'Invalid driver longitude. Longitude must be between -180 and 180.',
      );
    }

    // ---------------------------------------------------------
    // 3. Validate radius
    // ---------------------------------------------------------

    if (
      typeof radiusKm !== 'number' ||
      !Number.isFinite(radiusKm) ||
      radiusKm <= 0
    ) {
      throw new BadRequestException(
        'Invalid radius. Radius must be greater than 0.',
      );
    }

    // Never allow the client/service caller to request
    // a radius greater than the configured maximum.
    const effectiveRadiusKm = Math.min(
      radiusKm,
      this.MAX_RADIUS_KM,
    );

    const radiusMeters = effectiveRadiusKm * 1000;

    // ---------------------------------------------------------
    // 4. Get driver profile
    // ---------------------------------------------------------

    const driverProfile =
      await this.prisma.driverProfile.findUnique({
        where: {
          userId: driverId,
        },
        select: {
          status: true,
        },
      });

    if (!driverProfile) {
      throw new NotFoundException(
        'Driver profile not found',
      );
    }

    // ---------------------------------------------------------
    // 5. Driver must be available
    // ---------------------------------------------------------

    if (
      driverProfile.status === DriverStatus.OFFLINE ||
      driverProfile.status === DriverStatus.BUSY
    ) {
      console.log(
        `[AVAILABLE ORDERS] driver=${driverId} ` +
        `is ${driverProfile.status}; returning []`,
      );

      return [];
    }

    // ---------------------------------------------------------
    // 6. Find geographically eligible orders
    // ---------------------------------------------------------
    //
    // The distance calculation is performed in PostgreSQL.
    //
    // The order is eligible ONLY when:
    //
    // distance(driver -> store) <= effectiveRadiusKm
    //
    // Redis is deliberately NOT involved in this decision.
    //

    const latitudeDelta = effectiveRadiusKm / 111.0;

    const longitudeCos = Math.cos(
      (driverLat * Math.PI) / 180,
    );

    const longitudeDelta =
      longitudeCos > 0.000001
        ? effectiveRadiusKm / (111.0 * longitudeCos)
        : 180;

    const availableOrders =
      await this.prisma.$queryRaw<
        Array<{
          order_id: string;
          order_number: string;
          order_status: string;
          total_amount: number;
          delivery_fee: number;
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
        o."deliveryFee" AS delivery_fee,
        o."pickupLocation" AS pickup_location,
        o."dropoffLocation" AS dropoff_location,
        o."createdAt" AS created_at,

        s.id AS store_id,
        s."storeName" AS store_name,
        s."storeLogo" AS store_logo,
        s.latitude AS store_lat,
        s.longitude AS store_lng,

        (
          6371000 * ACOS(
            LEAST(
              1.0,
              GREATEST(
                -1.0,
                COS(RADIANS(${driverLat}))
                * COS(RADIANS(s.latitude))
                * COS(
                  RADIANS(s.longitude)
                  - RADIANS(${driverLng})
                )
                + SIN(RADIANS(${driverLat}))
                * SIN(RADIANS(s.latitude))
              )
            )
          )
        ) AS distance_meters

      FROM "Order" o

      INNER JOIN "OrderItem" oi
        ON oi."orderId" = o.id

      INNER JOIN "Store" s
        ON s.id = oi."storeId"

      WHERE
        o."orderStatus" = 'ORDER_ACCEPTED'

        AND s.latitude IS NOT NULL
        AND s.longitude IS NOT NULL

        AND s.latitude BETWEEN
          ${driverLat - latitudeDelta}
          AND
          ${driverLat + latitudeDelta}

        AND s.longitude BETWEEN
          ${driverLng - longitudeDelta}
          AND
          ${driverLng + longitudeDelta}
    )

    SELECT
      order_id,
      order_number,
      order_status,
      total_amount,
      delivery_fee,
      pickup_location,
      dropoff_location,
      created_at,
      store_id,
      store_name,
      store_logo,
      store_lat,
      store_lng,
      distance_meters

    FROM order_store_distances

    WHERE distance_meters <= ${radiusMeters}

    ORDER BY distance_meters ASC

    LIMIT 20;
  `;

 

    // ---------------------------------------------------------
    // 7. Defensive server-side verification
    // ---------------------------------------------------------
    //
    // PostgreSQL already filtered the orders.
    //
    // This additional check protects against unexpected
    // floating-point/database issues and makes the geographic
    // rule explicit in application code.
    //

    const geographicallyValidOrders =
      availableOrders.filter((order) => {
        const distance =
          Number(order.distance_meters);

        return (
          Number.isFinite(distance) &&
          distance >= 0 &&
          distance <= radiusMeters
        );
      });

    console.log(
      `[AVAILABLE ORDERS] driver=${driverId} ` +
      `found=${geographicallyValidOrders.length}`,
    );

    // Useful while debugging location problems.
    for (const order of geographicallyValidOrders) {
      console.log(
        `[AVAILABLE ORDER] ` +
        `driver=${driverId} ` +
        `order=${order.order_id} ` +
        `store=${order.store_id} ` +
        `storeLocation=(${order.store_lat}, ${order.store_lng}) ` +
        `distance=${order.distance_meters}m`,
      );
    }

    if (!geographicallyValidOrders.length) {
      return [];
    }

    // ---------------------------------------------------------
    // 8. Renew ONLY existing pending keys
    // ---------------------------------------------------------
    //
    // IMPORTANT:
    //
    // Redis is NOT used to decide whether an order is within
    // range.
    //
    // It is only used to maintain an existing pending/claim
    // relationship.
    //
    // EXPIRE on a non-existent key does nothing.
    //
    // Therefore we first check the keys before renewing them.
    //

    const pipeline =
      this.redis.pipeline();

    for (const order of geographicallyValidOrders) {
      const pendingKey =
        `order:${order.order_id}:pending:${driverId}`;

      const driverPendingSet =
        `driver:${driverId}:pending_claims`;

      pipeline.exists(pendingKey);
    }

    const existsResults =
      await pipeline.exec();

    const renewPipeline =
      this.redis.pipeline();

    geographicallyValidOrders.forEach(
      (order, index) => {
        const existsResult =
          existsResults?.[index];

        const exists =
          Array.isArray(existsResult)
            ? Number(existsResult[1]) === 1
            : false;

        if (!exists) {
          return;
        }

        const pendingKey =
          `order:${order.order_id}:pending:${driverId}`;

        renewPipeline.expire(
          pendingKey,
          this.TTL_SECONDS,
        );
      },
    );

    await renewPipeline.exec();

    // ---------------------------------------------------------
    // 9. Get item summaries
    // ---------------------------------------------------------

    const orderIds =
      geographicallyValidOrders.map(
        (order) => order.order_id,
      );

    const itemsSummary =
      await this.getOrderItemsSummary(orderIds);

    // ---------------------------------------------------------
    // 10. Return orders
    // ---------------------------------------------------------

    return geographicallyValidOrders.map(
      (order) => ({
        ...order,

        // Make sure distance is always a number.
        distance_meters: Number(
          order.distance_meters,
        ),

        distance_km:
          Number(order.distance_meters) / 1000,

        items:
          itemsSummary[order.order_id] || [],
      }),
    );
  }



  /**
   * Find available orders within a given radius of a driver's location.
   * Uses PostgreSQL earthdistance module with GiST index for efficient geo‑queries.
   * @param driverLat - Latitude of the driver (WGS84)
   * @param driverLng - Longitude of the driver (WGS84)
   * @param radiusKm - Search radius in kilometers (default 10)
   * @returns List of orders with store details and distance, optionally enriched with items.
   */




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


async declineOrder(
  orderId: string,
  driverId: string,
  reason?: string,
) {
  // Guard against missing IDs
  if (!orderId || !driverId) {
    throw new BadRequestException('orderId and driverId are required');
  }

  const allowedStatuses: OrderStatus[] = [
    OrderStatus.ORDER_ACCEPTED,
    OrderStatus.ORDER_ASSIGNED,
    OrderStatus.PICKED_UP,
  ];

  const result = await this.prisma.$transaction(async (tx) => {
    // 1. Fetch the order and its ID explicitly
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, // ← explicitly select the ID
        orderStatus: true,
        driverAssignment: { select: { driverId: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!allowedStatuses.includes(order.orderStatus)) {
      throw new BadRequestException(
        `Order is in status "${order.orderStatus}" and cannot be declined.`,
      );
    }

    if (
      order.orderStatus === OrderStatus.ORDER_ASSIGNED &&
      order.driverAssignment?.driverId !== driverId
    ) {
      throw new ForbiddenException(
        'This driver is not assigned to this order',
      );
    }

    const previousStatus = order.orderStatus;

    // 2. Update order using the ID from the fetched record
    await tx.order.update({
      where: { id: order.id }, // ← use order.id, not the parameter
      data: { orderStatus: OrderStatus.ORDER_ACCEPTED },
    });

    // 3. Clear driver assignment
    await tx.driverAssignment.updateMany({
      where: { orderId: order.id, driverId },
      data: {
        driverId: null,
        assignmentStatus: 'PENDING',
      },
    });

    // 4. Bring driver back online
    await tx.driverProfile.update({
      where: { userId: driverId },
      data: { status: 'ONLINE' },
    });

    // 5. Log activity
    await tx.orderActivityLog.create({
      data: {
        orderId: order.id,
        actorId: driverId,
        actorRole: Role.DISPATCHER,
        action: 'DRIVER_DECLINED',
        reason: reason || 'No reason provided',
        metadata: { previousStatus, timestamp: new Date().toISOString() },
      },
    });

    return { orderId: order.id, driverId, previousStatus };
  });

  // --- Redis cleanup (unchanged, but wrap in try/catch) ---
  try {
    const redis = this.redis;
    if (redis) {
      await redis.srem(`order:${result.orderId}:candidates`, driverId);
      const assignedKey = `order:${result.orderId}:driver`;
      const current = await redis.get(assignedKey);
      if (current === driverId) await redis.del(assignedKey);
      await redis.del(`driver:${driverId}:active_order`);
    }

    await this.assignmentQueue
      .removeJobScheduler(`eta-${result.orderId}`)
      .catch((err) => this.logger.warn(`Failed to remove ETA scheduler`, err));

    this.logger.log(
      `Driver ${driverId} declined order ${result.orderId} from ${result.previousStatus}`,
    );
  } catch (redisErr) {
    this.logger.error(`Redis cleanup failed for order ${result.orderId}`, redisErr);
  }

  return { success: true, orderId: result.orderId };
}

  async declineOrderNew(
    orderId: string,
    driverId: string,
    reason?: string,
  ) {
    const allowedStatuses: OrderStatus[] = [
      OrderStatus.ORDER_ACCEPTED,
      OrderStatus.ORDER_ASSIGNED,
      OrderStatus.PICKED_UP,
    ];

    // Execute DB transaction first
    const result = await this.prisma.$transaction(async (tx) => {
      // const order = await tx.order.findUnique({
      //   where: { id: orderId },
      //   select: {
      //     orderStatus: true,
      //     assignedDriverId: true,
      //   },
      // });
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          orderStatus: true,
          driverAssignment: {
            select: {
              driverId: true,
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      // Validate status
      if (!allowedStatuses.includes(order.orderStatus)) {
        throw new BadRequestException(
          `Order is in status "${order.orderStatus}" and cannot be declined.`,
        );
      }

      // Validate driver assignment
      if (
        order.orderStatus === OrderStatus.ORDER_ASSIGNED &&
        order.driverAssignment?.driverId !== driverId
      ) {
        throw new ForbiddenException(
          'This driver is not assigned to this order',
        );
      }

      const previousStatus = order.orderStatus;

      // Put order back into pending pool
      // await tx.order.update({
      //   where: { id: orderId },
      //   data: {
      //     orderStatus: OrderStatus.PENDING,
      //     assignedDriverId: null,
      //   },
      // });
      // Put order back into pending pool
      await tx.order.update({
        where: { id: orderId },
        data: {
          orderStatus: OrderStatus.PENDING,
        },
      });

      // Clear the driver's assignment
      await tx.driverAssignment.updateMany({
        where: {
          orderId,
          driverId,
        },
        data: {
          driverId: null,
          assignmentStatus: 'PENDING',
        },
      });

      // Log decline
      await tx.orderActivityLog.create({
        data: {
          orderId,
          actorId: driverId,
          actorRole: Role.DISPATCHER, // Use this if Role.DRIVER exists
          action: 'DRIVER_DECLINED',
          reason: reason || 'No reason provided',
          metadata: {
            previousStatus,
            timestamp: new Date().toISOString(),
          },
        },
      });

      return {
        orderId,
        driverId,
        previousStatus,
      };
    });

    // --------------------------------------------------
    // DB transaction has successfully committed here
    // --------------------------------------------------

    try {
      const redis = this.redis;

      if (redis) {
        // Remove driver from candidate list
        await redis.srem(
          `order:${orderId}:candidates`,
          driverId,
        );

        // Remove explicit assignment if it belongs to this driver
        const assignedDriverKey = `order:${orderId}:driver`;

        const currentDriver = await redis.get(
          assignedDriverKey,
        );

        if (currentDriver === driverId) {
          await redis.del(assignedDriverKey);
        }

        // Clear driver's active order cache
        await redis.del(
          `driver:${driverId}:active_order`,
        );
      }

      // Stop ETA scheduler
      await this.assignmentQueue
        .removeJobScheduler(`eta-${orderId}`)
        .catch((err) => {
          this.logger.warn(
            `Failed to remove ETA scheduler for ${orderId}`,
            err,
          );
        });

      this.logger.log(
        `Driver ${driverId} declined order ${orderId} ` +
        `from status ${result.previousStatus}, ` +
        `reason: ${reason || 'none'}`,
      );
    } catch (redisErr) {
      // DB is already committed, so don't fail the request
      this.logger.error(
        `Post-decline Redis cleanup failed for order ${orderId}`,
        redisErr,
      );
    }

    return {
      success: true,
      orderId: result.orderId,
    };
  }


  async declineOrderbk(orderId: string, driverId: string, reason?: string) {
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


    // Stop the ETA scheduler for this assignment
    await this.assignmentQueue
      .removeJobScheduler(`eta-${orderId}`)
      .catch(() => null);


    this.logger.log(
      `Driver ${driverId} declined order ${orderId}, reason: ${reason || 'none'}`,
    );
    return { success: true };
  }

  /**
   * Confirm delivery: transition order to DELIVERED, update driver stats,
   * and trigger customer rating request.
   */
  /* =================================================================
  // CONFIRM DELIVERY
  // Post-transition side effects now wrapped in a single transaction,
  // and the driver's earning is credited atomically with them.
  // ================================================================= */
  async confirmDelivery(orderId: string, driverId: string, orderCode: string) {
    // ── Validations ─────────────────────────────────────────────────
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

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        userId: true,
        orderNumber: true,
        orderCode: true,
        items: {
          select: { storeId: true },
          where: { storeId: { not: null } },
        },
      },
    });
    if (!order) throw new BadRequestException('Order not found');
    if (order.orderCode !== orderCode) {
      throw new BadRequestException('Invalid order confirmation code');
    }

    // ── 1. Transition order FIRST (source of truth) ─────────────────
    await this.orderService.transition(orderId, OrderStatus.DELIVERED, {
      actorId: driverId,
      actorRole: Role.DISPATCHER,
      respondedAt: new Date(),
    });

    // ── 2. Atomic side effects ──────────────────────────────────────
    await this.prisma.$transaction(async (tx) => {
      // 2a. Driver profile
      await tx.driverProfile.update({
        where: { userId: driverId },
        data: {
          status: DriverStatus.ONLINE,
          totalDeliveries: { increment: 1 },
        },
      });

      // 2b. Expire the assignment
      await tx.driverAssignment.update({
        where: { orderId },
        data: {
          deliveryConfirmedAt: new Date(),
          assignmentStatus: AssignmentStatus.EXPIRED,
        },
      });

      // 2c. Credit the driver's earning
      await this.creditDriverEarningOnDelivery(tx, orderId, driverId);
    });

    // ── 3. Remove ETA scheduler (idempotent) ────────────────────────
    await this.assignmentQueue
      .removeJobScheduler(`eta-${orderId}`)
      .catch(() => null);

    // ── 4. Rating requests (best-effort) ────────────────────────────
    await this.ratingService
      .createRatingRequest(orderId, order.userId, Role.CUSTOMER, driverId)
      .catch((err) =>
        this.logger.error(
          `Customer rating request failed for order ${orderId}`,
          err,
        ),
      );

    const storeIds = [
      ...new Set(order.items.map((i) => i.storeId).filter(Boolean)),
    ];
    for (const storeId of storeIds) {
      const store = await this.prisma.store.findUnique({
        where: { id: storeId! },
        select: { userId: true },
      });
      if (store?.userId) {
        await this.ratingService
          .createRatingRequest(orderId, store.userId, Role.VENDOR, driverId)
          .catch((err) =>
            this.logger.error(
              `Vendor rating request failed for order ${orderId}, store ${storeId}`,
              err,
            ),
          );
      }
    }

    this.logger.log(`Order ${orderId} delivered by driver ${driverId}`);
    return { success: true, message: 'Order delivered successfully' };
  }


  async getOrderDetailsByCode(code: string, driverId: string) {
    // 1. Find order by orderCode
    const order = await this.prisma.order.findFirst({
      where: { orderCode: code },
      include: {
        user: true,                    // customer
        items: {
          include: {
            store: true,
            variant: true,
            product: {
              include: {
                productImages: true,
              },
            },
          },
        },
        driverAssignment: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found with this code');
    }

    // 2. Verify that the driver is assigned to this order
    const assignment = order.driverAssignment;
    if (!assignment || assignment.driverId !== driverId || assignment.assignmentStatus !== AssignmentStatus.ASSIGNED) {
      throw new ForbiddenException('You are not assigned to this order');
    }

    // 3. Compute totals across all items
    const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = order.items.reduce((sum, item) => sum + item.totalPrice, 0);

    // 4. Build the exact same response shape as getVendorOrderById
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      orderCode: order.orderCode,
      createdAt: order.createdAt,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      deliveryInstructions: order.deliveryInstructions,
      pickupLocation: order.pickupLocation,
      dropoffLocation: order.dropoffLocation,

      user: order.user,

      items: order.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,

        product: item.product
          ? {
            id: item.product.id,
            productName: item.product.productName,
            image: item.product.productImages?.[0]?.imageUrl ?? null,
          }
          : null,

        variant: item.variant,
        store: item.store,
      })),

      // Keep the key name "vendorSummary" for strict compatibility
      vendorSummary: {
        itemCount: order.items.length,
        totalQuantity: totalQuantity,
        subtotal: subtotal,
      },
    };
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

 async creditDriverEarningOnDeliveryold(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      driverAssignment: { select: { driverId: true } },
      deliveryOption: { select: { deliveryCommissionPct: true } },
    },
  });
  if (!order) throw new NotFoundException('Order not found');
  if (!order.driverAssignment?.driverId) return null;   // no driver — nothing to credit
  if (order.deliveryFee <= 0) return null;              // free delivery promo — no split

  // Idempotency
  const existing = await tx.driverEarning.findUnique({ where: { orderId } });
  if (existing) return existing;

  const commissionPct = Number(order.deliveryOption?.deliveryCommissionPct ?? 0);
  const grossAmount = Number(order.deliveryFee);
  const commissionAmount = Helper.round2((grossAmount * commissionPct) / 100);
  const netAmount = Helper.round2(grossAmount - commissionAmount);
  const earnedAt = order.deliveredAt ?? new Date();

  // 1. Create the wallet transaction (PENDING — money is not yet spendable)
  const walletTx = await tx.walletTransaction.create({
    data: {
      walletId: (await tx.wallet.upsert({
        where: { userId: order.driverAssignment.driverId },
        create: { userId: order.driverAssignment.driverId, balance: 0 },
        update: {},
        select: { id: true },
      })).id,
      amount: netAmount,
      type: 'CREDIT',
      reference: `EARN-${order.id}`,
      description: `Earning for order ${order.orderNumber}`,
      status: 'PENDING',
      metadata: { orderId: order.id, driverId: order.driverAssignment.driverId },
    },
  });

  // 2. Create the earning detail row
  const earning = await tx.driverEarning.create({
    data: {
      driverId: order.driverAssignment.driverId,
      orderId: order.id,
      walletTxId: walletTx.id,
      grossAmount: Helper.round2(grossAmount),
      commissionPct,
      commissionAmount,
      netAmount,
      tips: 0,
      bonuses: 0,
      totalAmount: netAmount,
      status: 'EARNED',
      earnedAt,
    },
  });

  this.logger.log(
    `Driver earning created: order=${orderId} driver=${earning.driverId} ` +
      `net=${netAmount} (pct=${commissionPct}) walletTx=${walletTx.id}`,
  );

  return earning;
}

// =================================================================
  // CREDIT DRIVER EARNING — idempotent, called inside confirmDelivery tx
  // Commission % is sourced from VehicleTypeConfig (via deliveryOptionId)
  // and snapshotted onto the earning row.
  // =================================================================
  private async creditDriverEarningOnDelivery(
    tx: Prisma.TransactionClient,
    orderId: string,
    driverId: string,
  ) {
    // 1. Idempotency guard
    const existing = await tx.driverEarning.findUnique({ where: { orderId } });
    if (existing) {
      this.logger.debug(
        `Driver earning already exists for order ${orderId}, skipping`,
      );
      return existing;
    }

    // 2. Load order scalars only
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        deliveryFee: true,
        deliveredAt: true,
        deliveryOptionId: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found for earning');

    // 3. Skip if nothing to credit
    if (order.deliveryFee <= 0) {
      this.logger.warn(
        `Skipping earning for order ${orderId}: deliveryFee=${order.deliveryFee}`,
      );
      return null;
    }

    // 4. Commission % from VehicleTypeConfig
    let commissionPct = 0;
    if (order.deliveryOptionId) {
      const config = await tx.vehicleTypeConfig.findUnique({
        where: { id: order.deliveryOptionId },
        select: { deliveryCommissionPct: true },
      });
      if (config) {
        commissionPct = Number(config.deliveryCommissionPct);
      } else {
        this.logger.warn(
          `No VehicleTypeConfig found for deliveryOptionId=` +
            `${order.deliveryOptionId} on order ${orderId} — using 0% commission`,
        );
      }
    }

    // 5. Split
    const grossAmount = Number(order.deliveryFee);
    const commissionAmount = Helper.round2((grossAmount * commissionPct) / 100);
    const netAmount = Helper.round2(grossAmount - commissionAmount);
    const earnedAt = order.deliveredAt ?? new Date();

    // 6. Wallet
    const wallet = await tx.wallet.upsert({
      where: { userId: driverId },
      create: { userId: driverId, balance: 0, currency: 'NGN' },
      update: {},
      select: { id: true },
    });

    // 7. PENDING wallet credit
    const walletTx = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: netAmount,
        type: 'CREDIT',
        reference: `EARN-${orderId}`,
        description: `Earning for order ${order.orderNumber}`,
        status: 'PENDING',
        metadata: {
          orderId,
          driverId,
          grossAmount,
          commissionPct,
          commissionAmount,
        },
      },
    });

    // 8. Earning detail row
    const earning = await tx.driverEarning.create({
      data: {
        driverId,
        orderId,
        walletTxId: walletTx.id,
        grossAmount: Helper.round2(grossAmount),
        commissionPct,
        commissionAmount,
        netAmount,
        tips: 0,
        bonuses: 0,
        totalAmount: netAmount,
        status: 'EARNED',
        earnedAt,
      },
    });

    this.logger.log(
      `Driver earning created: order=${orderId} driver=${driverId} ` +
        `gross=${grossAmount} pct=${commissionPct} ` +
        `commission=${commissionAmount} net=${netAmount} ` +
        `walletTx=${walletTx.id}`,
    );

    return earning;
  }
}
