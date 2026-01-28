import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { CreateCustomerDto } from '../auth/dto/create-customer.dto';
import { OAuthProviderType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CreateBusinessProfileDto } from './dto/create-business-profile.dto';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { UserRole } from 'src/shared/enums';
import { AbstractUserRepository } from './repositories/abstract-user.repository';
import { User } from './entities/user.entity';
import Helper from 'src/shared/utils/helpers';
import { LoginCustomerDto } from '../auth/dto/login-customer.dto';
import { VerificationService } from '../verification/verification.service';
import { VerificationPurpose } from '../verification/dto/send-otp.dto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly userRepository: AbstractUserRepository,
    private readonly verificationService: VerificationService, // Inject verification service
  ) {}


  
  /**
   * Create a new customer with automatic OTP verification
   */
  async createCustomer(userData: Partial<User>): Promise<{ user: User; requiresVerification: boolean }> {
    const { email, password, phoneNumber } = userData;
    this.logger.log(`Creating customer with email: ${email}`);

    // Check if user already exists
    const existingUser = await this.userRepository.findExistingUser(
      email,
      phoneNumber,
    );

    if (existingUser) {
      this.logger.warn(
        `User already exists with email: ${email} or phone: ${phoneNumber}`,
      );
      throw new ConflictException(
        'User with this email or phone already exists',
      );
    }

    // Hash password
    const hashedPassword = await Helper.hashText(password);

    // // Create user with unverified status
    const user = await this.userRepository.create({
      ...userData,
      password: hashedPassword,
      role: UserRole.CUSTOMER,
      isActive: true,
      isVerified: false, // User starts as unverified
      lastLoginAt: new Date(),
    });

    //const savedUser = await this.userRepository.create(user);

    // Send OTP based on primary contact method
    await this.sendVerificationOtp(user);

    return {
      user: user,
      requiresVerification: true // Frontend should show verification screen
    };
  }

  /**
   * Send verification OTP after registration
   */
  private async sendVerificationOtp(user: User): Promise<void> {
    try {
      // Determine primary verification method
      // Priority: email > phoneNumber
      const identifier = user.email || user.phoneNumber;
      
      if (!identifier) {
        this.logger.warn(`No contact identifier for user ${user.id}`);
        return;
      }
      
      await this.verificationService.sendOtp({
        identifier,
        purpose: VerificationPurpose.REGISTRATION,
      });
      
      this.logger.log(`Verification OTP sent to ${identifier}`);
    } catch (error) {
      this.logger.error(`Failed to send verification OTP: ${error.message}`);
      // Don't fail registration if OTP sending fails
      // User can request resend later
    }
  }

  /**
   * Verify user with OTP
   */
  async verifyUser(identifier: string, otp: string): Promise<{ success: boolean; user?: User }> {
    const isValid = await this.verificationService.verifyOtp({
      identifier,
      otp,
    });
    
    if (isValid) {
      // Find user by identifier (email or phone)
      const user = await this.findUserByIdentifier(identifier);
      
      if (user) {
        // Update verification status
        user.isVerified = true;
        user.verifiedAt = new Date();
        const updatedUser = await this.userRepository.update(user.id, user);

        //const updatedUser = await this.userRepository.create(user);
        // const updatedUser = await this.userRepository.update(
        //   { id: user.id },
        //   {
        //     isVerified: true,
        //     verifiedAt: new Date(),
        //   },
        // );

        // Send welcome message
        await this.sendWelcomeMessage(user);

        this.logger.log(`User ${user.id} verified successfully`);

        return {
          success: true,
          user: updatedUser,
        };
      }
    }
    
    // Get remaining attempts for error message
   // const remainingAttempts = await this.verificationService.getRemainingAttempts(identifier);
    
    // this.logger.warn(`OTP verification failed for ${identifier}. Remaining attempts: ${remainingAttempts}`);
        this.logger.warn(
          `OTP verification failed for ${identifier}`,
        );

    return {
      success: false
    };
  }

  /**
   * Resend verification OTP
   */
  async resendVerificationOtp(identifier: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if user exists
      const user = await this.findUserByIdentifier(identifier);
      
      if (!user) {
        return {
          success: false,
          message: 'User not found'
        };
      }
      
      if (user.isVerified) {
        return {
          success: false,
          message: 'User is already verified'
        };
      }
      
      // Send new OTP
      await this.verificationService.sendOtp({
        identifier,
        purpose: VerificationPurpose.REGISTRATION,
      });
      
      this.logger.log(`Verification OTP resent to ${identifier}`);
      
      return {
        success: true,
        message: 'OTP sent successfully'
      };
      
    } catch (error) {
      this.logger.error(`Failed to resend OTP: ${error.message}`);
      return {
        success: false,
        message: 'Failed to send OTP. Please try again later.'
      };
    }
  }

  /**
   * Authenticate user with credentials (only verified users can login)
   */
  async authenticateUser(loginDto: LoginCustomerDto): Promise<User> {
    const { email, phoneNumber, password } = loginDto;
    
    const user = await this.userRepository.findExistingUser(
      email,
      phoneNumber,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is active
    if (!user.isActive) {
      this.logger.warn(`Login attempt for inactive user: ${user.id}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    // Check if user is verified
    if (!user.isVerified) {
      this.logger.warn(`Login attempt for unverified user: ${user.id}`);
      throw new UnauthorizedException('Account not verified. Please verify your email/phone.');
    }

    // Verify password
    const isPasswordValid = await Helper.compareHashedText(password, user.password);

    if (!isPasswordValid) {
      this.logger.warn(`Invalid password for user: ${user.id}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    user.lastLoginAt = new Date();
    await this.userRepository.create(user);

    return user;
  }

  /**
   * Send welcome message after verification
   */
  private async sendWelcomeMessage(user: User): Promise<void> {
    try {
      if (user.email) {
        await this.verificationService.sendWelcomeEmail(user.email, user.firstName);
      }
      if (user.phoneNumber) {
        await this.verificationService.sendWelcomeSms(user.phoneNumber, user.firstName);
      }
    } catch (error) {
      this.logger.error(`Failed to send welcome message: ${error.message}`);
      // Non-critical error, don't fail verification
    }
  }

  /**
   * Find user by identifier (email or phone)
   */
  private async findUserByIdentifier(identifier: string): Promise<User | null> {
    // Check if identifier is email or phone
    const isEmail = identifier.includes('@');
    
    if (isEmail) {
      // return this.userRepository.findOne({
      //   where: { email: identifier }
      // });
      return await this.findByEmail(identifier);
    } else {
      // return this.userRepository.findOne({
      //   where: { phoneNumber: identifier }
      // });
      return await this.findByPhoneNumber(identifier);
    }
  }


  // async createCustomer(userData: Partial<User>): Promise<User> {
  //   const { email, password, phoneNumber } = userData;
  //   this.logger.log(`Creating customer with email: ${email}`);

  //   const existingUser = await this.userRepository.findExistingUser(
  //     email,
  //     phoneNumber,
  //   );

  //   if (existingUser) {
  //     this.logger.warn(
  //       `User already exists with email: ${email} or phone: ${phoneNumber}`,
  //     );
  //     throw new ConflictException(
  //       'User with this email or phone already exists',
  //     );
  //   }

  //   const hashedPassword = await Helper.hashText(password);

  //   return this.userRepository.create({
  //     ...userData,
  //     password: hashedPassword,
  //     role: UserRole.CUSTOMER,
  //     isActive: true,
  //     lastLoginAt: new Date(),
  //   });

    
  // }


  /**
   * Authenticate user with credentials
   * Contains all user-related authentication logic
   */
  // async authenticateUser(loginDto: LoginCustomerDto): Promise<User> {
  //   const { email, phoneNumber, password } = loginDto;
    
  //   // if (!email && !phoneNumber) {
  //   //   throw new UnauthorizedException('Email or phone number is required');
  //   // }

  //   // // Find user
  //   // const user = await this.findUserByIdentifier(email, phoneNumber);
    
  //   // if (!user) {
  //   //   this.logger.warn(`User not found: ${email || phoneNumber}`);
  //   //   throw new UnauthorizedException('Invalid credentials');
  //   // }

  //    const user = await this.userRepository.findExistingUser(
  //   email,
  //   phoneNumber,
  // );

  // if (!user) {
  //   throw new UnauthorizedException('Invalid credentials');
  // }

  //   // Check if user is active
  //   if (!user.isActive) {
  //     this.logger.warn(`Login attempt for inactive user: ${user.id}`);
  //     throw new UnauthorizedException('Account is deactivated');
  //   }

  //   // Verify password
  //       const isPasswordValid = await Helper.compareHashedText(password, user.password);

  //   if (!isPasswordValid) {
  //     this.logger.warn(`Invalid password for user: ${user.id}`);
  //     throw new UnauthorizedException('Invalid credentials');
  //   }

  //   return user;
  // }

  /**
   * Find user by email or phone number
   */
  // async findUserByIdentifier(email?: string, phoneNumber?: string): Promise<User | null> {
  //   try {
  //     if (email) {
  //       return await this.findByEmail(email);
  //     } else if (phoneNumber) {
  //       return await this.findByPhoneNumber(phoneNumber);
  //     }
  //     return null;
  //   } catch (error) {
  //     this.logger.error(`Error finding user: ${error.message}`);
  //     return null;
  //   }
  // }


  async updateRefreshToken(
    userId: string,
    refreshTokenHash: string | null,
  ): Promise<void> {
    this.logger.log(`Updating refresh token for user: ${userId}`);
    await this.userRepository.updateRefreshTokenHash(userId, refreshTokenHash);
  }

   async findById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findByEmail(email);
  }

  async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    return this.userRepository.findByPhone(phoneNumber);
  }

  async markUserLogin(userId: string): Promise<void> {
    try {
      await this.userRepository.update(userId, {
        lastLoginAt: new Date(),
      });
      this.logger.log(`User ${userId} logged in at ${new Date()}`);
    } catch (error) {
      this.logger.error(`Failed to mark login for user ${userId}: ${error.message}`);
    }
  }

  ///////////////////////////

  async createUser(dto: CreateCustomerDto, hashedPassword: string) {
    const emailLower = dto.email.toLowerCase();

    const user = await this.prisma.user.create({
      data: {
        email: emailLower,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: UserRole.CUSTOMER,
      },
    });
    return user;
  }

  // async findByEmail(email: string) {
  //   return this.prisma.user.findUnique({
  //     where: { email: email.toLowerCase() },
  //   });
  // }

  // async findById(id: string) {
  //   const user = await this.prisma.user.findUnique({ where: { id } });
  //   if (!user) throw new NotFoundException('User not found');
  //   return user;
  // }

  async attachOAuthProvider(
    userId: string,
    provider: OAuthProviderType,
    providerId: string,
  ) {
    return this.prisma.oAuthProvider.create({
      data: {
        provider,
        providerId,
        user: { connect: { id: userId } },
      },
    });
  }

  async createOrGetOAuthUserold({
    email,
    firstName,
    lastName,
    provider,
    providerId,
  }: {
    email?: string;
    firstName?: string;
    lastName?: string;
    provider: OAuthProviderType;
    providerId: string;
  }) {
    // 1. Check if OAuth provider exists
    const existing = await this.prisma.oAuthProvider.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { user: true },
    });

    if (existing) return existing.user;

    // 2. If user exists by email, attach OAuth provider
    if (email) {
      const userByEmail = await this.prisma.user.findUnique({
        where: { email },
      });

      if (userByEmail) {
        await this.attachOAuthProvider(userByEmail.id, provider, providerId);
        return userByEmail;
      }
    }

    // 3. Create new user
    const newUser = await this.prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        role: UserRole.CUSTOMER,
        oauthProviders: {
          create: { provider, providerId },
        },
      },
    });

    return newUser;
  }

  async createOrGetOAuthUser({
    email,
    firstName,
    lastName,
    provider,
    providerId,
  }: {
    email?: string;
    firstName?: string;
    lastName?: string;
    provider: OAuthProviderType;
    providerId: string;
  }) {
    // 1️⃣ Check if OAuth provider already exists (return existing user)
    const existingProvider = await this.prisma.oAuthProvider.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { user: true },
    });

    if (existingProvider) {
      // update user info if needed (e.g., profile name changed on Google)
      await this.prisma.user.update({
        where: { id: existingProvider.user.id },
        data: {
          firstName: firstName || existingProvider.user.firstName,
          lastName: lastName || existingProvider.user.lastName,
          updatedAt: new Date(),
        },
      });
      return existingProvider.user;
    }

    // 2️⃣ If no provider found but user exists by email, link provider to user
    if (email) {
      const userByEmail = await this.prisma.user.findUnique({
        where: { email },
      });

      if (userByEmail) {
        // ensure provider is attached
        await this.attachOAuthProvider(userByEmail.id, provider, providerId);
        return userByEmail;
      }
    }

    // 3️⃣ Create a new user (first-time Google signup)
    const newUser = await this.prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        role: UserRole.CUSTOMER,
        oauthProviders: {
          create: { provider, providerId },
        },
      },
    });

    return newUser;
  }

  async updatePassword(userId: string, hashedPassword: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }

  /**
   * Get profile of the currently authenticated user
   * @param userId string
   * @returns user info (excluding sensitive fields)
   */
  async profile(userId: string) {
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        //profileImage: true,
        createdAt: true,
        updatedAt: true,
        oauthProviders: {
          select: {
            provider: true,
            providerId: true,
          },
        },
        businessProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async createOrUpdateProfile(
    userId: string,
    dto: CreateBusinessProfileDto,
    file?: Express.Multer.File,
  ) {
    let logoUrl: string | undefined;

    if (file) {
      const uploadResult = await this.cloudinary.uploadLogo(file);
      logoUrl = uploadResult.secure_url;
    }

    const existingProfile = await this.prisma.businessProfile.findUnique({
      where: { userId },
    });

    const data = {
      businessName: dto.businessName,
      type: dto.type,
      phoneNumber: dto.phoneNumber,
      email: dto.email,
      address: dto.address,
      openingHours: dto.openingHours,
      shortDesc: dto.shortDescription,
      ...(logoUrl && { logoUrl }),
    };

    if (existingProfile) {
      return this.prisma.businessProfile.update({
        where: { userId },
        data,
      });
    }

    return this.prisma.businessProfile.create({
      data: { ...data, userId },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.password) {
      throw new BadRequestException(
        'Password change not allowed for OAuth users',
      );
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Current password is incorrect');
    }

    const isSameAsOld = await bcrypt.compare(newPassword, user.password);
    if (isSameAsOld) {
      throw new BadRequestException(
        'New password cannot be the same as the old password',
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { message: 'Password changed successfully' };
  }

  // async getUserByEmailOrPhoneNumberWithRelations(
  //   email: string,
  //   phoneNumber: string,
  // ) {
  //   const users = await this.prisma.user.findMany({
  //     where: {
  //       OR: [{ email }, { phoneNumber }],
  //     },
  //     include: {
  //       customer: true,
  //       vendor: true,
  //       admin: true,
  //     },
  //   });

  //   if (users.length === 0) {
  //     return null;
  //   }

  //   if (users.length === 1) {
  //     return users[0];
  //   }

  //   // If both email and phone matched different users
  //   if (users[0].id !== users[1].id) {
  //     throw new ConflictException(
  //       'Email and phone number belong to different accounts',
  //     );
  //   }

  //   return users[0];
  // }
}
