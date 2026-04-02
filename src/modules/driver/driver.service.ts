// src/drivers/services/driver-onboarding.service.ts
import {
  Injectable,
  Logger,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DriverStep1Dto } from './dto/step1-driver.dto';
import { DriverStep2Dto } from './dto/step2-driver.dto';
import { DriverStep3MetadataDto } from './dto/step3-driver.dto';
import { DriverStep4Dto } from './dto/step4-driver.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { UserRole, UserStatus } from '../../shared/enums';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { OnBoardingStatus } from '@prisma/client';

@Injectable()
export class DriverService {
  private readonly logger = new Logger(DriverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

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
  async saveStep1(driverId: string, dto: DriverStep1Dto) {
    this.logger.log(`Saving step 1 for driver: ${driverId}`);

    const driver = await this.validateDriverForOnboarding(driverId);

    // Check sequential order
    if ((driver.onboardingStep ?? 0) > 1) {
      throw new ConflictException('Already completed step 1');
    }

    // Check if email or phone already exists for active users
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { phoneNumber: dto.phoneNumber }],
        NOT: { id: driverId },
        //status: { not: 'DELETED' },
      },
    });

    if (existingUser) {
      throw new ConflictException('Email or phone number already in use');
    }

    // Update user basic info
    await this.prisma.user.update({
      where: { id: driverId },
      data: {
        email: dto.email,
        phoneNumber: dto.phoneNumber,
        firstName: dto.fullName.split(' ')[0],
        lastName: dto.fullName.split(' ').slice(1).join(' ') || '',
        onboardingStep: 1,
        onboardingStatus: OnBoardingStatus.IN_PROGRESS,
        status: UserStatus.PENDING_DOCUMENTS,
      },
    });

    // Create or update driver profile
    await this.prisma.driverProfile.upsert({
      where: { userId: driverId },
      create: {
        userId: driverId,
        fullName: dto.fullName,
        phoneNumber: dto.phoneNumber,
        email: dto.email,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        country: dto.country || 'NG',
        postalCode: dto.postalCode,
        // user: {
        //   connect: { id: driverId },
        // },
      },
      update: {
        fullName: dto.fullName,
        phoneNumber: dto.phoneNumber,
        email: dto.email,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        country: dto.country || 'NG',
        postalCode: dto.postalCode,
      },
    });

    return {
      success: true,
      message: 'Step 1 completed successfully',
      onboardingStep: 1,
      onboardingStatus: OnBoardingStatus.IN_PROGRESS,
      nextStep: 2,
    };
  }

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
  async saveStep4(driverId: string, dto: DriverStep4Dto) {
    this.logger.log(`Saving step 4 for driver: ${driverId}`);

    const driver = await this.validateDriverForOnboarding(driverId);

    if (driver.onboardingStep !== 3) {
      throw new ConflictException('Please complete step 3 first');
    }

    if (!dto.confirmInformation) {
      throw new BadRequestException(
        'Please confirm that all information is correct',
      );
    }

    // Get full driver profile to validate all fields
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
    });

    if (!profile) {
      throw new BadRequestException('Driver profile not found');
    }

    // Validate all required fields are present
    const requiredFields = [
      profile.fullName,
      profile.phoneNumber,
      profile.email,
      profile.address,
      profile.city,
      profile.state,
      profile.vehicleType,
      profile.vehicleMake,
      profile.vehicleModel,
      profile.year,
      profile.licensePlate,
    ];

    const requiredDocuments = [
      profile.driverLicenseUrl,
      profile.vehicleInsuranceUrl,
      profile.vehicleRegistrationUrl,
    ];

    if (requiredFields.some((field) => !field)) {
      throw new BadRequestException('Please complete all required fields');
    }

    if (requiredDocuments.some((doc) => !doc)) {
      throw new BadRequestException('Please upload all required documents');
    }

    // Update user status to under review
    await this.prisma.user.update({
      where: { id: driverId },
      data: {
        onboardingStep: 4,
        onboardingStatus: OnBoardingStatus.COMPLETED,
        status: UserStatus.UNDER_REVIEW,
      },
    });

    // Create audit log for admin review
    // await this.prisma.auditLog.create({
    //   data: {
    //     userId: driverId,
    //     action: 'DRIVER_ONBOARDING_COMPLETED',
    //     entityType: 'DRIVER',
    //     entityIds: [driverId],
    //     metadata: {
    //       profileId: profile.id,
    //       vehicleType: profile.vehicleType,
    //       licensePlate: profile.licensePlate,
    //       submittedAt: new Date().toISOString(),
    //     },
    //   },
    // });

    return {
      success: true,
      message: 'Driver onboarding completed. Your application is under review.',
      onboardingStep: 4,
      onboardingStatus: OnBoardingStatus.COMPLETED,
      status: UserStatus.UNDER_REVIEW,
      nextSteps: [
        'Application is being reviewed by admin',
        'You will be notified once approved',
        'Approval typically takes 2-3 business days',
      ],
    };
  }

  /**
   * Get current onboarding state
   */
  async getOnboardingState(driverId: string) {
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: {
        driverProfile: true,
      },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    // Determine completed steps based on data
    const completedSteps: number[] = [];

    if (driver.driverProfile?.fullName) completedSteps.push(1);
    if (driver.driverProfile?.vehicleType) completedSteps.push(2);
    if (driver.driverProfile?.driverLicenseUrl) completedSteps.push(3);
    if (driver.onboardingStatus === OnBoardingStatus.COMPLETED)
      completedSteps.push(4);

    // Determine next step
    const nextStep = driver.onboardingStep ? driver.onboardingStep + 1 : 1;

    return {
      onboardingStatus: driver.onboardingStatus,
      onboardingStep: driver.onboardingStep,
      accountStatus: driver.status,
      userRole: driver.role,
      nextStep: nextStep <= 4 ? nextStep : null,
      completedSteps,
      redirectUrl: this.getRedirectUrl(driver.status, driver.onboardingStatus),
      profile: {
        fullName: driver.driverProfile?.fullName,
        phoneNumber: driver.driverProfile?.phoneNumber,
        email: driver.driverProfile?.email,
        vehicleType: driver.driverProfile?.vehicleType,
        licensePlate: driver.driverProfile?.licensePlate,
        hasDocuments: !!(
          driver.driverProfile?.driverLicenseUrl &&
          driver.driverProfile?.vehicleInsuranceUrl &&
          driver.driverProfile?.vehicleRegistrationUrl
        ),
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
      profile: driver.driverProfile,
      stats: {
        totalDeliveries: driver.driverProfile?.totalDeliveries || 0,
        rating: driver.driverProfile?.rating || 0,
        isAvailable: driver.driverProfile?.isAvailable || false,
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
}
