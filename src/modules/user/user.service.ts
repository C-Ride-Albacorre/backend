import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { CreateCustomerDto } from '../auth/dto/create-customer.dto';
import { OAuthProviderType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import {
  DocumentType,
  RegistrationMethod,
  RegistrationStatus,
  UserRole,
  UserStatus,
  VerificationPurpose,
} from '../../shared/enums';
import { AbstractUserRepository } from './repositories/abstract-user.repository';
import { User } from './entities/user.entity';
import { LoginCustomerDto } from '../auth/dto/login-customer.dto';
import { VerificationService } from '../verification/verification.service';
import {
  PendingVerificationDto,
  RegisterResponseDto,
} from '../auth/dto/registration-response.dto';
import Helper from '../../shared/utils/helpers';
import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly REQUIRED_DOCUMENTS = [
    DocumentType.CAC,
    DocumentType.BUSINESS_PERMIT,
    DocumentType.ID_PROOF,
  ];
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly userRepository: AbstractUserRepository,
    private readonly verificationService: VerificationService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  /**
   * Create a new customer with automatic OTP verification
   */
  async createCustomer(dto: Partial<User>): Promise<PendingVerificationDto> {
    if (dto.referralCode) {
      const existing = await this.prisma.user.findUnique({
        where: { referralCode: dto.referralCode },
      });
      if (existing) {
        throw new BadRequestException('Referral code already exists');
      }
    }

    // Normalize phone
    if (dto.phoneNumber) {
      const phone = parsePhoneNumberFromString(
        dto.phoneNumber,
        (dto.countryCode || 'NG') as CountryCode,
      );

      if (!phone || !phone.isValid()) {
        throw new BadRequestException('Invalid phone number');
      }

      dto.phoneNumber = phone.format('E.164');
    }

    const registrationInput = dto.email || dto.phoneNumber;
    const registrationMethod = Helper.getRegistrationMethod(registrationInput);

    const existingUser = await this.userRepository.findExistingUser(
      dto.email,
      dto.phoneNumber,
    );

    // ❌ BLOCK verified users completely
    if (existingUser || existingUser?.isVerified) {
      throw new ConflictException('User already exists. Please log in.');
    }

    // if (existingUser?.isVerified) {
    //   throw new ConflictException('User already exists. Please log in.');
    // }

    // 🔁 Existing unverified → resend OTP
    if (existingUser) {
      await this.sendVerificationOtp(existingUser);

      return {
        status: RegistrationStatus.PENDING_VERIFICATION,
        requiresVerification: true,
        registrationMethod,
        verificationIdentifier: registrationInput,
        user: existingUser,
        isNewUser: true,
      };
    }

    // 🆕 New user
    const hashedPassword = await Helper.hashText(dto.password);

    const user = await this.userRepository.create({
      ...dto,
      phoneNumber: dto.phoneNumber,
      countryCode: dto.countryCode,
      password: hashedPassword,
      role: UserRole.CUSTOMER,
      isActive: true,
      isVerified: false,
      lastLoginAt: null,
    });

    await this.sendVerificationOtp(user);

    return {
      status: RegistrationStatus.NEW,
      requiresVerification: true,
      registrationMethod,
      verificationIdentifier: registrationInput,
      user,
      isNewUser: true, // ✅ add this
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
  async verifyUser(
    userId: string,
    identifier: string,
    otp: string,
  ): Promise<{ success: boolean; user?: User }> {
    // 1️⃣ Get authenticated user
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2️⃣ Ensure identifier belongs to user (CRITICAL FIX)
    const isEmailMatch = user.email && user.email === identifier;
    const isPhoneMatch = user.phoneNumber && user.phoneNumber === identifier;

    if (!isEmailMatch && !isPhoneMatch) {
      throw new BadRequestException(
        'Identifier does not belong to authenticated user',
      );
    }

    // 3️⃣ Verify OTP (UNCHANGED)
    const isValid = await this.verificationService.verifyOtp({
      identifier,
      otp,
    });

    if (isValid) {
      // 4️⃣ Update verification state properly
      if (isEmailMatch && !user.isEmailVerified) {
        user.isEmailVerified = true;
        user.emailVerifiedAt = new Date();
      }

      if (isPhoneMatch && !user.isPhoneVerified) {
        user.isPhoneVerified = true;
        user.phoneVerifiedAt = new Date();
      }

      // Maintain your legacy flag if needed
      if (user.isEmailVerified || user.isPhoneVerified) {
        user.isVerified = true;
        user.verifiedAt = new Date();
      }

      // 5️⃣ Status transitions (important upgrade)
      if (user.isEmailVerified && user.isPhoneVerified) {
        user.status = UserStatus.PENDING_ONBOARDING;

        if (!user.onboardingStatus) {
          user.onboardingStatus = 'NOT_STARTED';
          user.onboardingStep = 0;
        }
      } else if (!user.isEmailVerified) {
        user.status = UserStatus.PENDING_EMAIL_VERIFICATION;
      } else if (!user.isPhoneVerified) {
        user.status = UserStatus.PENDING_PHONE_VERIFICATION;
      }

      const updatedUser = await this.userRepository.update(user.id, user);

      // 6️⃣ Keep your existing behavior
      await this.sendWelcomeMessage(updatedUser);

      this.logger.log(`User ${updatedUser.id} verified successfully`);

      return {
        success: true,
        user: updatedUser,
      };
    }

    // ❌ Failure path (UNCHANGED)
    const remainingAttempts =
      await this.verificationService.getRemainingAttempts(identifier);

    this.logger.warn(
      `OTP verification failed for ${identifier}. Remaining attempts: ${remainingAttempts}`,
    );

    return {
      success: false,
    };
  }

  async verifyUserold(
    identifier: string,
    otp: string,
  ): Promise<{ success: boolean; user?: User }> {
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
    const remainingAttempts =
      await this.verificationService.getRemainingAttempts(identifier);

    this.logger.warn(
      `OTP verification failed for ${identifier}. Remaining attempts: ${remainingAttempts}`,
    );
    // this.logger.warn(
    //   `OTP verification failed for ${identifier}`,
    // );

    return {
      success: false,
    };
  }

  /**
   * Resend verification OTP
   */
  async resendVerificationOtp(
    identifier: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Check if user exists
      const user = await this.findUserByIdentifier(identifier);

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      if (user.isVerified) {
        return {
          success: false,
          message: 'User is already verified',
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
        message: 'OTP sent successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to resend OTP: ${error.message}`);
      return {
        success: false,
        message: 'Failed to send OTP. Please try again later.',
      };
    }
  }

  /**
   * Authenticate user with credentials (only verified users can login)
   */
  async authenticateUser(
    loginDto: LoginCustomerDto,
    identifier: string,
    verificationMethod: string,
  ): Promise<
    | { success: true; user: User; isNewUser: boolean }
    | {
        success: false;
        status: 'UNVERIFIED';
        verificationMethod: string;
        identifier: string;
        verificationToken: string;
        message: string;
      }
  > {
    const { email, phoneNumber, password } = loginDto;

    const user = await this.userRepository.findExistingUser(email, phoneNumber);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      this.logger.warn(`Login attempt for inactive user: ${user.id}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    // ✅ REUSE EXISTING VERIFICATION FLOW
    if (!user.isVerified) {
      this.logger.warn(`Login attempt for unverified user: ${user.id}`);

      const verificationResponse =
        await this.authService.resendVerificationToken({
          identifier,
        });

      // send OTP (this should internally generate + persist the code)
      // 2. explicitly send OTP (email/sms)
      await this.verificationService.sendOtp({
        identifier,
      });

      return {
        success: false,
        status: 'UNVERIFIED',
        message: verificationResponse.message,
        identifier,
        verificationMethod,
        verificationToken: verificationResponse.verificationToken,
      };
    }

    if (!password) {
      throw new BadRequestException('Password is required');
    }

    if (!user.password) {
      throw new BadRequestException(
        'This account was created using Google. Please login with Google.',
      );
    }

    const isPasswordValid = await Helper.compareHashedText(
      password,
      user.password,
    );

    if (!isPasswordValid) {
      this.logger.warn(`Invalid password for user: ${user.id}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // const updatedUser = await this.prisma.user.update({
    //   where: { id: user.id },
    //   data: {
    //     lastLoginAt: new Date(),
    //   },
    // });

    // return {
    //   success: true,
    //   user: updatedUser,
    // };

    const isNewUser = !user.lastLoginAt;

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
      },
    });

    return {
      success: true,
      user: updatedUser,
      isNewUser, // ✅ include this
    };
  }

  async authenticateUserOld(
    loginDto: LoginCustomerDto,
    identifier: string,
    verificationMethod: string,
  ): Promise<
    | { success: true; user: User }
    | {
        success: false;
        status: 'UNVERIFIED';
        verificationMethod: string;
        identifier: string;
        message: string;
      }
  > {
    const { email, phoneNumber, password } = loginDto;

    const user = await this.userRepository.findExistingUser(email, phoneNumber);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      this.logger.warn(`Login attempt for inactive user: ${user.id}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    if (!user.isVerified) {
      this.logger.warn(`Login attempt for unverified user: ${user.id}`);

      return {
        success: false,
        status: 'UNVERIFIED',
        message: 'Account not verified. Please verify your email/phone.',
        identifier,
        verificationMethod,
      };
    }

    if (!password) {
      throw new BadRequestException('Password is required');
    }

    if (!user.password) {
      throw new BadRequestException(
        'This account was created using Google. Please login with Google.',
      );
    }

    const isPasswordValid = await Helper.compareHashedText(
      password,
      user.password,
    );

    if (!isPasswordValid) {
      this.logger.warn(`Invalid password for user: ${user.id}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
      },
    });

    return {
      success: true,
      user: updatedUser,
    };
  }
  // async authenticateUser(
  //   loginDto: LoginCustomerDto,
  //   identifier,
  //   verificationMethod,
  // ): Promise<
  //   | User
  //   | {
  //       verificationMethod: string;
  //       identifier: string;
  //       message: string;
  //     }
  // > {
  //   const { email, phoneNumber, password } = loginDto;

  //   const user = await this.userRepository.findExistingUser(email, phoneNumber);

  //   if (!user) {
  //     throw new UnauthorizedException('Invalid credentials');
  //   }

  //   // Check if user is active
  //   if (!user.isActive) {
  //     this.logger.warn(`Login attempt for inactive user: ${user.id}`);
  //     throw new UnauthorizedException('Account is deactivated');
  //   }

  //   // Check if user is verified
  //   if (!user.isVerified) {
  //     this.logger.warn(`Login attempt for unverified user: ${user.id}`);
  //     // throw new UnauthorizedException(
  //     //   'Account not verified. Please verify your email/phone.',
  //     // );
  //     return {
  //       message: 'Account not verified. Please verify your email/phone.',
  //       identifier: identifier,
  //       verificationMethod: verificationMethod,
  //     };
  //   }

  //   if (!password) {
  //     throw new BadRequestException('Password is required');
  //   }

  //   if (!user.password) {
  //     throw new BadRequestException(
  //       'This account was created using Google. Please login with Google.',
  //     );
  //   }

  //   // Verify password
  //   const isPasswordValid = await Helper.compareHashedText(
  //     password,
  //     user.password,
  //   );

  //   if (!isPasswordValid) {
  //     this.logger.warn(`Invalid password for user: ${user.id}`);
  //     throw new UnauthorizedException('Invalid credentials');
  //   }

  //   // Update last login
  //   const updatedUser = await this.prisma.user.update({
  //     where: { id: user.id },
  //     data: {
  //       lastLoginAt: new Date(),
  //       //loginCount: { increment: 1 },
  //     },
  //   });

  //   return updatedUser;
  // }

  /**
   * Send welcome message after verification
   */
  private async sendWelcomeMessage(user: User): Promise<void> {
    try {
      if (user.email) {
        await this.verificationService.sendWelcomeEmail(
          user.email,
          user.firstName,
        );
      }
      if (user.phoneNumber) {
        await this.verificationService.sendWelcomeSms(
          user.phoneNumber,
          user.firstName,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to send welcome message: ${error.message}`);
      // Non-critical error, don't fail verification
    }
  }

  /**
   * Find user by identifier (email or phone)
   */
  public async findUserByIdentifier(identifier: string): Promise<User | null> {
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

  async findUserForPasswordReset(identifier: string): Promise<User | null> {
    // const user = await this.userRepo.findOne({
    //   where: [{ email: identifier }, { phoneNumber: identifier }],
    // });
    const user = await this.findUserByIdentifier(identifier);

    if (!user) {
      return null;
    }

    if (!user.isActive) {
      return null;
    }

    if (!user.isVerified) {
      throw new Error('USER_NOT_VERIFIED');
    }

    return user;
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

  async markUserLogin(userId: string): Promise<{ isFirstLogin: boolean }> {
    try {
      const user = await this.userRepository.findById(
        userId,
        //select: ['id', 'isNewUser'], // only what you need
      );

      if (!user) {
        throw new Error('User not found');
      }

      let isFirstLogin = false;

      if (user.isNewUser) {
        isFirstLogin = true;

        await this.userRepository.update(userId, {
          isNewUser: false, // flip after first login
          lastLoginAt: new Date(),
        });
      } else {
        await this.userRepository.update(userId, {
          lastLoginAt: new Date(),
        });
      }

      this.logger.log(
        `User ${userId} logged in at ${new Date()} (first login: ${isFirstLogin})`,
      );

      return { isFirstLogin };
    } catch (error) {
      this.logger.error(
        `Failed to mark login for user ${userId}: ${error.message}`,
      );

      return { isFirstLogin: false }; // safe fallback
    }
  }

  async markUserLoginold(userId: string): Promise<void> {
    try {
      await this.userRepository.update(userId, {
        lastLoginAt: new Date(),
      });
      this.logger.log(`User ${userId} logged in at ${new Date()}`);
    } catch (error) {
      this.logger.error(
        `Failed to mark login for user ${userId}: ${error.message}`,
      );
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

  async createOrGetOAuthUserold({
    email,
    firstName,
    lastName,
    provider,
    providerId,
    profilePicture,
    role, // already validated in authService
  }: {
    email?: string;
    firstName?: string;
    lastName?: string;
    provider: OAuthProviderType;
    providerId: string;
    profilePicture?: string;
    role?: UserRole; // now required because service guarantees default
  }) {
    this.logger.log(`Processing OAuth user for ${provider}:${providerId}`);

    try {
      /**
       * 1️⃣ Check if OAuth provider already exists
       */
      const existingProvider = await this.prisma.oAuthProvider.findUnique({
        where: {
          provider_providerId: {
            provider,
            providerId,
          },
        },
        include: { user: true },
      });

      if (existingProvider) {
        this.logger.log(
          `Existing OAuth provider found for user: ${existingProvider.user.id}`,
        );

        /**
         * 🔐 IMPORTANT:
         * Do NOT allow role change for existing users
         */

        const needsUpdate =
          (firstName && existingProvider.user.firstName !== firstName) ||
          (lastName && existingProvider.user.lastName !== lastName) ||
          (profilePicture &&
            existingProvider.user.profilePicture !== profilePicture);

        if (needsUpdate) {
          await this.prisma.user.update({
            where: { id: existingProvider.user.id },
            data: {
              firstName: firstName || existingProvider.user.firstName,
              lastName: lastName || existingProvider.user.lastName,
              profilePicture:
                profilePicture || existingProvider.user.profilePicture,
            },
          });
        }

        // Update last login
        await this.prisma.user.update({
          where: { id: existingProvider.user.id },
          data: { lastLoginAt: new Date() },
        });

        return existingProvider.user;
      }

      /**
       * 2️⃣ If provider not found but user exists by email → link provider
       */
      if (email) {
        const userByEmail = await this.prisma.user.findUnique({
          where: { email },
        });

        if (userByEmail) {
          this.logger.log(
            `Existing user found by email: ${userByEmail.id}. Linking provider.`,
          );

          /**
           * 🔐 SECURITY RULE:
           * Do NOT change role if user already exists
           */

          await this.prisma.oAuthProvider.create({
            data: {
              provider,
              providerId,
              userId: userByEmail.id,
              profileData: {
                firstName,
                lastName,
                profilePicture,
              },
            },
          });

          await this.prisma.user.update({
            where: { id: userByEmail.id },
            data: { lastLoginAt: new Date() },
          });

          return userByEmail;
        }
      }

      /**
       * 3️⃣ First-time OAuth signup → create new user
       * Role is safe because already validated in service
       */
      this.logger.log(`Creating new OAuth user with role: ${role}`);

      const newUser = await this.prisma.user.create({
        data: {
          email: email || null,
          firstName: firstName || 'User',
          lastName: lastName || '',
          profilePicture,
          role, // ✅ applied only on first creation
          isEmailVerified: !!email,
          isPhoneVerified: false,
          isVerified: !!email,
          status: !!email ? 'ACTIVE' : 'PENDING_EMAIL_VERIFICATION',
          lastLoginAt: new Date(),
          oauthProviders: {
            create: {
              provider,
              providerId,
              profileData: {
                firstName,
                lastName,
                profilePicture,
              },
            },
          },
        },
        include: {
          oauthProviders: true,
        },
      });

      this.logger.log(
        `New OAuth user created: ${newUser.id} (${newUser.email})`,
      );

      return newUser;
    } catch (error: any) {
      this.logger.error(
        `createOrGetOAuthUser error: ${error.message}`,
        error.stack,
      );

      /**
       * Handle Prisma unique constraint
       */
      if (error.code === 'P2002') {
        if (error.meta?.target?.includes('email')) {
          throw new ConflictException('User with this email already exists');
        }
      }

      throw error;
    }
  }

  /**
   * Create or get OAuth user with proper logging and error handling
   */

  async createOrGetOAuthUser({
    email,
    firstName,
    lastName,
    provider,
    providerId,
    profilePicture,
    role, // already validated
  }: {
    email?: string;
    firstName?: string;
    lastName?: string;
    provider: OAuthProviderType;
    providerId: string;
    profilePicture?: string;
    role?: UserRole;
  }) {
    this.logger.log(`Processing OAuth user for ${provider}:${providerId}`);

    try {
      // 1️⃣ Check if OAuth provider exists
      const existingProvider = await this.prisma.oAuthProvider.findUnique({
        where: { provider_providerId: { provider, providerId } },
        include: { user: true },
      });

      if (existingProvider) {
        const user = existingProvider.user;

        // Update profile info if changed
        const needsUpdate =
          (firstName && user.firstName !== firstName) ||
          (lastName && user.lastName !== lastName) ||
          (profilePicture && user.profilePicture !== profilePicture);

        if (needsUpdate) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: {
              firstName: firstName || user.firstName,
              lastName: lastName || user.lastName,
              profilePicture: profilePicture || user.profilePicture,
            },
          });
        }

        await this.prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return user;
      }

      // 2️⃣ If provider not found but user exists by email → link provider
      if (email) {
        const userByEmail = await this.prisma.user.findUnique({
          where: { email },
        });
        if (userByEmail) {
          await this.prisma.oAuthProvider.create({
            data: {
              provider,
              providerId,
              userId: userByEmail.id,
              profileData: { firstName, lastName, profilePicture },
            },
          });

          await this.prisma.user.update({
            where: { id: userByEmail.id },
            data: { lastLoginAt: new Date() },
          });

          return userByEmail;
        }
      }

      // 3️⃣ First-time OAuth signup → create new user
      const isVendor = role === UserRole.VENDOR;
      const newUser = await this.prisma.user.create({
        data: {
          email: email || null,
          firstName: firstName || 'User',
          lastName: lastName || '',
          profilePicture,
          role,
          isEmailVerified: !!email,
          isPhoneVerified: false, // always require phone verification for vendors
          status: isVendor
            ? UserStatus.PENDING_PHONE_VERIFICATION
            : !!email
              ? UserStatus.ACTIVE
              : UserStatus.PENDING_EMAIL_VERIFICATION,
          lastLoginAt: new Date(),
          oauthProviders: {
            create: {
              provider,
              providerId,
              profileData: { firstName, lastName, profilePicture },
            },
          },
        },
        include: { oauthProviders: true },
      });

      this.logger.log(
        `New OAuth user created: ${newUser.id} (${newUser.email})`,
      );
      return newUser;
    } catch (error: any) {
      this.logger.error(
        `createOrGetOAuthUser error: ${error.message}`,
        error.stack,
      );
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        throw new ConflictException('User with this email already exists');
      }
      throw error;
    }
  }
  /**
   * Attach OAuth provider to existing user
   */
  private async attachOAuthProvider(
    userId: string,
    provider: OAuthProviderType,
    providerId: string,
  ): Promise<void> {
    this.logger.debug(
      `Attaching OAuth provider ${provider}:${providerId} to user: ${userId}`,
    );

    try {
      await this.prisma.oAuthProvider.create({
        data: {
          userId,
          provider,
          providerId,
        },
      });

      this.logger.log(
        `OAuth provider attached successfully to user: ${userId}`,
      );
    } catch (error) {
      // If provider already exists, log and continue
      if (error.code === 'P2002') {
        this.logger.warn(`OAuth provider already exists for user: ${userId}`);
        return;
      }

      this.logger.error(
        `Failed to attach OAuth provider: ${error.message}`,
        error.stack,
      );
      throw error;
    }
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
        businessInfo: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  // async createOrUpdateProfile(
  //   userId: string,
  //   dto: CreateBusinessProfileDto,
  //   file?: Express.Multer.File,
  // ) {
  //   let logoUrl: string | undefined;

  //   if (file) {
  //     const uploadResult = await this.cloudinary.uploadLogo(file);
  //     logoUrl = uploadResult.secure_url;
  //   }

  //   const existingProfile = await this.prisma.businessInfo.findUnique({
  //     where: { userId },
  //   });

  //   const data = {
  //     businessName: dto.businessName,
  //     businessType: dto.businessType,
  //     phoneNumber: dto.phoneNumber,
  //     businessEmail: dto.businessEmail,
  //     address: dto.address,
  //     city: dto.city,
  //     state: dto.state,
  //     openingHours: dto.openingHours,
  //     shortDesc: dto.shortDescription,
  //     ...(logoUrl && { logoUrl }),
  //   };

  //   if (existingProfile) {
  //     return this.prisma.businessInfo.update({
  //       where: { userId },
  //       data,
  //     });
  //   }

  //   return this.prisma.businessInfo.upsert({
  //     where: { userId },
  //     update: data,
  //     create: {
  //       ...data,
  //       user: {
  //         connect: { id: userId },
  //       },
  //     },
  //   });
  // }

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

  /**
   * Complete Business Onboarding - Step 4 (Basic Info)
   */
  // async completeOnboarding(
  //   vendorId: string,
  //   dto: CompleteOnboardingDto,
  // ): Promise<{
  //   success: boolean;
  //   message: string;
  //   vendor: Partial<User>;
  //   businessInfo: BusinessInfo;
  // }> {
  //   this.logger.log(`Completing business info for vendor: ${vendorId}`);

  //   // Get vendor
  //   const vendor = await this.userRepository.findById(vendorId);
  //   if (!vendor) {
  //     throw new NotFoundException('Vendor not found');
  //   }

  //   // Check if both email and phone are verified
  //   if (!vendor.isEmailVerified || !vendor.isPhoneVerified) {
  //     throw new BadRequestException(
  //       'Please verify both email and phone before onboarding',
  //     );
  //   }

  // Create business info
  //     const businessInfo = await this.userRepository.createBusinessInfo({
  //       userId: vendor.id,
  //       businessName: dto.businessName,
  //       businessType: dto.businessType,
  //       address: dto.address,
  //       city: dto.city,
  //       state: dto.state,
  //       country: dto.country,
  //       businessEmail: dto.businessEmail,
  //       businessPhone: dto.businessPhone,
  // //      description: dto.description,
  //       //logoUrl: dto.logoUrl,
  //       //bannerUrl: dto.bannerUrl,
  //       //bankName: dto.bankName,
  //       //accountNumber: dto.accountNumber,
  //       //routingNumber: dto.routingNumber,
  //       //isVerified: false, // Business info needs admin review
  //     });

  // Update vendor status to pending documents
  // vendor.status = UserStatus.PENDING_DOCUMENTS;
  // const updatedVendor = await this.userRepository.update(vendor.id, vendor);

  // return {
  //   success: true,
  //   message: 'Business information saved. Please upload required documents.',
  //   vendor: {
  //     id: updatedVendor.id,
  //     email: updatedVendor.email,
  //     status: updatedVendor.status,
  //   },
  //   businessInfo,
  // };
  // }

  /**
   * Upload Single Document
   */
  //   async uploadDocument(
  //     vendorId: string,
  //     dto: UploadDocumentDto,
  //     file: Express.Multer.File,
  //   ): Promise<{
  //     success: boolean;
  //     message: string;
  //     document: VendorDocument;
  //   }> {
  //     this.logger.log(
  //       `Uploading document for vendor: ${vendorId}, type: ${dto.documentType}`,
  //     );

  //     // Validate vendor exists
  //     const vendor = await this.userRepository.findById(vendorId);
  //     if (!vendor) {
  //       throw new NotFoundException('Vendor not found');
  //     }

  //     // Check if vendor has completed business info
  //     if (
  //       vendor.status !== UserStatus.PENDING_DOCUMENTS &&
  //       vendor.status !== UserStatus.UNDER_REVIEW
  //     ) {
  //       throw new BadRequestException(
  //         'Please complete business information first',
  //       );
  //     }

  //     // Validate file
  //     if (!file) {
  //       throw new BadRequestException('File is required');
  //     }

  //     const uploadResult = await this.cloudinary.uploadFile(
  //   file,
  //   `vendors/${vendorId}/documents`,
  // );

  // const document = await this.userRepository.createDocument({
  //   userId: vendorId,
  //   documentType: dto.documentType,
  //   documentUrl: uploadResult.secure_url,
  //   publicId: uploadResult.public_id,
  //   originalName: file.originalname,
  //   mimeType: file.mimetype,
  //   size: file.size,
  //   isVerified: false,
  // });

  //     // // Upload to Cloudinary
  //     // const uploadResult = await this.uploadDocuments(file, {
  //     //   userId: vendorId,
  //     //   folder: `vendors/${vendorId}/documents`,
  //     //   resource_type: 'auto',

  //     // });

  //     // // Create document record
  //     // const document = await this.userRepository.createDocument({
  //     //   userId: vendorId,
  //     //   documentType: dto.documentType,
  //     //   documentUrl: uploadResult.secure_url,
  //     //   publicId: uploadResult.public_id,
  //     //   originalName: file.originalname,
  //     //   mimeType: file.mimetype,
  //     //   size: file.size,
  //     //   isVerified: false,
  //     // });

  //     // Check if all required documents are uploaded
  //     await this.checkAndUpdateOnboardingStatus(vendorId);

  //     return {
  //       success: true,
  //       message: 'Document uploaded successfully',
  //       document,
  //     };
  //   }

  /**
   * Upload Multiple Documents
   */
  //   async uploadDocuments(
  //     vendorId: string,
  //     dto: OnboardingDocumentsDto,
  //     files: Express.Multer.File[],
  //   ): Promise<{
  //     success: boolean;
  //     message: string;
  //     uploadedCount: number;
  //     documents: VendorDocument[];
  //   }> {
  //     this.logger.log(`Uploading multiple documents for vendor: ${vendorId}`);

  //     if (!files || files.length === 0) {
  //       throw new BadRequestException('No files provided');
  //     }

  //     // Validate vendor exists
  //     const vendor = await this.userRepository.findById(vendorId);
  //     if (!vendor) {
  //       throw new NotFoundException('Vendor not found');
  //     }

  //     // Check if vendor has completed business info
  //     if (
  //       vendor.status !== UserStatus.PENDING_DOCUMENTS &&
  //       vendor.status !== UserStatus.UNDER_REVIEW
  //     ) {
  //       throw new BadRequestException(
  //         'Please complete business information first',
  //       );
  //     }

  //     const uploadedDocuments: VendorDocument[] = [];

  //     // Upload each file
  //     for (const file of files) {
  //       try {
  //         // const uploadResult = await this.cloudinary.uploadDocument(file, {
  //         //   folder: `vendors/${vendorId}/documents`,
  //         //   resource_type: 'auto',
  //         // });
  //             const uploadResult = await this.cloudinary.uploadFile(
  //   file,
  //   `vendors/${vendorId}/documents`,
  // );

  //         // Determine document type from filename or dto
  //         const documentType = this.determineDocumentType(file.originalname, dto);

  //         const document = await this.userRepository.createDocument({
  //           userId: vendorId,
  //           documentType,
  //           documentUrl: uploadResult.secure_url,
  //           publicId: uploadResult.public_id,
  //           originalName: file.originalname,
  //           mimeType: file.mimetype,
  //           size: file.size,
  //           isVerified: false,
  //         });

  //         uploadedDocuments.push(document);
  //       } catch (error) {
  //         this.logger.error(
  //           `Failed to upload document ${file.originalname}: ${error.message}`,
  //         );
  //         // Continue with other files
  //       }
  //     }

  //     // Check if all required documents are uploaded
  //     await this.checkAndUpdateOnboardingStatus(vendorId);

  //     return {
  //       success: true,
  //       message: `${uploadedDocuments.length} document(s) uploaded successfully`,
  //       uploadedCount: uploadedDocuments.length,
  //       documents: uploadedDocuments,
  //     };
  //   }

  /**
   * Get Required Documents Status
   */
  // async getDocumentStatus(vendorId: string): Promise<{
  //   requiredDocuments: Array<{
  //     type: DocumentType;
  //     name: string;
  //     description: string;
  //     isUploaded: boolean;
  //     document?: VendorDocument;
  //   }>;
  //   status: string;
  //   isComplete: boolean;
  // }> {
  //   const vendor = await this.userRepository.findById(vendorId);
  //   if (!vendor) {
  //     throw new NotFoundException('Vendor not found');
  //   }

  //   const uploadedDocuments =
  //     await this.userRepository.getVendorDocuments(vendorId);

  //   const documentStatus = this.REQUIRED_DOCUMENTS.map((requiredType) => {
  //     const uploadedDoc = uploadedDocuments.find(
  //       (doc) => doc.documentType === requiredType,
  //     );

  //     return {
  //       type: requiredType,
  //       name: this.getDocumentName(requiredType),
  //       description: this.getDocumentDescription(requiredType),
  //       isUploaded: !!uploadedDoc,
  //       document: uploadedDoc || undefined,
  //     };
  //   });

  //   const allUploaded = documentStatus.every((doc) => doc.isUploaded);

  //   return {
  //     requiredDocuments: documentStatus,
  //     status: allUploaded ? 'All documents uploaded' : 'Documents pending',
  //     isComplete: allUploaded,
  //   };
  // }

  /**
   * Submit Documents for Review
   */
  // async submitForReview(vendorId: string): Promise<{
  //   success: boolean;
  //   message: string;
  //   vendor: Partial<User>;
  // }> {
  //   this.logger.log(`Submitting documents for review: ${vendorId}`);

  //   // Check if all required documents are uploaded
  //   const status = await this.getDocumentStatus(vendorId);
  //   if (!status.isComplete) {
  //     throw new BadRequestException(
  //       'Please upload all required documents before submission',
  //     );
  //   }

  //   // Update vendor status to under review
  //   const vendor = await this.userRepository.findById(vendorId);
  //   vendor.status = UserStatus.UNDER_REVIEW;
  //   vendor.onboardingCompletedAt = new Date();

  //   const updatedVendor = await this.userRepository.update(vendor.id, vendor);

  //   // Notify admin for review
  //   await this.notifyAdminForReview(updatedVendor);

  //   return {
  //     success: true,
  //     message:
  //       'Documents submitted for review. You will be notified once approved.',
  //     vendor: {
  //       id: updatedVendor.id,
  //       email: updatedVendor.email,
  //       status: updatedVendor.status,
  //       onboardingCompletedAt: updatedVendor.onboardingCompletedAt,
  //     },
  //   };
  // }

  // // Private helper methods
  // private async checkAndUpdateOnboardingStatus(
  //   vendorId: string,
  // ): Promise<void> {
  //   const status = await this.getDocumentStatus(vendorId);

  //   if (status.isComplete) {
  //     const vendor = await this.userRepository.findById(vendorId);
  //     if (vendor.status === UserStatus.PENDING_DOCUMENTS) {
  //       vendor.status = UserStatus.READY_FOR_REVIEW;
  //       await this.userRepository.update(vendor.id, vendor);

  //       this.logger.log(
  //         `All documents uploaded for vendor: ${vendorId}. Ready for review.`,
  //       );
  //     }
  //   }
  // }

  // private determineDocumentType(
  //   filename: string,
  //   dto: OnboardingDocumentsDto,
  // ): DocumentType {
  //   // Simple detection based on filename patterns
  //   const lowerFilename = filename.toLowerCase();

  //   if (
  //     lowerFilename.includes('registration') ||
  //     lowerFilename.includes('business')
  //   ) {
  //     return DocumentType.CAC;
  //   }
  //   if (
  //     lowerFilename.includes('permit') ||
  //     lowerFilename.includes('business')
  //   ) {
  //     return DocumentType.BUSINESS_PERMIT;
  //   }
  //   if (
  //     lowerFilename.includes('id') ||
  //     lowerFilename.includes('passport') ||
  //     lowerFilename.includes('license')
  //   ) {
  //     return DocumentType.ID_PROOF;
  //   }
  //   // if (lowerFilename.includes('bank') || lowerFilename.includes('statement')) {
  //   //   return DocumentType.BANK_STATEMENT;
  //   // }
  //   // if (
  //   //   lowerFilename.includes('utility') ||
  //   //   lowerFilename.includes('address')
  //   // ) {
  //   //   return DocumentType.UTILITY_BILL;
  //   // }

  //   // Default to other if cannot determine
  //   //return DocumentType.OTHER;
  // }

  private getDocumentName(documentType: DocumentType): string {
    const names = {
      [DocumentType.CAC]: 'Business Registration Certificate',
      [DocumentType.BUSINESS_PERMIT]: 'Tax Registration Certificate',
      [DocumentType.ID_PROOF]: 'Owner Identification',
    };
    return names[documentType];
  }

  private getDocumentDescription(documentType: DocumentType): string {
    const descriptions = {
      [DocumentType.CAC]: 'Official business registration document',
      [DocumentType.BUSINESS_PERMIT]: 'Tax registration or VAT certificate',
      [DocumentType.ID_PROOF]:
        "Government-issued ID (Passport, Driver's License)",
    };
    return descriptions[documentType];
  }

  private async notifyAdminForReview(vendor: User): Promise<void> {
    // Implementation for notifying admin
    this.logger.log(
      `Vendor ${vendor.email} has completed onboarding and is ready for review`,
    );
    // Add your notification logic here (email, Slack, etc.)
  }
}
