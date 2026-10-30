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
import { OnBoardingStatus, Prisma, Role, VehicleType } from '@prisma/client';
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
import { QUEUES } from '../../shared/constants';
import { DriverGateway } from '../../common/map-gateway/driver.gateway';
import { DriverAssignmentService } from './driver-assignment.service';

export enum DriverDocumentType {
  DRIVER_LICENSE = 'DRIVER_LICENSE',
  VEHICLE_INSURANCE = 'VEHICLE_INSURANCE',
  VEHICLE_REGISTRATION = 'VEHICLE_REGISTRATION',
}


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
    @InjectQueue(QUEUES.DRIVER_ASSIGNMENT) private assignmentQueue: Queue,
    @Inject(forwardRef(() => DriverGateway))
    public readonly driverGateway: DriverGateway,
    @Inject(forwardRef(() => DriverAssignmentService))
    private readonly driverAssignment: DriverAssignmentService) {
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
        if (!dto.vehicleTypeConfigId) {
          throw new BadRequestException('vehicleTypeConfigId is required');
        }

        const config = await this.prisma.vehicleTypeConfig.findUnique({
          where: { id: dto.vehicleTypeConfigId },
          select: { id: true, isActive: true },
        });

        if (!config || !config.isActive) {
          throw new BadRequestException(
            'Invalid or inactive vehicle type configuration',
          );
        }


        /////
        await this.prisma.driverProfile.update({
          where: { userId: driverId },
          data: {
            //vehicleType: dto.vehicleType!,
            vehicleTypeConfigId: dto.vehicleTypeConfigId!,
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
    const latitudeDelta = effectiveRadiusKm / 111.0;
    const longitudeCos = Math.cos((driverLat * Math.PI) / 180);
    const longitudeDelta =
      longitudeCos > 0.000001
        ? effectiveRadiusKm / (111.0 * longitudeCos)
        : 180;

    const availableOrders = await this.prisma.$queryRaw<any[]>`
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
        o."dispatchRadiusMeters" AS dispatch_radius_meters,
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
                * COS(RADIANS(s.longitude) - RADIANS(${driverLng}))
                + SIN(RADIANS(${driverLat}))
                * SIN(RADIANS(s.latitude))
              )
            )
          )
        ) AS distance_meters
      FROM "Order" o
      INNER JOIN "OrderItem" oi ON oi."orderId" = o.id
      INNER JOIN "Store" s ON s.id = oi."storeId"
      WHERE
        o."orderStatus" = 'ORDER_ACCEPTED' -- NEVER include UNACCEPTED here
        AND o."createdAt" > NOW() - INTERVAL '30 minutes' -- Prevent stale orders
        AND s.latitude IS NOT NULL
        AND s.longitude IS NOT NULL
        AND s.latitude BETWEEN ${driverLat - latitudeDelta} AND ${driverLat + latitudeDelta}
        AND s.longitude BETWEEN ${driverLng - longitudeDelta} AND ${driverLng + longitudeDelta}
    )
    SELECT * FROM order_store_distances
    WHERE distance_meters <= ${radiusMeters}
      AND distance_meters <= COALESCE(dispatch_radius_meters, ${radiusMeters})
    ORDER BY distance_meters ASC
    LIMIT 20;
    `;

    // ---------------------------------------------------------
    // 7. Defensive server-side verification + Declined filter
    // ---------------------------------------------------------
    let declinedSet = new Set<string>();
    try {
      const declined = await this.redis.smembers(`driver:${driverId}:declined`);
      declinedSet = new Set(declined);
    } catch (err) {
      this.logger.warn(`declined-set lookup failed for ${driverId}: ${err}`);
    }

    const geographicallyValidOrders = availableOrders.filter((order) => {
      const distance = Number(order.distance_meters);
      return (
        Number.isFinite(distance) &&
        distance >= 0 &&
        distance <= radiusMeters &&
        !declinedSet.has(order.order_id) // Filter declined
      );
    });

    if (!geographicallyValidOrders.length) {
      return [];
    }

    // ---------------------------------------------------------
    // 8. Claim or renew pending keys (FIXED: handles late acceptance)
    // ---------------------------------------------------------
    const pipeline = this.redis.pipeline();
    for (const order of geographicallyValidOrders) {
      pipeline.exists(`order:${order.order_id}:pending:${driverId}`);
    }
    const existsResults = await pipeline.exec();

    const claimPipeline = this.redis.pipeline();
    const newlyClaimed: string[] = [];

    geographicallyValidOrders.forEach((order, index) => {
      const existsResult = existsResults?.[index];
      const exists = Array.isArray(existsResult) && Number(existsResult[1]) === 1;

      const pendingKey = `order:${order.order_id}:pending:${driverId}`;
      const driverPendingSet = `driver:${driverId}:pending_claims`;
      const orderPendingDrivers = `order:${order.order_id}:pending_drivers`;

      if (exists) {
        claimPipeline.expire(pendingKey, this.TTL_SECONDS);
      } else {
        claimPipeline.setex(pendingKey, this.TTL_SECONDS, 'pending');
        newlyClaimed.push(order.order_id);
      }
      claimPipeline.sadd(driverPendingSet, order.order_id);
      claimPipeline.sadd(orderPendingDrivers, driverId);
    });

    await claimPipeline.exec();

    // Queue timeouts for new claims
    for (const orderId of newlyClaimed) {
      await this.assignmentQueue.add(
        'driver-response-timeout',
        { orderId, driverId },
        {
          delay: this.TTL_SECONDS * 1000,
          jobId: `timeout-${orderId}-${driverId}`,
          removeOnComplete: true,
        }
      ).catch(() => null);
    }

    // ---------------------------------------------------------
    // 9. Get item summaries (FIXED: removed duplicate call)
    // ---------------------------------------------------------
    const orderIds = geographicallyValidOrders.map((o) => o.order_id);
    let itemsSummary: Record<string, any[]> = {};

    try {
      itemsSummary = await this.getOrderItemsSummary(orderIds);
    } catch (error) {
      this.logger.error(`Failed to get order items summary: ${error}`);
    }

    // ---------------------------------------------------------
    // 10. Return orders
    // ---------------------------------------------------------
    return geographicallyValidOrders.map((order) => ({
      ...order,
      distance_meters: Number(order.distance_meters),
      distance_km: Number(order.distance_meters) / 1000,
      items: itemsSummary[order.order_id] || [],
    }));
  }

  async getDriverProfileForSync(driverId: string) {
    return this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: {
        status: true,
        latitude: true,
        longitude: true,
      },
    });
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
    driverId: string,
    orderId: string,
    reason?: string,
  ): Promise<{ success: boolean; note?: string }> {
    if (!orderId || !driverId) {
      throw new BadRequestException('orderId and driverId are required');
    }

    const pendingKey = `order:${orderId}:pending:${driverId}`;
    const driverPendingSet = `driver:${driverId}:pending_claims`;
    const pendingDriversKey = `order:${orderId}:pending_drivers`;

    // 1. Fast atomic claim (idempotency)
    const claimed = await this.redis.del(pendingKey);
    const wasPending = claimed > 0;
    if (wasPending) {
      await this.redis.srem(driverPendingSet, orderId);
      await this.redis.srem(pendingDriversKey, driverId);
    }

    // 2. DB transaction — handle both ORDER_ACCEPTED and ORDER_ASSIGNED
    let result: {
      ok: true;
      outcome: 'CANDIDATE_DECLINED' | 'UNASSIGNED' | 'NO_OP';
      radius?: number;
    };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            orderStatus: true,
            dispatchRadiusMeters: true,
            driverId: true,
          },
        });
        if (!order) throw new NotFoundException('Order not found');

        // ─── Case 1: order is no longer in a state we can act on ───
        if (
          order.orderStatus !== OrderStatus.ORDER_ACCEPTED &&
          order.orderStatus !== OrderStatus.ORDER_ASSIGNED
        ) {
          await tx.orderActivityLog.create({
            data: {
              orderId,
              actorId: driverId,
              actorRole: Role.DISPATCHER,
              action: 'DRIVER_DECLINED',
              reason: reason ?? `Order status ${order.orderStatus}`,
            },
          });
          return { ok: true as const, outcome: 'NO_OP' as const };
        }

        // ─── Case 2: order is ORDER_ASSIGNED ───
        //     This is an "unassign". Only the assigned driver can do this.
        if (order.orderStatus === OrderStatus.ORDER_ASSIGNED) {
          if (order.driverId !== driverId) {
            throw new ForbiddenException(
              `Driver ${driverId} is not assigned to order ${orderId}`,
            );
          }

          // Revert to ORDER_ACCEPTED so it can be re-dispatched.
          await tx.order.update({
            where: { id: orderId },
            data: {
              orderStatus: OrderStatus.ORDER_ACCEPTED,
              driverId: null,
              driverAssignedAt: null,
              statusHistory: {
                push: {
                  status: OrderStatus.ORDER_ACCEPTED,
                  timestamp: new Date().toISOString(),
                  note: 'DRIVER_UNASSIGNED',
                  actorId: driverId,
                  actorRole: Role.DISPATCHER,
                  reason: reason ?? null,
                },
              },
            },
          });

          // Clear the assignment record.
          await tx.driverAssignment.updateMany({
            where: { orderId, driverId },
            data: {
              assignmentStatus: AssignmentStatus.PENDING,
              driverId: null,
              assignedAt: null,
              etaSeconds: null,
            },
          });

          // Driver back to ONLINE.
          await tx.driverProfile.updateMany({
            where: { userId: driverId, status: DriverStatus.BUSY },
            data: { status: DriverStatus.ONLINE },
          });

          await tx.orderActivityLog.create({
            data: {
              orderId,
              actorId: driverId,
              actorRole: Role.DISPATCHER,
              action: 'DRIVER_UNASSIGNED',
              fromStatus: OrderStatus.ORDER_ASSIGNED,
              toStatus: OrderStatus.ORDER_ACCEPTED,
              reason: reason ?? null,
            },
          });

          return {
            ok: true as const,
            outcome: 'UNASSIGNED' as const,
            radius: order.dispatchRadiusMeters ?? undefined,
          };
        }

        // ─── Case 3: order is ORDER_ACCEPTED ───
        //     Driver is only a candidate — nothing to reset in the DB.
        //     The Redis cleanup already happened above.
        await tx.orderActivityLog.create({
          data: {
            orderId,
            actorId: driverId,
            actorRole: Role.DISPATCHER,
            action: 'DRIVER_DECLINED',
            fromStatus: OrderStatus.ORDER_ACCEPTED,
            toStatus: OrderStatus.ORDER_ACCEPTED,
            reason: reason ?? null,
          },
        });

        return {
          ok: true as const,
          outcome: 'CANDIDATE_DECLINED' as const,
          radius: order.dispatchRadiusMeters ?? undefined,
        };
      });
    } catch (err) {
      // Restore Redis claim if we had taken it
      if (wasPending) {
        await this.redis.setex(pendingKey, 300, 'pending').catch(() => { });
        await this.redis.sadd(driverPendingSet, orderId).catch(() => { });
        await this.redis.sadd(pendingDriversKey, driverId).catch(() => { });
      }
      this.logger.error(
        `declineOrder transaction failed for ${orderId}/${driverId}`,
        err,
      );
      throw err;
    }

    // 3. Post-commit: Redis cleanup, ETA cancel, retry wave
    await this.redis.sadd(`driver:${driverId}:declined`, orderId);
    await this.redis.expire(`driver:${driverId}:declined`, 3600);
    await this.assignmentQueue
      .remove(`timeout-${orderId}-${driverId}`)
      .catch(() => { });

    if (result.outcome === 'UNASSIGNED') {
      // Cancel ETA + navigation, then re-dispatch
      await this.driverAssignment
        .removeEtaScheduler(orderId)
        .catch((err) =>
          this.logger.warn(`removeEtaScheduler failed: ${err.message}`),
        );

      await this.redis.del(`order:${orderId}:dispatch_lock`).catch(() => { });
      await this.assignmentQueue
        .remove(`assignment-timeout-${orderId}`)
        .catch(() => { });

      this.logger.log(
        `Driver ${driverId} unassigned from ${orderId}; re-dispatching`,
      );
      await this.assignmentQueue.add(
        'retry-driver-search',
        {
          orderId,
          radius: result.radius ?? 5000,
          attempt: 1,
        },
        {
          delay: 1000,
          jobId: `unassign-retry-${orderId}-${Date.now()}`,
          removeOnComplete: true,
        },
      );
    } else if (result.outcome === 'CANDIDATE_DECLINED') {
      // Only re-dispatch if no one else is pending
      const remaining = await this.redis.scard(pendingDriversKey);
      if (remaining === 0) {
        this.logger.log(
          `Last candidate declined ${orderId}; triggering retry wave`,
        );
        await this.redis.del(`order:${orderId}:dispatch_lock`).catch(() => { });
        await this.assignmentQueue
          .remove(`assignment-timeout-${orderId}`)
          .catch(() => { });
        await this.assignmentQueue.add(
          'retry-driver-search',
          { orderId, radius: result.radius ?? 5000, attempt: 1 },
          {
            delay: 1000,
            jobId: `decline-retry-${orderId}-${Date.now()}`,
            removeOnComplete: true,
          },
        );
      }
    }

    // 4. Always tell the declining driver's UI to drop the order
    this.driverGateway.emitOrderRemoved(driverId, orderId);

    return { success: true };
  }

  async declineOrderold(
    driverId: string,
    orderId: string,
    reason?: string,
  ): Promise<{ success: boolean; note?: string }> {
    if (!orderId || !driverId) {
      throw new BadRequestException('orderId and driverId are required');
    }

    const pendingKey = `order:${orderId}:pending:${driverId}`;
    const driverPendingSet = `driver:${driverId}:pending_claims`;
    const pendingDriversKey = `order:${orderId}:pending_drivers`;  // ← FIXED

    // 1. Fast atomic claim — only one worker wins.
    const claimed = await this.redis.del(pendingKey);
    if (claimed === 0) {
      this.logger.debug(
        `Driver ${driverId} decline for ${orderId}: no pending key; ignoring`,
      );
      return { success: true, note: 'ALREADY_RESOLVED' };
    }

    // 2. DB transaction FIRST — do not touch Redis beyond the claim yet.
    let result: { ok: true; wasAccepted: boolean; radius?: number };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            orderStatus: true,
            dispatchRadiusMeters: true,
            statusHistory: true,
          },
        });
        if (!order) throw new NotFoundException('Order not found');

        // If not ACCEPTED anymore, just log and return — no retry should fire.
        if (order.orderStatus !== OrderStatus.ORDER_ACCEPTED) {
          await tx.orderActivityLog.create({
            data: {
              orderId,
              actorId: driverId,
              actorRole: Role.DISPATCHER,   // ← FIXED: was DISPATCHER
              action: 'DRIVER_DECLINED',
              reason: reason ?? 'Order status changed before decline',
            },
          });
          return { ok: true as const, wasAccepted: false };
        }

        // Still ACCEPTED: reset assignment + driver status.
        await tx.driverAssignment.updateMany({
          where: { orderId, driverId },
          data: {
            assignmentStatus: AssignmentStatus.PENDING,
            driverId: null,
          },
        });

        await tx.driverProfile.updateMany({
          where: { userId: driverId, status: DriverStatus.BUSY },
          data: { status: DriverStatus.ONLINE },
        });

        // Push a status-history entry so the admin portal can see the decline.
        await tx.order.update({
          where: { id: orderId },
          data: {
            statusHistory: {
              push: {
                status: OrderStatus.ORDER_ACCEPTED,
                timestamp: new Date().toISOString(),
                note: 'DRIVER_DECLINED',
                actorId: driverId,
                actorRole: Role.DISPATCHER,
                reason: reason ?? null,
              },
            },
          },
        });

        await tx.orderActivityLog.create({
          data: {
            orderId,
            actorId: driverId,
            actorRole: Role.DISPATCHER,
            action: 'DRIVER_DECLINED',
            fromStatus: OrderStatus.ORDER_ACCEPTED,
            toStatus: OrderStatus.ORDER_ACCEPTED,
            reason: reason ?? null,
          },
        });

        return {
          ok: true as const,
          wasAccepted: true,
          radius: order.dispatchRadiusMeters ?? undefined,
        };
      });
    } catch (err) {
      // DB failed. Restore the Redis claim so the driver can retry or the
      // timeout can fire correctly.
      this.logger.error(
        `declineOrder transaction failed for ${orderId}/${driverId}`,
        err,
      );
      await this.redis.setex(pendingKey, 300, 'pending').catch(() => { });
      await this.redis.sadd(driverPendingSet, orderId).catch(() => { });
      await this.redis.sadd(pendingDriversKey, driverId).catch(() => { });
      throw err;
    }

    // 3. DB committed. Now clean Redis.
    await this.redis.srem(driverPendingSet, orderId);
    await this.redis.srem(pendingDriversKey, driverId);

    // Remember the decline so the fallback won't resurface it for an hour.
    await this.redis.sadd(`driver:${driverId}:declined`, orderId);
    await this.redis.expire(`driver:${driverId}:declined`, 3600);

    // Cancel this driver's per-driver timeout job.
    await this.assignmentQueue
      .remove(`timeout-${orderId}-${driverId}`)
      .catch(() => { });

    // 4. Post-commit: only re-dispatch if the order is genuinely still ACCEPTED.
    if (result.wasAccepted) {
      const remaining = await this.redis.scard(pendingDriversKey);
      if (remaining === 0) {
        this.logger.log(
          `Last candidate declined order ${orderId}; triggering retry wave`,
        );
        await this.redis
          .del(`order:${orderId}:dispatch_lock`)
          .catch(() => { });

        // Cancel any orphaned global timeout before re-dispatching.
        await this.assignmentQueue
          .remove(`assignment-timeout-${orderId}`)
          .catch(() => { });

        await this.assignmentQueue.add(
          'retry-driver-search',
          {
            orderId,
            radius: result.radius ?? 5000,
            attempt: 1,
          },
          {
            delay: 1000,
            jobId: `decline-retry-${orderId}-${Date.now()}`,
            removeOnComplete: true,
          },
        );
      }
    }

    // 5. Update the declining driver's UI (they should drop the order).
    this.driverGateway.emitOrderRemoved(driverId, orderId);

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

    // 2. Load order scalars
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

    // 4. Commission % and vehicleTier from VehicleTypeConfig
    //    (single lookup — we need both name and commission)
    let commissionPct = 0;
    let vehicleTier: VehicleType | null = null;

    if (order.deliveryOptionId) {
      const config = await tx.vehicleTypeConfig.findUnique({
        where: { id: order.deliveryOptionId },
        select: { deliveryCommissionPct: true, name: true },
      });

      if (config) {
        commissionPct = Number(config.deliveryCommissionPct);
        vehicleTier = config.name;                    // ✅ snapshot
      } else {
        this.logger.warn(
          `No VehicleTypeConfig found for deliveryOptionId=` +
          `${order.deliveryOptionId} on order ${orderId} — using 0% commission`,
        );
      }
    }

    // 4b. Fallback: driver's current profile tier if the config was missing
    if (!vehicleTier) {
      const profile = await tx.driverProfile.findUnique({
        where: { userId: driverId },
        select: { vehicleType: true },
      });
      vehicleTier = profile?.vehicleType ?? VehicleType.CAR;
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
          vehicleTier,
        },
      },
    });

    // 8. Earning detail row
    const earning = await tx.driverEarning.create({
      data: {
        driverId,
        orderId,
        walletTxId: walletTx.id,
        vehicleTier,
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
      `tier=${vehicleTier} gross=${grossAmount} pct=${commissionPct} ` +
      `commission=${commissionAmount} net=${netAmount} ` +
      `walletTx=${walletTx.id}`,
    );

    return earning;
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
      } as Prisma.DriverEarningUncheckedCreateInput,
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
  private async creditDriverEarningOnDeliverybk(
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
      } as Prisma.DriverEarningUncheckedCreateInput,
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
