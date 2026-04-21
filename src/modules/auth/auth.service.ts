import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ConfigService } from '@nestjs/config';

import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetTokenDto,
} from './dto/password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  OAuthProviderType,
  OnBoardingStatus,
  Prisma,
  UserStatus,
  // VendorDocument,
} from '@prisma/client';
import Helper from '../../shared/utils/helpers';
import {
  AuthResponse,
  TokenPayload,
} from './interface/auth-response.interface';
import { User } from '../user/entities/user.entity';
import {
  DocumentType,
  UserRole,
  VerificationPurpose,
} from '../../shared/enums';
import { randomBytes } from 'crypto';
import { StringValue } from 'ms';
import { LoginCustomerDto } from './dto/login-customer.dto';
import { VerifyOtpDto } from '../verification/dto/verify-otp.dto';
import { VerificationService } from '../verification/verification.service';
import { VerificationCacheService } from '../verification/verification-cache.service';
import {
  CompleteOnboardingDto,
  CreateVendorDto,
  VendorDocumentDto,
  VendorDocumentMetadataDto,
  VerifyEmailDto,
  VerifyPhoneDto,
} from './dto/create-vendor.dto';
import { AbstractUserRepository } from '../user/repositories/abstract-user.repository';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { PrismaService } from '../../shared/services/prisma.service';
import { UploadDocumentDto } from '../user/dto/upload-document.dto';
import { RegisterResponseDto } from './dto/registration-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { AddPhoneDto } from './dto/add-phone-number.dto';
import { CreateAdminDto } from '../admin/dto/create-admin.dto';
import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { ResendVerificationTokenDto } from './dto/resend-token-expiry.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshTokenSecret: string;
  private readonly accessTokenExpiresIn: string | number;
  private readonly refreshTokenExpiresIn: string | number;
  private readonly refreshTokenRotationEnabled: boolean;
  private readonly passwordResetTokenExpiresIn: string;
  private readonly frontendUrl: string;

  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private config: ConfigService,
    private readonly verificationService: VerificationService,
    private readonly verificationCacheService: VerificationCacheService,
    private readonly cloudinary: CloudinaryService,
    private readonly userRepository: AbstractUserRepository,
    private readonly prisma: PrismaService,
  ) {
    this.refreshTokenSecret = this.config.get<string>('REFRESH_TOKEN_SECRET');
    this.accessTokenExpiresIn = this.config.get<string | number>(
      'JWT_EXPIRES_IN',
    );
    this.refreshTokenExpiresIn = this.config.get<string | number>(
      'REFRESH_TOKEN_EXPIRES_IN',
    );
    this.refreshTokenRotationEnabled =
      this.config.get<boolean>('REFRESH_TOKEN_ROTATION_ENABLED') || false;
    this.passwordResetTokenExpiresIn = this.config.get<string>(
      'PASSWORD_RESET_TOKEN_EXPIRES_IN',
      '15m',
    );

    this.frontendUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
  }

  /**
   * Create a new admin (only super_admin can do this)
   */
  async createAdmin(superAdminId: string, dto: CreateAdminDto) {
    this.logger.log(`Super admin ${superAdminId} creating new admin`);

    // Verify super admin exists and has correct role
    const superAdmin = await this.prisma.user.findUnique({
      where: { id: superAdminId },
    });

    if (!superAdmin || superAdmin.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only super admins can create admins');
    }

    // Check if user already exists
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
      },
    });

    if (user) {
      throw new BadRequestException(
        'User with this email or phone already exists',
      );
    }

    // Hash password
    const hashedPassword = await Helper.hashText(dto.password);

    // Create admin user
    const admin = await this.prisma.user.create({
      data: {
        email: dto.email,
        // phoneNumber: dto.phoneNumber,
        firstName: dto.firstName,
        lastName: dto.lastName,
        password: hashedPassword,
        role: UserRole.ADMIN,
        isActive: true,
        isVerified: true,
        verifiedAt: new Date(),
      },
      // select: {
      //   id: true,
      //   email: true,
      //   phoneNumber: true,
      //   firstName: true,
      //   lastName: true,
      //   role: true,
      //   createdAt: true,
      // },
    });

    this.logger.log(`Admin created: ${admin.email || admin.phoneNumber}`);

    // Issue JWT (reuse your existing method)
    // const auth = await this.generateAuthResponse(user);
    const identifier = null;
    const verificationMethod = null;

    // 8️⃣ Issue fresh token (optional but good)
    const auth = await this.generateAuthResponse(
      admin,
      identifier,
      verificationMethod,
    );

    const safeUser = {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: admin.role,
      createdAt: admin.createdAt,
    };

    return {
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      success: true,
      message: 'Admin created successfully',
      data: safeUser,
    };
  }

  async loginWithoutVerification(dto: { email: string; password: string }) {
    // Find super admin by email
    const admin = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        role: {
          in: [UserRole.SUPER_ADMIN, UserRole.ADMIN], // <-- allow both roles
        },
      },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check password
    const isPasswordValid = await Helper.compareHashedText(
      dto.password,
      admin.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT token
    // const payload = {
    //   sub: admin.id,
    //   email: admin.email,
    //   role: admin.role,
    // };

    // return this.generateAuthResponse(admin);

    const identifier = null;
    const verificationMethod = null;

    return this.generateAuthResponse(admin, identifier, verificationMethod);

    // const accessToken = this.jwtService.sign(payload);\
    // return {
    //   success: true,
    //   accessToken,
    //   user: {
    //     id: admin.id,
    //     email: admin.email,
    //     role: admin.role,
    //   },
    // };
  }

  async login(dto: { email: string; password: string }) {
    // Find admin
    const admin = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        role: {
          in: [UserRole.SUPER_ADMIN, UserRole.ADMIN],
        },
      },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!admin.isActive) {
      throw new ForbiddenException('Admin account is inactive');
    }

    // Check password
    const isPasswordValid = await Helper.compareHashedText(
      dto.password,
      admin.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    /**
     * =========================
     * 2FA FLOW (OTP + TOKEN)
     * =========================
     */

    // 🔐 Generate verification token (session)
    const verificationToken = this.jwtService.sign(
      {
        sub: admin.id,
        type: 'admin-2fa',
        purpose: VerificationPurpose.TWO_FACTOR,
      },
      {
        expiresIn: '10m',
      },
    );

    // 📩 Send OTP
    await this.verificationService.sendOtp({
      identifier: admin.email,
      purpose: VerificationPurpose.TWO_FACTOR,
    });

    this.logger.log(`Admin OTP sent: ${admin.email}`);

    return {
      status: 'OTP_REQUIRED',
      requiresVerification: true,

      verificationIdentifier: admin.email,
      verificationMethod: 'email',

      verificationToken, // 🔐 IMPORTANT ADDITION

      accessToken: null,
      refreshToken: null,
    };
  }

  async loginOld(dto: { email: string; password: string }) {
    // Find super admin by email
    const admin = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        role: {
          in: [UserRole.SUPER_ADMIN, UserRole.ADMIN], // <-- allow both roles
        },
      },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check password
    const isPasswordValid = await Helper.compareHashedText(
      dto.password,
      admin.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!admin.isActive) {
      throw new ForbiddenException('Admin account is inactive');
    }

    // -------------------------------------------------
    // STEP 1: Send OTP for verification
    // -------------------------------------------------

    await this.verificationService.sendOtp({
      identifier: admin.email,
      purpose: VerificationPurpose.TWO_FACTOR,
    });

    this.logger.log(`Admin OTP sent: ${admin.email}`);

    // const auth = await this.generateAuthResponse(admin);

    const identifier = null;
    const verificationMethod = null;

    const auth = await this.generateAuthResponse(
      admin,
      identifier,
      verificationMethod,
    );

    return {
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      status: 'OTP_REQUIRED',
      requiresVerification: true,
      verificationIdentifier: admin.email,
    };
  }

  /**
   * Register customer with automatic OTP
   */
  async registerCustomer(dto: CreateCustomerDto): Promise<RegisterResponseDto> {
    const registrationResponse = await this.userService.createCustomer(dto);

    const { user, requiresVerification } = registrationResponse;

    let verificationToken: string | null = null;

    if (user && requiresVerification) {
      verificationToken = this.jwtService.sign(
        { sub: user.id, type: 'verify' },
        { expiresIn: '10m' },
      );
    }

    return {
      accessToken: '', // ❌ NEVER issue here
      verificationToken,
      status: registrationResponse.status,
      requiresVerification,
      registrationMethod: registrationResponse.registrationMethod,
      verificationIdentifier: registrationResponse.verificationIdentifier,
      //role: user?.role ?? null,
      role: registrationResponse.user?.role as any,
    };
  }

  // async registerCustomerold(
  //   dto: CreateCustomerDto,
  // ): Promise<RegisterResponseDto> {
  //   const registrationResponse = await this.userService.createCustomer(dto);
  //   const identifier = null;
  //   const verificationMethod = null;

  //   // Only generate token if user exists
  //   const auth = registrationResponse.user
  //     ? //await this.generateAuthResponse(registrationResponse.user)
  //       await this.generateAuthResponse(
  //         registrationResponse.user,
  //         identifier,
  //         verificationMethod,
  //       )
  //     : null;

  //   return {
  //     accessToken: auth?.accessToken ?? '', // only available if user exists
  //     status: registrationResponse.status,
  //     requiresVerification: registrationResponse.requiresVerification,
  //     registrationMethod: registrationResponse.registrationMethod,
  //     verificationIdentifier: registrationResponse.verificationIdentifier,
  //     role: registrationResponse.user?.role as any,
  //   };
  // }

  // async registerCustomer(dto: CreateCustomerDto): Promise<RegisterResponseDto> {
  //   const { email, phoneNumber } = dto;

  //   this.logger.log(`Registering customer: ${email || phoneNumber}`);

  //   const registrationResponse = await this.userService.createCustomer({
  //     email: dto.email,
  //     phoneNumber: dto.phoneNumber,
  //     password: dto.password,
  //     firstName: dto.firstName,
  //     lastName: dto.lastName,
  //   });

  //   return {
  //     status: registrationResponse.status,
  //     requiresVerification: registrationResponse.requiresVerification,
  //     registrationMethod: registrationResponse.registrationMethod,
  //     verificationIdentifier: email || phoneNumber,
  //   };
  // }

  /**
   * Verify OTP during registration
   */
  async verifyRegistration(dto: VerifyOtpDto): Promise<AuthResponse> {
    const { identifier, verificationToken, otp } = dto;

    const isEmail = identifier.includes('@');

    const verificationMethod = isEmail ? 'email' : 'phone';

    // 1. Find user first
    //const user = await this.userService.findUserForPasswordReset(identifier);
    const user = await this.userService.findUserByIdentifier(identifier);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    let userId: string;

    // 2. If NOT SUPER_ADMIN → require token
    if (user.role !== 'SUPER_ADMIN') {
      if (!verificationToken) {
        throw new UnauthorizedException('Verification token is required');
      }

      let payload: any;

      try {
        payload = this.jwtService.verify(verificationToken);
      } catch (err) {
        throw new UnauthorizedException(
          'Invalid or expired verification token',
        );
      }

      if (payload.type !== 'verify') {
        throw new UnauthorizedException('Invalid token type');
      }

      userId = payload.sub;
    } else {
      // 3. SUPER_ADMIN bypass
      userId = user.id;
    }

    // 4. Verify OTP
    const result = await this.userService.verifyUser(userId, identifier, otp);

    if (!result.success || !result.user) {
      throw new UnauthorizedException('Invalid OTP');
    }

    return this.generateAuthResponse(
      result.user,
      identifier,
      verificationMethod,
    );
  }

  async verifyRegistrationWorking(dto: VerifyOtpDto): Promise<AuthResponse> {
    const { identifier, verificationToken, otp } = dto;

    let payload: any;

    try {
      payload = this.jwtService.verify(verificationToken);
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    if (payload.type !== 'verify') {
      throw new UnauthorizedException('Invalid token type');
    }

    const userId = payload.sub;

    const result = await this.userService.verifyUser(userId, identifier, otp);

    if (!result.success || !result.user) {
      throw new UnauthorizedException('Invalid OTP');
    }

    // ✅ ONLY NOW issue access token
    // return this.generateAuthResponse(result.user);
    const verificationMethod = null;

    return this.generateAuthResponse(
      result.user,
      identifier,
      verificationMethod,
    );
  }
  // async verifyRegistration(userId: string, dto: VerifyOtpDto) {
  //   const { identifier, otp } = dto;

  //   const result = await this.userService.verifyUser(userId, identifier, otp);

  //   if (!result.success || !result.user) {
  //     throw new UnauthorizedException('Invalid OTP');
  //   }

  //   //return this.generateAuthResponse(result.user);
  //   const verificationMethod = null;

  //   return this.generateAuthResponse(
  //     result.user,
  //     identifier,
  //     verificationMethod,
  //   );
  // }

  // async verifyRegistrationold(dto: VerifyOtpDto) {
  //   const { identifier, otp } = dto;

  //   const result = await this.userService.verifyUser(identifier, otp);

  //   if (!result.success || !result.user) {
  //     throw new UnauthorizedException('Invalid OTP');
  //   }

  //   // Generate tokens after successful verification
  //   return this.generateAuthResponse(result.user);
  // }

  async resendVerificationToken(dto: ResendVerificationTokenDto) {
    const { identifier } = dto;

    // 1. Find user (must allow unverified users)
    const user = await this.userService.findUserByIdentifier(identifier);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is inactive');
    }

    // 2. If already verified → no need to resend
    if (user.isVerified) {
      return {
        message: 'User already verified',
        requiresVerification: false,
      };
    }

    // 3. Resend OTP (reuse your verification service)
    const otpResult = await this.verificationService.sendOtp({
      identifier,
    });

    // 4. Generate NEW verification token
    const verificationToken = this.jwtService.sign(
      {
        sub: user.id,
        type: 'verify',
        iat: Date.now(),
      },
      {
        expiresIn: '10m',
      },
    );

    return {
      message: 'Verification token resent successfully',
      verificationToken,
      verificationIdentifier: identifier,
      requiresVerification: true,
      otpExpiresAt: otpResult.expiresAt,
    };
  }

  /**
   * Login - user with email/phone and password - only works for verified users
   */
  async loginCustomer(loginDto: LoginCustomerDto) {
    const { email, phoneNumber } = loginDto;

    const identifier = email || phoneNumber;
    const verificationMethod = email ? 'email' : 'phone';

    this.logger.log(`Login attempt: ${identifier}`);

    const result = await this.userService.authenticateUser(
      loginDto,
      identifier,
      verificationMethod,
    );

    // 👇 Proper type narrowing
    if (!result.success) {
      return result;
    }

    // 👇 Now result is { success: true; user: User }
    return this.generateAuthResponse(
      result.user,
      identifier,
      verificationMethod,
    );
  }
  // async loginCustomerOld(loginDto: LoginCustomerDto) {
  //   const { email, phoneNumber } = loginDto;
  //   const identifier = email || phoneNumber;

  //   this.logger.log(`Login attempt: ${identifier}`);

  //   // This will throw if user is not verified
  //   const user = await this.userService.authenticateUser(loginDto);

  //   // Check if user is verified (redundant but safe)
  //   if (!user.isVerified) {
  //     throw new UnauthorizedException(
  //       'Account not verified. Please verify your account.',
  //     );
  //   }

  //   //return this.generateAuthResponse(user);
  //   const verificationMethod = null;

  //   return this.generateAuthResponse(user, identifier, verificationMethod);
  // }

  /**
   * Login user with email/phone and password
   */
  // async loginCustomer2(loginDto: LoginCustomerDto): Promise<AuthResponse> {
  //   const { email, phoneNumber } = loginDto;
  //   const identifier = email || phoneNumber;

  //   this.logger.log(`Login attempt: ${identifier}`);

  //   // Delegate authentication to UserService
  //   const user = await this.userService.authenticateUser(loginDto);

  //   // return this.generateAuthResponse(user);

  //   const verificationMethod = null;

  //   return this.generateAuthResponse(user, identifier, verificationMethod);
  // }

  /**
   * Resend OTP for registration
   */
  async resendCustomerOtp(identifier: string) {
    const result = await this.userService.resendVerificationOtp(identifier);

    if (!result.success) {
      throw new UnauthorizedException(result.message);
    }

    return {
      success: true,
      message: 'OTP sent successfully',
    };
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto): Promise<AuthResponse> {
    const { refreshToken } = refreshTokenDto;

    this.logger.log(`Refresh token attempt`);

    try {
      // 1️⃣ Verify token
      let payload;
      try {
        payload = this.jwtService.verify(refreshToken, {
          secret: this.refreshTokenSecret,
        });
        this.logger.log(`JWT payload verified: ${JSON.stringify(payload)}`);
      } catch (err) {
        this.logger.error(`JWT verification failed: ${err.message}`);
        throw new UnauthorizedException('Invalid credentials');
      }

      // 2️⃣ Find user
      const user = await this.userService.findById(payload.sub);
      if (!user) {
        this.logger.warn(
          `Refresh attempt failed: user not found for id ${payload.sub}`,
        );
        throw new UnauthorizedException('Invalid credentials');
      }
      this.logger.log(`User fetched: ${JSON.stringify(user)}`);

      // 3️⃣ Role-specific checks
      switch (user.role) {
        case 'CUSTOMER':
          if (!user.isActive) {
            this.logger.warn(`Inactive customer: ${user.id}`);
            throw new UnauthorizedException('Account is deactivated');
          }
          if (!user.isVerified) {
            this.logger.warn(`Unverified customer: ${user.id}`);
            throw new UnauthorizedException(
              'Account not verified. Please verify your email/phone.',
            );
          }
          break;

        case 'VENDOR':
          if (!user.approvedAt || user.status !== 'APPROVED') {
            this.logger.warn(`Unapproved/inactive vendor: ${user.id}`);
            throw new UnauthorizedException(
              'Vendor account not approved or inactive',
            );
          }
          break;

        case 'ADMIN':
          if (!user.isActive) {
            this.logger.warn(`Inactive admin: ${user.id}`);
            throw new UnauthorizedException('Admin account is deactivated');
          }
          // You can add extra checks for admin if needed
          break;

        default:
          this.logger.warn(`Unknown role: ${user.role} for user ${user.id}`);
          throw new UnauthorizedException('Invalid credentials');
      }

      // 4️⃣ Validate refresh token (rotation security)
      if (this.refreshTokenRotationEnabled && user.refreshTokenHash) {
        const isValid = await bcrypt.compare(
          refreshToken,
          user.refreshTokenHash,
        );
        if (!isValid) {
          this.logger.warn(
            `Invalid refresh token reuse detected for user: ${user.id}`,
          );
          await this.userService.updateRefreshToken(user.id, null);
          throw new UnauthorizedException('Invalid credentials');
        }
      }

      // 5️⃣ Generate new tokens
      // const authResponse = await this.generateAuthResponse(user);
      const verificationMethod = null;
      const identifier = null;
      const authResponse = await this.generateAuthResponse(
        user,
        identifier,
        verificationMethod,
      );
      this.logger.log(
        `Tokens refreshed for user: ${user.id} (role: ${user.role})`,
      );

      return authResponse;
    } catch (error) {
      this.logger.error(`Refresh failed: ${error.message}`);
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  async logout(userId: string): Promise<void> {
    this.logger.log(`Logging out user: ${userId}`);
    await this.userService.updateRefreshToken(userId, null);
  }

  private async generateAuthResponse(
    user: User,
    identifier: string,
    verificationMethod: 'email' | 'phone',
  ): Promise<AuthResponse> {
    const tokens = await this.generateTokens(user);

    if (this.refreshTokenRotationEnabled) {
      const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 12);
      await this.userService.updateRefreshToken(user.id, refreshTokenHash);
    }

    const loginMeta = await this.userService.markUserLogin(user.id);

    return {
      ...tokens,
      identifier,
      verificationMethod,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isNewUser: loginMeta.isFirstLogin,
      },
    };
  }

  private async generateAuthResponseOld(user: User): Promise<AuthResponse> {
    const tokens = await this.generateTokens(user);

    // Hash and store refresh token if rotation is enabled
    if (this.refreshTokenRotationEnabled) {
      const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 12);
      await this.userService.updateRefreshToken(user.id, refreshTokenHash);
    }

    // await this.userService.markUserLogin(user.id);
    const loginMeta = await this.userService.markUserLogin(user.id);

    return {
      ...tokens,
      identifier: null,
      verificationMethod: null,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isNewUser: loginMeta.isFirstLogin,
      },
    };
  }

  private async generateTokens(user: User) {
    const accessTokenPayload = this.createAccessTokenPayload(user);
    const refreshTokenPayload = this.createRefreshTokenPayload(user);

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessTokenPayload as any, {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: this.accessTokenExpiresIn as any,
      }),
      this.jwtService.signAsync(refreshTokenPayload as any, {
        secret: this.refreshTokenSecret,
        expiresIn: this.refreshTokenExpiresIn as any, // e.g., '7d'
      }),
    ]);

    return { accessToken, refreshToken };
  }

  /**
   * Generate JWT reset token
   */
  private createPasswordResetTokenPayload(user: User) {
    return {
      userId: user.id,
      type: 'password_reset',
      jti: randomBytes(16).toString('hex'),
    };
  }

  private async generateResetToken(user: User): Promise<string> {
    const payload = this.createPasswordResetTokenPayload(user);

    return this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: this.passwordResetTokenExpiresIn as number | StringValue,
    });
  }

  private createAccessTokenPayload(user: User): TokenPayload {
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };
  }

  private createRefreshTokenPayload(user: User): TokenPayload {
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'refresh',
      jti: randomBytes(16).toString('hex'), // Unique token identifier
    };
  }

  private async rotateRefreshToken(
    userId: string,
    oldRefreshToken: string,
    newRefreshToken: string,
  ): Promise<void> {
    // Store old token in blacklist or database for short period
    // This prevents replay attacks
    const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 12);
    await this.userService.updateRefreshToken(userId, newRefreshTokenHash);

    // Optional: Store old token hash in blacklist
    this.logger.log(`Refresh token rotated for user: ${userId}`);
  }

  ////////////////////////////////////////////////////

  async createCustomer(dto: CreateCustomerDto) {
    const { email, password } = dto;
    const existing = await this.userService.findByEmail(email);
    if (existing) throw new BadRequestException('Email already in use');
    const hashedPassword = await Helper.hashText(password);

    const user = await this.userService.createUser(dto, hashedPassword);
    return this.signJwt(user);
  }

  async validateUser(email: string, pass: string) {
    const user = await this.userService.findByEmail(email);
    if (!user || !user.password) return null;

    const match = await bcrypt.compare(pass, user.password);
    if (!match) return null;

    const { password, ...rest } = user;
    return rest;
  }

  // async login(dto: LoginDto) {
  //   const { email, password } = dto;
  //   const user = await this.validateUser(email, password);
  //   if (!user) throw new UnauthorizedException('Invalid credentials');

  //   return this.signJwt(user);
  // }

  private signJwt(user: any) {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET not configured');

    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret,
      expiresIn: this.config.get('JWT_EXPIRES_IN'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret,
      expiresIn: this.config.get('REFRESH_TOKEN_EXPIRES_IN'),
    });

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  /* ---------- Forgot Password flow ---------- */

  /**
   * Verify password reset OTP using Redis cache
   */
  async verifyPasswordResetOtp(otp: string): Promise<{
    valid: boolean;
    identifier?: string;
    userId?: string;
    requiresNewPassword?: boolean;
  }> {
    this.logger.log(`Verifying password reset OTP: ${otp}`);

    try {
      // Get identifier from OTP using Redis lookup
      const identifier =
        await this.verificationCacheService.getIdentifierByOtp(otp);

      if (!identifier) {
        this.logger.debug(`No identifier found for OTP: ${otp}`);
        return { valid: false };
      }

      // Get OTP status from cache
      const otpStatus =
        await this.verificationCacheService.getOtpStatus(identifier);

      if (!otpStatus.exists || otpStatus.expired || otpStatus.verified) {
        this.logger.debug(`OTP invalid for identifier: ${identifier}`);
        return { valid: false };
      }

      // Find user by identifier
      // const user = await this.userService.findUserByIdentifier(identifier);
      const user = await this.userService.findUserForPasswordReset(identifier);
      if (!user || !user.isActive) {
        this.logger.warn(
          `User not found or inactive for identifier: ${identifier}`,
        );
        return { valid: false };
      }

      // Check if user is verified (they should be for password reset)
      if (!user.isVerified) {
        this.logger.warn(
          `Unverified user attempting password reset: ${user.id}`,
        );
        return {
          valid: true,
          identifier: identifier,
          userId: user.id,
          requiresNewPassword: true,
        };
      }

      return {
        valid: true,
        identifier: identifier,
        userId: user.id,
        requiresNewPassword: true,
      };
    } catch (error) {
      this.logger.error(`Error verifying password reset OTP: ${error.message}`);
      return { valid: false };
    }
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{
    success: boolean;
    message: string;
    identifier?: string;
    method?: 'email' | 'sms';
  }> {
    const { email, phoneNumber } = dto;
    const identifier = email || phoneNumber;

    this.logger.log(`Password reset requested for: ${identifier}`);

    let user: User | null;

    try {
      user = await this.userService.findUserForPasswordReset(identifier);
    } catch (err) {
      if (err.message === 'USER_NOT_VERIFIED') {
        return {
          success: false,
          message:
            'Please verify your account first before resetting password.',
        };
      }
      throw err;
    }

    // Security: always return success if user not found/inactive
    if (!user) {
      this.logger.debug(`User not eligible for password reset: ${identifier}`);
      return {
        success: true,
        message:
          'If an account exists with this email/phone, you will receive reset instructions.',
      };
    }

    const resetToken = await this.generateResetToken(user);
    const method = email ? 'email' : 'sms';

    try {
      if (method === 'email' && user.email) {
        await this.sendPasswordResetEmail(user, resetToken);
      } else if (method === 'sms' && user.phoneNumber) {
        await this.sendPasswordResetSms(user, resetToken);
      } else {
        throw new Error(`No ${method} available for user ${user.id}`);
      }

      this.logger.log(
        `Password reset ${method} sent to ${identifier} for user ${user.id}`,
      );

      return {
        success: true,
        message: 'Password reset instructions sent successfully.',
        identifier,
        method,
      };
    } catch (error) {
      this.logger.error(
        `Failed to send password reset ${method}: ${error.message}`,
      );
      return {
        success: false,
        message: 'Failed to send reset instructions. Please try again later.',
      };
    }
  }

  /**
   * Send password reset email with OTP
   */
  private async sendPasswordResetEmail(
    user: User,
    resetToken: string,
  ): Promise<void> {
    const resetLink = `${this.frontendUrl}/reset/reset-password?token=${resetToken}`;
    const expiresInHours = this.parseExpiresInToHours(
      this.passwordResetTokenExpiresIn,
    );

    const subject = 'Reset Your Password';
    const html = this.generateResetEmailHtml(
      user.firstName,
      resetLink,
      expiresInHours,
    );

    // Use verification service email provider
    await this.verificationService.emailProvider.sendEmail(
      user.email!,
      subject,
      `Click here to reset your password: ${resetLink}`,
      html,
    );

    // Also send OTP via email for additional security
    await this.verificationService.sendOtp({
      identifier: user.email!,
      purpose: VerificationPurpose.PASSWORD_RESET,
    });
  }

  /**
   * Send password reset SMS with OTP
   */
  private async sendPasswordResetSms(
    user: User,
    resetToken: string,
  ): Promise<void> {
    // For SMS, we'll send an OTP instead of a link
    await this.verificationService.sendOtp({
      identifier: user.phoneNumber!,
      purpose: VerificationPurpose.PASSWORD_RESET,
    });

    // Optional: Send SMS with short instructions
    const message = `You requested a password reset. Use the OTP sent to complete the process.`;
    await this.verificationService.smsProvider.sendSms(
      user.phoneNumber!,
      message,
    );
  }

  /**
   * Verify reset token (for both link tokens and OTP)
   */
  async verifyResetToken(dto: VerifyResetTokenDto): Promise<{
    valid: boolean;
    userId?: string;
    requiresOtp?: boolean;
    identifier?: string;
  }> {
    const { token } = dto;

    try {
      // Try to verify as JWT token first (from email link)
      try {
        const decoded = this.jwtService.verify(token);
        if (decoded?.userId && decoded?.type === 'password_reset') {
          return {
            valid: true,
            userId: decoded.userId,
          };
        }
      } catch (jwtError) {
        // Not a valid JWT, might be an OTP
        this.logger.debug(`Token is not a JWT, checking as OTP`);
      }

      // Check if token is an OTP
      // We need to find which identifier this OTP belongs to
      // This requires storing OTP-to-identifier mapping
      const isValidOtp = await this.verifyPasswordResetOtp(token);

      if (isValidOtp) {
        return {
          valid: true,
          requiresOtp: false, // OTP already verified
        };
      }

      return { valid: false };
    } catch (error) {
      this.logger.error(`Reset token verification failed: ${error.message}`);
      return { valid: false };
    }
  }

  /**
   * Reset password with token/OTP
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{
    success: boolean;
    message: string;
  }> {
    const { token, newPassword } = dto;

    this.logger.log('Processing password reset request');

    let userId: string | undefined;
    let requiresOtp = false;
    let identifier: string | undefined;

    // Try to decode as JWT token first
    try {
      const decoded = this.jwtService.verify(token);
      if (decoded?.userId && decoded?.type === 'password_reset') {
        userId = decoded.userId;
      }
    } catch (jwtError) {
      // Not a JWT, check if it's an OTP
      requiresOtp = true;
    }

    // If it's an OTP, we need to verify it and get the user identifier
    if (requiresOtp) {
      const otpResult = await this.handleOtpPasswordReset(token, newPassword);
      return otpResult;
    }

    // Handle JWT token password reset
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    // Verify user exists and is active
    const user = await this.userService.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await this.userService.updatePassword(userId, hashedPassword);

    // Invalidate all user sessions (optional)
    await this.userService.updateRefreshToken(userId, null);

    // Send confirmation notification
    await this.sendPasswordResetConfirmation(user);

    this.logger.log(`Password reset successful for user: ${userId}`);

    return {
      success: true,
      message: 'Password has been reset successfully.',
    };
  }

  /**
   * Handle password reset with OTP
   */
  private async handleOtpPasswordReset(
    otp: string,
    newPassword: string,
  ): Promise<{ success: boolean; message: string }> {
    // This requires additional implementation to map OTP to user
    // For now, we'll require the user to also provide their identifier

    throw new BadRequestException(
      'OTP-based reset requires additional verification. Please use the reset link from your email.',
    );
  }

  /**
   * Alternative: Reset password with OTP and identifier
   */
  async resetPasswordWithOtp(dto: {
    identifier: string;
    otp: string;
    newPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    const { identifier, otp, newPassword } = dto;

    this.logger.log(`Processing OTP password reset for: ${identifier}`);

    // Verify OTP
    const isValid = await this.verificationService.verifyOtp({
      identifier,
      otp,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    // Find user
    const user = await this.userService.findUserForPasswordReset(identifier);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await this.userService.updatePassword(user.id, hashedPassword);

    // Clear OTP after use
    await this.verificationService.clearOtp(identifier);

    // Send confirmation
    await this.sendPasswordResetConfirmation(user);

    this.logger.log(`Password reset via OTP successful for user: ${user.id}`);

    return {
      success: true,
      message: 'Password has been reset successfully.',
    };
  }

  /**
   * Send password reset confirmation
   */
  private async sendPasswordResetConfirmation(user: User): Promise<void> {
    try {
      const subject = 'Password Reset Successful';
      const message = `Your password was successfully reset at ${new Date().toLocaleString()}.`;

      if (user.email) {
        await this.verificationService.emailProvider.sendEmail(
          user.email,
          subject,
          message,
          `<p>${message}</p><p>If you didn't make this change, please contact support immediately.</p>`,
        );
      }

      if (user.phoneNumber) {
        await this.verificationService.smsProvider.sendSms(
          user.phoneNumber,
          `Password reset successful. If you didn't make this change, contact support.`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to send reset confirmation: ${error.message}`);
      // Non-critical error
    }
  }

  /**
   * Generate reset email HTML
   */
  private generateResetEmailHtml(
    name: string,
    resetLink: string,
    expiresInHours: number,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; }
          .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px; background-color: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background-color: #4F46E5; 
                   color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          .warning { color: #dc2626; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset</h1>
          </div>
          <div class="content">
            <p>Hello ${name},</p>
            <p>You requested to reset your password. Click the button below to proceed:</p>
            <p style="text-align: center;">
              <a href="${resetLink}" class="button">Reset Password</a>
            </p>
            <p>Or copy and paste this link in your browser:</p>
            <p><code>${resetLink}</code></p>
            <p class="warning">This link will expire in ${expiresInHours} hour(s).</p>
            <p>If you didn't request this reset, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Your Company. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Parse expiresIn string to hours
   */
  private parseExpiresInToHours(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([hmd])$/);
    if (!match) return 1;

    const [, value, unit] = match;
    const numValue = parseInt(value);

    switch (unit) {
      case 'h':
        return numValue;
      case 'm':
        return numValue / 60;
      case 'd':
        return numValue * 24;
      default:
        return 1;
    }
  }

  /* ---------- OAuth (Google) ---------- */
  async validateOAuthLogin({ provider, providerId, email, name }: any) {
    // find or create user using UsersService
    const user = await this.userService.createOrGetOAuthUser({
      provider,
      providerId,
      email,
      firstName: name?.firstName,
      lastName: name?.lastName,
    });

    // sign token
    return this.signJwt(user);
  }

  /* ---------- OAuth (Google) ---------- */
  // async handleOAuthCallback(profile: any, provider: OAuthProviderType) {

  async handleOAuthCallback(
    profile: any,
    provider: OAuthProviderType,
    requestedRole?: UserRole,
  ) {
    if (!profile?.email)
      throw new BadRequestException('OAuth account has no email');

    const allowedRoles: UserRole[] = [UserRole.CUSTOMER, UserRole.VENDOR];
    if (requestedRole && !allowedRoles.includes(requestedRole)) {
      throw new ForbiddenException('You cannot assign this role');
    }

    const user = await this.userService.createOrGetOAuthUser({
      email: profile.email,
      firstName: profile.firstName || profile.givenName,
      lastName: profile.lastName || profile.familyName,
      provider,
      providerId: profile.providerId,
      profilePicture: profile.picture,
      role: requestedRole,
    });

    // Determine next action for UI guidance
    let nextAction = 'Complete onboarding';
    if (user.role === UserRole.VENDOR && !user.isPhoneVerified) {
      nextAction = 'Verify your phone number to start onboarding';
    } else if (!user.isEmailVerified) {
      nextAction = 'Verify your email address';
    }

    // ✅ If NOT vendor → return normal auth tokens
    if (user.role !== UserRole.VENDOR) {
      const verificationMethod = null;
      const identifier = null;

      const auth = await this.generateAuthResponse(
        user,
        identifier,
        verificationMethod,
      );

      return {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        user: {
          id: user.id,
          email: user.email,
          phoneNumber: user.phoneNumber,
          status: user.status,
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified,
          onboardingStatus: user.onboardingStatus,
          onboardingStep: user.onboardingStep,
        },
        nextAction,
      };
    }

    // ✅ If VENDOR → return verificationToken instead
    let verificationToken: string | null = null;

    if (!user.isEmailVerified || !user.isPhoneVerified) {
      verificationToken = this.jwtService.sign(
        { sub: user.id, type: 'verify' },
        { expiresIn: '10m' },
      );
    }

    return {
      success: true,
      message:
        'Vendor authentication successful. Please complete verification.',
      verificationToken,
      user: {
        id: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        status: user.status,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
        onboardingStatus: user.onboardingStatus,
        onboardingStep: user.onboardingStep,
      },

      nextSteps: [
        'Verify your phone number',
        'Verify your email address',
        'Complete onboarding',
      ],

      nextAction,
    };
  }

  async handleOAuthCallbackOldWorking(
    profile: any,
    provider: OAuthProviderType,
    requestedRole?: UserRole,
  ) {
    if (!profile?.email)
      throw new BadRequestException('OAuth account has no email');

    const allowedRoles: UserRole[] = [UserRole.CUSTOMER, UserRole.VENDOR];
    if (requestedRole && !allowedRoles.includes(requestedRole)) {
      throw new ForbiddenException('You cannot assign this role');
    }

    const user = await this.userService.createOrGetOAuthUser({
      email: profile.email,
      firstName: profile.firstName || profile.givenName,
      lastName: profile.lastName || profile.familyName,
      provider,
      providerId: profile.providerId,
      profilePicture: profile.picture,
      role: requestedRole,
    });

    // Determine next action for UI guidance
    let nextAction = 'Complete onboarding';
    if (user.role === UserRole.VENDOR && !user.isPhoneVerified) {
      nextAction = 'Verify your phone number to start onboarding';
    } else if (!user.isEmailVerified) {
      nextAction = 'Verify your email address';
    }

    // Issue JWT (reuse your existing method)
    //const auth = await this.generateAuthResponse(user);
    const verificationMethod = null;
    const identifier = null;
    const auth = await this.generateAuthResponse(
      user,
      identifier,
      verificationMethod,
    );
    return {
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        status: user.status,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
        onboardingStatus: user.onboardingStatus,
        onboardingStep: user.onboardingStep,
      },
      nextAction,
    };
  }

  /**
   * Handle OAuth callback from Google/Facebook/etc
   */
  async handleOAuthCallbackWithoutParam(
    profile: any,
    provider: OAuthProviderType,
  ) {
    this.logger.log(`Processing OAuth callback for ${provider}`);

    if (!profile?.email) {
      this.logger.error(
        `${provider} account has no email: ${JSON.stringify(profile)}`,
      );
      throw new BadRequestException(`${provider} account has no email`);
    }

    this.logger.debug(
      `OAuth profile received: ${JSON.stringify({
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        provider,
        providerId: profile.providerId,
      })}`,
    );

    try {
      // Call existing helper in UserService
      const user = await this.userService.createOrGetOAuthUser({
        email: profile.email,
        firstName: profile.firstName || profile.givenName,
        lastName: profile.lastName || profile.familyName,
        provider,
        providerId: profile.providerId,
        profilePicture: profile.picture,
      });

      this.logger.log(
        `OAuth user processed successfully: ${user.id} (${user.email})`,
      );

      // Sign JWT (same as manual signup)
      //  return this.generateAuthResponse(user);
      const verificationMethod = null;
      const identifier = null;
      return this.generateAuthResponse(user, identifier, verificationMethod);
    } catch (error) {
      this.logger.error(
        `Failed to process OAuth callback: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  //////VENDOR//////
  /**
   * Vendor Registration - Step 1
   */
  async registerUser(dto: CreateUserDto, role: UserRole): Promise<any> {
    this.logger.log(`Registering ${role}: ${dto.email}`);

    // ✅ Normalize phone FIRST
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

    // ✅ Use normalized phone for duplicate check
    await this.checkExistingUser(dto.email, dto.phoneNumber);

    const hashedPassword = await Helper.hashText(dto.password);

    const user = await this.userRepository.create({
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      countryCode: dto.countryCode,
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role,
      status: UserStatus.PENDING_EMAIL_VERIFICATION,
      isNewUser: true,
    });

    // ✅ Send OTPs (email + phone)
    await this.sendInitialUserVerificationOtps(user);

    // ✅ Generate verification token (LIKE CUSTOMER FLOW)
    let verificationToken: string | null = null;

    if (user && user.status === UserStatus.PENDING_EMAIL_VERIFICATION) {
      verificationToken = this.jwtService.sign(
        { sub: user.id, type: 'verify' },
        { expiresIn: '10m' },
      );
    }

    // ❌ DO NOT generate auth tokens here
    // const auth = await this.generateAuthResponse(...); ← removed

    return {
      success: true,
      message: `${role} registration successful. Please verify your email and phone.`,

      // ✅ ONLY verification token
      verificationToken,

      user: {
        id: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        status: user.status,
        role: user.role,
      },

      nextSteps: [
        'Check your email for verification code',
        'Check your phone for verification code',
        'Verify phone first, then email',
      ],
    };
  }

  async registerVendorold(dto: CreateVendorDto): Promise<{
    success: boolean;
    message: string;
    vendor: Partial<User>;
    nextSteps: string[];
  }> {
    this.logger.log(`Registering vendor: ${dto.email}`);

    // Check if vendor already exists
    await this.checkExistingVendor(dto.email, dto.phoneNumber);

    // Hash password
    const hashedPassword = await Helper.hashText(dto.password);

    // Create vendor with pending verification status
    const vendor = await this.userRepository.create({
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: UserRole.VENDOR,
      status: UserStatus.PENDING_EMAIL_VERIFICATION,
    });

    // Send verification OTPs to both email and phone
    await this.sendInitialVerificationOtps(vendor);

    return {
      success: true,
      message:
        'Vendor registration successful. Please verify your email and phone.',
      vendor: {
        id: vendor.id,
        email: vendor.email,
        phoneNumber: vendor.phoneNumber,
        status: vendor.status,
      },
      nextSteps: [
        'Check your email for verification code',
        'Check your phone for verification code',
        'Verify phone first, then email',
        'Complete business onboarding after both verifications',
      ],
    };
  }

  async registerUserold2(dto: CreateUserDto, role: UserRole): Promise<any> {
    this.logger.log(`Registering ${role}: ${dto.email}`);

    // ✅ Normalize phone FIRST
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

    // ✅ Use normalized phone for duplicate check
    await this.checkExistingUser(dto.email, dto.phoneNumber);

    const hashedPassword = await Helper.hashText(dto.password);

    const user = await this.userRepository.create({
      email: dto.email,
      phoneNumber: dto.phoneNumber, // ✅ normalized
      countryCode: dto.countryCode, // ✅ stored
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role,
      status: UserStatus.PENDING_EMAIL_VERIFICATION,
    });

    await this.sendInitialUserVerificationOtps(user);

    // ✅ Token generation stays unchanged
    // const auth = await this.generateAuthResponse(user);
    const verificationMethod = null;
    const identifier = null;
    const auth = await this.generateAuthResponse(
      user,
      identifier,
      verificationMethod,
    );

    return {
      success: true,
      message: `${role} registration successful. Please verify your email and phone.`,
      accessToken: auth.accessToken,
      refreshTken: auth.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        status: user.status,
        role: user.role,
      },
      nextSteps: [
        'Check your email for verification code',
        'Check your phone for verification code',
        'Verify phone first, then email',
      ],
    };
  }

  async registerUserold(dto: CreateUserDto, role: UserRole): Promise<any> {
    this.logger.log(`Registering ${role}: ${dto.email}`);

    await this.checkExistingUser(dto.email, dto.phoneNumber);

    const hashedPassword = await Helper.hashText(dto.password);

    const user = await this.userRepository.create({
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role,
      status: UserStatus.PENDING_EMAIL_VERIFICATION,
    });

    await this.sendInitialUserVerificationOtps(user);

    // ✅ ISSUE TOKEN HERE
    // const auth = await this.generateAuthResponse(user);

    // return {
    //   success: true,
    //   message: `${role} registration successful. Please verify your email and phone.`,
    //   accessToken: auth.accessToken, // 👈 NEW
    //   user: {
    //     id: user.id,
    //     email: user.email,
    //     phoneNumber: user.phoneNumber,
    //     status: user.status,
    //     role: user.role,
    //   },
    //   nextSteps: [
    //     'Check your email for verification code',
    //     'Check your phone for verification code',
    //     'Verify phone first, then email',
    //   ],
    // };
  }

  /**
   * Verify Vendor Email - Step 2
   */
  async verifyVendorEmail(dto: VerifyEmailDto): Promise<{
    success: boolean;
    message: string;
    nextAction: string;
    accessToken?: string;
    vendor: Partial<User>;
  }> {
    this.logger.log(`Verifying email for: ${dto.email}`);

    const isValid = await this.verificationService.verifyOtp({
      identifier: dto.email,
      otp: dto.otp,
      purpose: VerificationPurpose.VENDOR_EMAIL_VERIFICATION,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    const vendor = await this.userRepository.findByEmail(dto.email);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    if (!vendor.isPhoneVerified) {
      throw new BadRequestException('Please verify your phone number first');
    }

    if (vendor.isEmailVerified) {
      throw new ConflictException('Email already verified');
    }

    vendor.isEmailVerified = true;
    vendor.emailVerifiedAt = new Date();

    vendor.status = UserStatus.PENDING_ONBOARDING;

    // Initialize onboarding
    if (!vendor.onboardingStatus) {
      vendor.onboardingStatus = 'NOT_STARTED';
      vendor.onboardingStep = 0;
    }

    const updatedVendor = await this.userRepository.update(vendor.id, vendor);

    // Now fully verified → issue JWT
    //const auth = await this.generateAuthResponse(updatedVendor);
    const verificationMethod = null;
    const identifier = null;
    const auth = await this.generateAuthResponse(
      updatedVendor,
      identifier,
      verificationMethod,
    );
    return {
      success: true,
      message: 'Email verified successfully',
      nextAction: 'Complete business onboarding',
      accessToken: auth.accessToken,
      vendor: {
        id: updatedVendor.id,
        email: updatedVendor.email,
        phoneNumber: updatedVendor.phoneNumber,
        status: updatedVendor.status,
        onboardingStatus: updatedVendor.onboardingStatus,
        onboardingStep: updatedVendor.onboardingStep,
      },
    };
  }

  async verifyUserEmail(dto: VerifyEmailDto): Promise<{
    success: boolean;
    message: string;
    nextAction: string;
    accessToken?: string;
    refreshToken?: string;
    user: Partial<User>;
  }> {
    const { email, otp, verificationToken } = dto;

    this.logger.log(`Verifying email for: ${email}`);

    // 1️⃣ Require verification token
    if (!verificationToken) {
      throw new UnauthorizedException('Verification token is required');
    }

    let payload: any;

    // 2️⃣ Verify token
    try {
      payload = this.jwtService.verify(verificationToken);
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    if (payload.type !== 'verify') {
      throw new UnauthorizedException('Invalid token type');
    }

    const userId = payload.sub;

    // 3️⃣ Get user from token
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 4️⃣ Ensure email exists
    if (!user.email) {
      throw new BadRequestException('No email found for this user');
    }

    // 5️⃣ Ensure email matches
    if (user.email !== email) {
      throw new BadRequestException('Email mismatch');
    }

    // 6️⃣ Prevent re-verification
    if (user.isEmailVerified) {
      throw new ConflictException('Email already verified');
    }

    // 7️⃣ Enforce phone-first flow
    if (!user.isPhoneVerified) {
      throw new BadRequestException('Please verify your phone number first');
    }

    // 8️⃣ Verify OTP
    const isValid = await this.verificationService.verifyOtp({
      identifier: email,
      otp,
      purpose: VerificationPurpose.USER_EMAIL_VERIFICATION,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    // 9️⃣ Update user
    user.isEmailVerified = true;
    user.emailVerifiedAt = new Date();
    user.status = UserStatus.PENDING_ONBOARDING;

    if (!user.onboardingStatus) {
      user.onboardingStatus = 'NOT_STARTED';
      user.onboardingStep = 0;
    }

    const updatedUser = await this.userRepository.update(user.id, user);

    // 🔟 Issue access token AFTER verification
    const auth = await this.generateAuthResponse(updatedUser, email, 'email');

    return {
      success: true,
      message: 'Email verified successfully',
      nextAction: 'Complete business onboarding',
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        phoneNumber: updatedUser.phoneNumber,
        status: updatedUser.status,
        onboardingStatus: updatedUser.onboardingStatus,
        onboardingStep: updatedUser.onboardingStep,
      },
    };
  }

  async verifyUserEmailold2(
    userId: string,
    dto: VerifyEmailDto,
  ): Promise<{
    success: boolean;
    message: string;
    nextAction: string;
    accessToken?: string;
    user: Partial<User>;
  }> {
    const { email, otp } = dto;

    this.logger.log(`Verifying email for user: ${userId}`);

    // 1️⃣ Get authenticated user (FIXED)
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2️⃣ Ensure user has email
    if (!user.email) {
      throw new BadRequestException('No email found for this user');
    }

    // 3️⃣ Ensure email matches (SECURITY CHECK)
    if (user.email !== email) {
      throw new BadRequestException('Email mismatch');
    }

    // 4️⃣ Prevent re-verification
    if (user.isEmailVerified) {
      throw new ConflictException('Email already verified');
    }

    // 5️⃣ Enforce phone-first flow (your rule)
    if (!user.isPhoneVerified) {
      throw new BadRequestException('Please verify your phone number first');
    }

    // 6️⃣ Verify OTP
    const isValid = await this.verificationService.verifyOtp({
      identifier: email,
      otp,
      purpose: VerificationPurpose.USER_EMAIL_VERIFICATION,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    // 7️⃣ Update user
    user.isEmailVerified = true;
    user.emailVerifiedAt = new Date();

    user.status = UserStatus.PENDING_ONBOARDING;

    // Initialize onboarding if needed
    if (!user.onboardingStatus) {
      user.onboardingStatus = 'NOT_STARTED';
      user.onboardingStep = 0;
    }

    const updatedUser = await this.userRepository.update(user.id, user);

    const identifier = null;
    const verificationMethod = null;

    // 8️⃣ Issue fresh token (optional but good)
    // const auth = await this.generateAuthResponse(updatedUser);
    const auth = await this.generateAuthResponse(
      updatedUser,
      identifier,
      verificationMethod,
    );

    return {
      success: true,
      message: 'Email verified successfully',
      nextAction: 'Complete business onboarding',
      accessToken: auth.accessToken,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        phoneNumber: updatedUser.phoneNumber,
        status: updatedUser.status,
        onboardingStatus: updatedUser.onboardingStatus,
        onboardingStep: updatedUser.onboardingStep,
      },
    };
  }

  async verifyUserEmailold(dto: VerifyEmailDto): Promise<{
    success: boolean;
    message: string;
    nextAction: string;
    accessToken?: string;
    user: Partial<User>;
  }> {
    this.logger.log(`Verifying email for: ${dto.email}`);

    const isValid = await this.verificationService.verifyOtp({
      identifier: dto.email,
      otp: dto.otp,
      purpose: VerificationPurpose.USER_EMAIL_VERIFICATION,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    const user = await this.userRepository.findByEmail(dto.email);
    if (!user) {
      throw new NotFoundException('user not found');
    }

    if (!user.isPhoneVerified) {
      throw new BadRequestException('Please verify your phone number first');
    }

    if (user.isEmailVerified) {
      throw new ConflictException('Email already verified');
    }

    user.isEmailVerified = true;
    user.emailVerifiedAt = new Date();

    user.status = UserStatus.PENDING_ONBOARDING;

    // Initialize onboarding
    if (!user.onboardingStatus) {
      user.onboardingStatus = 'NOT_STARTED';
      user.onboardingStep = 0;
    }

    const updatedUser = await this.userRepository.update(user.id, user);

    // Now fully verified → issue JWT
    //   const auth = await this.generateAuthResponse(updatedUser);
    const verificationMethod = null;
    const identifier = null;
    const auth = await this.generateAuthResponse(
      updatedUser,
      identifier,
      verificationMethod,
    );

    return {
      success: true,
      message: 'Email verified successfully',
      nextAction: 'Complete business onboarding',
      accessToken: auth.accessToken,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        phoneNumber: updatedUser.phoneNumber,
        status: updatedUser.status,
        onboardingStatus: updatedUser.onboardingStatus,
        onboardingStep: updatedUser.onboardingStep,
      },
    };
  }

  /**
   * Verify Vendor Phone - Step 3
   */

  async verifyVendorPhone(dto: VerifyPhoneDto): Promise<{
    success: boolean;
    message: string;
    nextAction: string;
    vendor: Partial<User>;
  }> {
    this.logger.log(`Verifying phone for: ${dto.phoneNumber}`);

    const isValid = await this.verificationService.verifyOtp({
      identifier: dto.phoneNumber,
      otp: dto.otp,
      purpose: VerificationPurpose.VENDOR_PHONE_VERIFICATION,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    const vendor = await this.userRepository.findByPhone(dto.phoneNumber);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    if (vendor.isPhoneVerified) {
      throw new ConflictException('Phone already verified');
    }

    vendor.isPhoneVerified = true;
    vendor.phoneVerifiedAt = new Date();

    // If email not verified yet → next step is email
    if (!vendor.isEmailVerified) {
      vendor.status = UserStatus.PENDING_EMAIL_VERIFICATION;
    } else {
      vendor.status = UserStatus.PENDING_ONBOARDING;

      if (!vendor.onboardingStatus) {
        vendor.onboardingStatus = 'NOT_STARTED';
        vendor.onboardingStep = 0;
      }
    }

    const updatedVendor = await this.userRepository.update(vendor.id, vendor);

    return {
      success: true,
      message: 'Phone verified successfully',
      nextAction: updatedVendor.isEmailVerified
        ? 'Complete business onboarding'
        : 'Verify your email address',
      vendor: {
        id: updatedVendor.id,
        email: updatedVendor.email,
        phoneNumber: updatedVendor.phoneNumber,
        status: updatedVendor.status,
        isPhoneVerified: updatedVendor.isPhoneVerified,
        isEmailVerified: updatedVendor.isEmailVerified,
      },
    };
  }

  async addPhoneNumber(userId: string, dto: AddPhoneDto) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (user.isPhoneVerified) {
      throw new ConflictException('Phone already verified');
    }

    // ✅ Normalize phone FIRST
    if (dto.phoneNumber) {
      const phone = parsePhoneNumberFromString(
        dto.phoneNumber,
        (dto.countryCode || 'NG') as CountryCode,
      );

      if (!phone || !phone.isValid()) {
        throw new BadRequestException('Invalid phone number');
      }

      dto.phoneNumber = phone.format('E.164'); // ✅ +234...
    }

    // ✅ Prevent re-adding same number
    if (user.phoneNumber === dto.phoneNumber) {
      throw new ConflictException('Phone number already added');
    }

    // ✅ Ensure phone is not used by another user (normalized)
    const existing = await this.userRepository.findByPhone(dto.phoneNumber);
    if (existing && existing.id !== userId) {
      throw new ConflictException('Phone number already in use');
    }

    // ✅ Save normalized phone
    await this.userRepository.update(userId, {
      phoneNumber: dto.phoneNumber,
      countryCode: dto.countryCode, // ✅ store ISO code
      isPhoneVerified: false,
    });

    // ✅ Send OTP to normalized number
    await this.verificationService.sendOtp({
      identifier: dto.phoneNumber,
      purpose: VerificationPurpose.USER_PHONE_VERIFICATION,
    });

    return {
      success: true,
      message: 'OTP sent to phone number',
      nextAction: 'Verify your phone number',
      identifier: dto.phoneNumber,
    };
  }

  async addPhoneNumberold(userId: string, dto: AddPhoneDto) {
    const { phoneNumber } = dto;

    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (user.isPhoneVerified) {
      throw new ConflictException('Phone already verified');
    }

    // Ensure phone is not used by another user
    const existing = await this.userRepository.findByPhone(phoneNumber);
    if (existing && existing.id !== userId) {
      throw new ConflictException('Phone number already in use');
    }

    // Save phone number (unverified)
    await this.userRepository.update(userId, {
      phoneNumber,
      isPhoneVerified: false,
    });

    // Send OTP
    await this.verificationService.sendOtp({
      identifier: phoneNumber,
      purpose: VerificationPurpose.USER_PHONE_VERIFICATION,
    });

    return {
      success: true,
      message: 'OTP sent to phone number',
      nextAction: 'Verify your phone number',
    };
  }

  async verifyUserPhone(dto: VerifyPhoneDto): Promise<{
    success: boolean;
    message: string;
    accessToken: string;
    refreshToken: string;
    nextAction: string;
    user: Partial<User>;
  }> {
    const { phoneNumber, otp, verificationToken } = dto;

    let accessToken;
    let refreshToken;

    this.logger.log(`Verifying phone for: ${phoneNumber}`);

    // 1️⃣ Require verification token
    if (!verificationToken) {
      throw new UnauthorizedException('Verification token is required');
    }

    let payload: any;

    // 2️⃣ Verify token
    try {
      payload = this.jwtService.verify(verificationToken);
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    if (payload.type !== 'verify') {
      throw new UnauthorizedException('Invalid token type');
    }

    const userId = payload.sub;

    // 3️⃣ Get user from token
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 4️⃣ Ensure phone exists
    if (!user.phoneNumber) {
      throw new BadRequestException(
        'No phone number found. Please add phone number first',
      );
    }

    // 5️⃣ Ensure phone matches request
    if (user.phoneNumber !== phoneNumber) {
      throw new BadRequestException('Phone number mismatch');
    }

    // 6️⃣ Prevent re-verification
    if (user.isPhoneVerified) {
      throw new ConflictException('Phone already verified');
    }

    // 7️⃣ Verify OTP
    const isValid = await this.verificationService.verifyOtp({
      identifier: phoneNumber,
      otp,
      purpose: VerificationPurpose.USER_PHONE_VERIFICATION,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    // 8️⃣ Update user
    user.isPhoneVerified = true;
    user.phoneVerifiedAt = new Date();

    // 9️⃣ Status transitions
    if (!user.isEmailVerified) {
      user.status = UserStatus.PENDING_EMAIL_VERIFICATION;
      ((accessToken = null), (refreshToken = null));
    } else {
      user.status = UserStatus.PENDING_ONBOARDING;
      const auth = await this.generateAuthResponse(user, phoneNumber, 'phone');
      ((accessToken = auth.accessToken), (refreshToken = auth.refreshToken));

      if (!user.onboardingStatus) {
        user.onboardingStatus = 'NOT_STARTED';
        user.onboardingStep = 0;
      }
    }

    const updatedUser = await this.userRepository.update(user.id, user);

    // const auth = await this.generateAuthResponse(
    //   updatedUser,
    //   phoneNumber,
    //   'phone',
    // );

    return {
      success: true,
      message: 'Phone verified successfully',
      accessToken: accessToken,
      refreshToken: refreshToken,
      nextAction: updatedUser.isEmailVerified
        ? 'Complete business onboarding'
        : 'Verify your email address',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        phoneNumber: updatedUser.phoneNumber,
        status: updatedUser.status,
        isPhoneVerified: updatedUser.isPhoneVerified,
        isEmailVerified: updatedUser.isEmailVerified,
      },
    };
  }

  async verifyUserPhoneold2(
    userId: string,
    dto: VerifyPhoneDto,
  ): Promise<{
    success: boolean;
    message: string;
    nextAction: string;
    user: Partial<User>;
  }> {
    const { phoneNumber, otp } = dto;

    this.logger.log(`Verifying phone for user: ${userId}`);

    // 1️⃣ Get authenticated user (FIXED)
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2️⃣ Ensure phone exists on user
    if (!user.phoneNumber) {
      throw new BadRequestException(
        'No phone number found. Please add phone number first',
      );
    }

    // 3️⃣ Ensure phone matches request (SECURITY CHECK)
    if (user.phoneNumber !== phoneNumber) {
      throw new BadRequestException('Phone number mismatch');
    }

    // 4️⃣ Prevent re-verification
    if (user.isPhoneVerified) {
      throw new ConflictException('Phone already verified');
    }

    // 5️⃣ Verify OTP
    const isValid = await this.verificationService.verifyOtp({
      identifier: phoneNumber,
      otp,
      purpose: VerificationPurpose.USER_PHONE_VERIFICATION,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    // 6️⃣ Update user
    user.isPhoneVerified = true;
    user.phoneVerifiedAt = new Date();

    // 7️⃣ Status transitions
    if (!user.isEmailVerified) {
      user.status = UserStatus.PENDING_EMAIL_VERIFICATION;
    } else {
      user.status = UserStatus.PENDING_ONBOARDING;

      if (!user.onboardingStatus) {
        user.onboardingStatus = 'NOT_STARTED';
        user.onboardingStep = 0;
      }
    }

    const updatedUser = await this.userRepository.update(user.id, user);

    return {
      success: true,
      message: 'Phone verified successfully',
      nextAction: updatedUser.isEmailVerified
        ? 'Complete business onboarding'
        : 'Verify your email address',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        phoneNumber: updatedUser.phoneNumber,
        status: updatedUser.status,
        isPhoneVerified: updatedUser.isPhoneVerified,
        isEmailVerified: updatedUser.isEmailVerified,
      },
    };
  }

  async verifyUserPhoneold(dto: VerifyPhoneDto): Promise<{
    success: boolean;
    message: string;
    nextAction: string;
    user: Partial<User>;
  }> {
    this.logger.log(`Verifying phone for: ${dto.phoneNumber}`);

    const isValid = await this.verificationService.verifyOtp({
      identifier: dto.phoneNumber,
      otp: dto.otp,
      purpose: VerificationPurpose.USER_PHONE_VERIFICATION,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    const user = await this.userRepository.findByPhone(dto.phoneNumber);
    if (!user) {
      throw new NotFoundException('user not found');
    }

    if (user.isPhoneVerified) {
      throw new ConflictException('Phone already verified');
    }

    user.isPhoneVerified = true;
    user.phoneVerifiedAt = new Date();

    // If email not verified yet → next step is email
    if (!user.isEmailVerified) {
      user.status = UserStatus.PENDING_EMAIL_VERIFICATION;
    } else {
      user.status = UserStatus.PENDING_ONBOARDING;

      if (!user.onboardingStatus) {
        user.onboardingStatus = 'NOT_STARTED';
        user.onboardingStep = 0;
      }
    }

    const updatedUser = await this.userRepository.update(user.id, user);

    return {
      success: true,
      message: 'Phone verified successfully',
      nextAction: updatedUser.isEmailVerified
        ? 'Complete business onboarding'
        : 'Verify your email address',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        phoneNumber: updatedUser.phoneNumber,
        status: updatedUser.status,
        isPhoneVerified: updatedUser.isPhoneVerified,
        isEmailVerified: updatedUser.isEmailVerified,
      },
    };
  }

  /**
   * Vendor Login
   */
  async loginVendor(loginDto: LoginDto) {
    const { email, password } = loginDto;
    this.logger.log(`Vendor login attempt: ${email}`);

    const vendor = await this.userRepository.findByEmail(email);

    if (!vendor) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, vendor.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    /**
     * Enforce verification order
     * Phone → Email → Onboarding
     */

    if (!vendor.isPhoneVerified) {
      throw new UnauthorizedException(
        'Please verify your phone number before logging in',
      );
    }

    if (!vendor.isEmailVerified) {
      throw new UnauthorizedException(
        'Please verify your email address before logging in',
      );
    }

    // ✅ DO NOT block login for:
    // - PENDING_ONBOARDING
    // - IN_PROGRESS
    // - COMPLETED
    // - PENDING (admin review)
    // - REJECTED
    // - APPROVED

    // Update last login
    const lastLoginAt = new Date();

    await this.userRepository.update(vendor.id, {
      lastLoginAt,
    });

    // Generate auth tokens
    //  const auth = await this.generateAuthResponse(vendor);
    const verificationMethod = null;
    const identifier = null;
    const auth = await this.generateAuthResponse(
      vendor,
      identifier,
      verificationMethod,
    );
    return {
      ...auth,
      // Return onboarding + account state
      onboardingStatus: vendor.onboardingStatus,
      onboardingStep: vendor.onboardingStep,
      status: vendor.status,
    };
  }

  async loginUser(loginDto: LoginDto, role: UserRole) {
    const { email, password } = loginDto;
    this.logger.log(`user login attempt: ${email}`);

    const user = await this.userRepository.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.role !== role) {
      throw new UnauthorizedException('Invalid role');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    /**
     * =========================
     * VERIFICATION FLOW
     * =========================
     */

    // ❌ Phone not verified
    if (!user.isPhoneVerified) {
      const verificationResponse = await this.resendVerificationToken({
        identifier: user.phoneNumber,
      });

      await this.verificationService.sendOtp({
        identifier: user.phoneNumber,
      });

      return {
        success: false,
        status: 'UNVERIFIED',
        message: 'Please verify your phone number before logging in',

        identifier: user.phoneNumber,
        verificationMethod: 'phone',

        verificationToken: verificationResponse.verificationToken,

        onboardingStep: user.onboardingStep ?? 0,
        onboardingStatus: user.onboardingStatus,
      };
    }

    // ❌ Email not verified
    if (!user.isEmailVerified) {
      const verificationResponse = await this.resendVerificationToken({
        identifier: user.email,
      });

      await this.verificationService.sendOtp({
        identifier: user.email,
      });

      return {
        success: false,
        status: 'UNVERIFIED',
        message: 'Please verify your email address before logging in',

        identifier: user.email,
        verificationMethod: 'email',

        verificationToken: verificationResponse.verificationToken,

        onboardingStep: user.onboardingStep ?? 0,
        onboardingStatus: user.onboardingStatus,
      };
    }

    if (!user.isPhoneVerified && !user.isEmailVerified) {
      // prioritize phone first (you can change this if needed)
      const identifier = user.phoneNumber;

      const verificationResponse = await this.resendVerificationToken({
        identifier,
      });

      await this.verificationService.sendOtp({
        identifier,
      });

      return {
        success: false,
        status: 'UNVERIFIED',
        message:
          'Please verify your phone number and email address before logging in. Start with phone verification.',
        phoneNumber: user.phoneNumber,
        email: user.email,
        verificationToken: verificationResponse.verificationToken,
        onboardingStep: user.onboardingStep ?? 0,
        onboardingStatus: user.onboardingStatus,
      };
    }

    /**
     * =========================
     * LOGIN SUCCESS FLOW
     * =========================
     */

    await this.userRepository.update(user.id, {
      lastLoginAt: new Date(),
    });

    const verificationMethod = null;
    const identifier = null;

    const auth = await this.generateAuthResponse(
      user,
      identifier,
      verificationMethod,
    );

    return {
      ...auth,
      onboardingStatus: user.onboardingStatus,
      onboardingStep: user.onboardingStep,
      status: user.status,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
    };
  }

  async loginUserold(loginDto: LoginDto, role: UserRole) {
    const { email, password } = loginDto;
    this.logger.log(`user login attempt: ${email}`);

    const user = await this.userRepository.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.role !== role) {
      throw new UnauthorizedException('Invalid role');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    /**
     * Enforce verification order
     * Phone → Email → Onboarding
     */

    // if (!user.isPhoneVerified) {
    //   throw new UnauthorizedException(
    //     'Please verify your phone number before logging in',
    //   );
    // }

    // if (!user.isEmailVerified) {
    //   throw new UnauthorizedException(
    //     'Please verify your email address before logging in',
    //   );
    // }

    if (!user.isPhoneVerified) {
      return {
        success: false,
        status: 'UNVERIFIED',
        message: 'Please verify your phone number before logging in',

        // ✅ IMPORTANT
        identifier: user.phoneNumber,
        verificationMethod: 'phone',
        onboardingStep: user.onboardingStep ?? 0,
        onboardingStatus: user.onboardingStatus,
      };
    }

    // ❌ Email not verified
    if (!user.isEmailVerified) {
      return {
        success: false,
        status: 'UNVERIFIED',
        message: 'Please verify your email address before logging in',

        // ✅ IMPORTANT
        identifier: user.email,
        verificationMethod: 'email',
        onboardingStep: user.onboardingStep ?? 0,
        onboardingStatus: user.onboardingStatus,
      };
    }

    // ✅ DO NOT block login for:
    // - PENDING_ONBOARDING
    // - IN_PROGRESS
    // - COMPLETED
    // - PENDING (admin review)
    // - REJECTED
    // - APPROVED

    // Update last login
    const lastLoginAt = new Date();

    await this.userRepository.update(user.id, {
      lastLoginAt,
    });

    // Generate auth tokens
    // const auth = await this.generateAuthResponse(user);

    const verificationMethod = null;
    const identifier = null;
    const auth = await this.generateAuthResponse(
      user,
      identifier,
      verificationMethod,
    );

    return {
      ...auth,
      // Return onboarding + account state
      onboardingStatus: user.onboardingStatus,
      onboardingStep: user.onboardingStep,
      status: user.status,
    };
  }

  async loginVendor2(loginDto: LoginDto): Promise<AuthResponse> {
    const { email, password } = loginDto;
    this.logger.log(`Vendor login attempt: ${email}`);

    const vendor = await this.userRepository.findByEmail(email);
    if (!vendor) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, vendor.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check verification status
    if (!vendor.isEmailVerified || !vendor.isPhoneVerified) {
      throw new UnauthorizedException(
        'Please verify your email and phone before logging in',
      );
    }

    // Check if onboarding is completed
    // if (!vendor.onboardingCompletedAt) {
    //   throw new UnauthorizedException(
    //     'Please complete business onboarding before logging in',
    //   );
    // }

    // Check account status
    // if (vendor.status !== UserStatus.APPROVED) {
    //   throw new UnauthorizedException(
    //     `Account is ${vendor.status.toLowerCase()}. Please contact support.`,
    //   );
    // }

    // Update last login
    vendor.lastLoginAt = new Date();
    await this.userRepository.update(vendor.id, {
      lastLoginAt: vendor.lastLoginAt,
    });

    // Generate auth tokens
    //return this.generateAuthResponse(vendor);
    const verificationMethod = null;
    const identifier = null;
    return this.generateAuthResponse(vendor, identifier, verificationMethod);
  }

  /**
   * Resend verification OTP
   */
  async resendVerificationOtp(
    identifier: string,
    // purpose: VerificationPurpose,
  ): Promise<{ success: boolean; message: string }> {
    const isEmail = identifier.includes('@');
    const purposeMap = {
      email: VerificationPurpose.VENDOR_EMAIL_VERIFICATION,
      phone: VerificationPurpose.VENDOR_PHONE_VERIFICATION,
    };

    await this.verificationService.sendOtp({
      identifier,
      purpose: isEmail ? purposeMap.email : purposeMap.phone,
    });

    return {
      success: true,
      message: `Verification code sent to ${identifier}`,
    };
  }

  // Private helper methods
  private async checkExistingVendor(
    email: string,
    phoneNumber: string,
  ): Promise<void> {
    const existingVendor = await this.userRepository.findExistingUser(
      email,
      phoneNumber,
    );
    if (existingVendor) {
      this.logger.warn(
        `Vendor already exists with email: ${email} or phone: ${phoneNumber}`,
      );
      throw new ConflictException(
        'Vendor with this email or phone already exists',
      );
    }
  }

  private async checkExistingUser(
    email: string,
    phoneNumber: string,
  ): Promise<void> {
    const existingUser = await this.userRepository.findExistingUser(
      email,
      phoneNumber,
    );
    if (existingUser) {
      this.logger.warn(
        `${existingUser.role} already exists with email: ${email} or phone: ${phoneNumber}`,
      );
      throw new ConflictException(
        'User with this email or phone already exists',
      );
    }
  }

  private async sendInitialVerificationOtps(vendor: User): Promise<void> {
    try {
      // Send email verification OTP
      await this.verificationService.sendOtp({
        identifier: vendor.email,
        purpose: VerificationPurpose.VENDOR_EMAIL_VERIFICATION,
      });

      // Send phone verification OTP
      await this.verificationService.sendOtp({
        identifier: vendor.phoneNumber,
        purpose: VerificationPurpose.VENDOR_PHONE_VERIFICATION,
      });

      this.logger.log(
        `Verification OTPs sent to ${vendor.email} and ${vendor.phoneNumber}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send verification OTPs: ${error.message}`);
      // Don't fail registration, vendor can request resend later
    }
  }

  private async sendInitialUserVerificationOtps(user: User): Promise<void> {
    try {
      // Send email verification OTP
      await this.verificationService.sendOtp({
        identifier: user.email,
        purpose: VerificationPurpose.USER_EMAIL_VERIFICATION,
      });

      // Send phone verification OTP
      await this.verificationService.sendOtp({
        identifier: user.phoneNumber,
        purpose: VerificationPurpose.USER_PHONE_VERIFICATION,
      });

      this.logger.log(
        `Verification OTPs sent to ${user.email} and ${user.phoneNumber}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send verification OTPs: ${error.message}`);
      // Don't fail registration, vendor can request resend later
    }
  }

  async saveVendorOnboardingStep(
    vendorId: string,
    step: number,
    dto: Partial<CompleteOnboardingDto>,
  ) {
    const vendor = await this.validateVendorForOnboarding(vendorId);

    if (step > (vendor.onboardingStep ?? 0) + 1) {
      throw new ConflictException(
        `Complete step ${(vendor.onboardingStep ?? 0) + 1} first`,
      );
    }

    // const businessData: Prisma.BusinessInfoUpdateInput = {};

    // switch (step) {
    //   case 1:
    //     Object.assign(businessData, {
    //       businessName: dto.businessName,
    //       businessType: dto.businessType,
    //       registrationNumber: dto.registrationNumber,
    //       taxId: dto.taxId,
    //       description: dto.description,
    //     });
    //     break;

    //   case 2:
    //     Object.assign(businessData, {
    //       businessPhone: dto.businessPhone,
    //       businessEmail: dto.businessEmail,
    //     });
    //     break;

    //   case 3:
    //     Object.assign(businessData, {
    //       address: dto.address,
    //       city: dto.city,
    //       state: dto.state,
    //     });
    //     break;

    //   case 4:
    //     Object.assign(businessData, {
    //       bankName: dto.bankName,
    //       accountName: dto.accountName,
    //       accountNumber: dto.accountNumber,
    //     });
    //     break;
    // }

    const businessCreateData: Prisma.BusinessInfoCreateWithoutUserInput = {};
    const businessUpdateData: Prisma.BusinessInfoUpdateWithoutUserInput = {};

    switch (step) {
      case 1:
        Object.assign(businessCreateData, {
          businessName: dto.businessName,
          businessType: dto.businessType,
          registrationNumber: dto.registrationNumber,
          taxId: dto.taxId,
          description: dto.description,
        });

        Object.assign(businessUpdateData, {
          businessName: dto.businessName,
          businessType: dto.businessType,
          registrationNumber: dto.registrationNumber,
          taxId: dto.taxId,
          description: dto.description,
        });
        break;

      case 2:
        Object.assign(businessCreateData, {
          businessPhone: dto.businessPhone,
          businessEmail: dto.businessEmail,
        });

        Object.assign(businessUpdateData, {
          businessPhone: dto.businessPhone,
          businessEmail: dto.businessEmail,
        });
        break;

      case 3:
        Object.assign(businessCreateData, {
          address: dto.address,
          city: dto.city,
          state: dto.state,
        });

        Object.assign(businessUpdateData, {
          address: dto.address,
          city: dto.city,
          state: dto.state,
        });
        break;

      case 4:
        Object.assign(businessCreateData, {
          bankName: dto.bankName,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
        });

        Object.assign(businessUpdateData, {
          bankName: dto.bankName,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
        });
        break;
    }

    await this.userRepository.updateVendor(vendorId, {
      onboardingStatus: OnBoardingStatus.IN_PROGRESS,
      status: UserStatus.PENDING_DOCUMENTS,
      onboardingStep: step,
      businessInfo: {
        upsert: {
          create: businessCreateData,
          update: businessUpdateData,
        },
      },
    });

    return {
      success: true,
      message: `Step ${step} saved successfully`,
      onboardingStep: step,
      onboardingStatus: OnBoardingStatus.IN_PROGRESS,
      status: UserStatus.PENDING_DOCUMENTS,
    };
  }

  async submitVendorOnboarding(
    vendorId: string,
    files: Express.Multer.File[],
    documentsMetadata: VendorDocumentMetadataDto[],
  ): Promise<{
    success: boolean;
    message: string;
    vendor: Partial<User>;
    uploadedDocuments: any[];
  }> {
    this.logger.log(`Submitting final onboarding for vendor ${vendorId}`);

    const vendor = await this.validateVendorForOnboarding(vendorId);

    if (vendor.onboardingStep < 4) {
      throw new ConflictException(
        'Complete all previous steps before submitting documents',
      );
    }

    if (!files || files.length === 0) {
      throw new BadRequestException(
        'At least one document file must be uploaded',
      );
    }

    const uploadedDocuments = await this.uploadVendorDocuments(
      vendorId,
      files,
      documentsMetadata,
    );

    const updatedVendor = await this.userRepository.update(vendorId, {
      onboardingStatus: OnBoardingStatus.COMPLETED,
      onboardingStep: 5,
      onboardingCompletedAt: new Date(),
      status: UserStatus.UNDER_REVIEW, // Now under admin review
    });

    return {
      success: true,
      message:
        'Onboarding submitted successfully. Your account is under review.',
      vendor: {
        id: updatedVendor.id,
        email: updatedVendor.email,
        status: updatedVendor.status,
        onboardingStatus: updatedVendor.onboardingStatus,
        onboardingStep: updatedVendor.onboardingStep,
      },
      uploadedDocuments: uploadedDocuments.map((doc) => ({
        documentType: doc.documentType,
        documentUrl: doc.documentUrl,
        publicId: doc.publicId,
      })),
    };
  }

  async getVendorOnboardingState(vendorId: string) {
    const vendor = await this.userRepository.findById(vendorId);

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    return {
      onboardingStatus: vendor.onboardingStatus,
      onboardingStep: vendor.onboardingStep,
      status: vendor.status,
    };
  }

  /**
   * Complete vendor onboarding with document files
   * Users select files from their computer and we upload to Cloudinary
   */
  async completeVendorOnboarding(
    vendorId: string,
    dto: CompleteOnboardingDto,
    files: Express.Multer.File[], // Files selected by user
    documentsMetadata: VendorDocumentMetadataDto[], // Metadata for each file
  ): Promise<{
    success: boolean;
    message: string;
    vendor: Partial<User>;
    uploadedDocuments: any[];
  }> {
    this.logger.log(
      `Completing vendor onboarding: ${vendorId} with ${files.length} files`,
    );

    // Validate vendor
    await this.validateVendorForOnboarding(vendorId);

    // Upload all selected files to Cloudinary
    const uploadedDocuments = await this.uploadVendorDocuments(
      vendorId,
      files,
      documentsMetadata,
    );

    // Prepare business info data
    const businessInfoData = this.prepareBusinessInfoData(dto);

    // Complete onboarding in repository
    const updatedVendor = await this.userRepository.completeVendorOnboarding(
      vendorId,
      businessInfoData,
      uploadedDocuments,
    );

    return {
      success: true,
      message:
        'Vendor onboarding completed successfully. Your account is now under review.',
      vendor: {
        id: updatedVendor.id,
        email: updatedVendor.email,
        status: updatedVendor.status,
      },
      uploadedDocuments: uploadedDocuments.map((doc) => ({
        documentType: doc.documentType,
        documentUrl: doc.documentUrl,
        publicId: doc.publicId,
        originalName: doc.originalName,
        size: doc.size,
      })),
    };
  }

  /**
   * Upload a single document file
   */
  async uploadSingleDocument(
    vendorId: string,
    dto: UploadDocumentDto,
    file: Express.Multer.File, // File selected by user
  ): Promise<{
    success: boolean;
    message: string;
    document: any;
  }> {
    this.logger.log(`Uploading ${dto.documentType} for vendor: ${vendorId}`);

    // Validate vendor
    const vendor = await this.userRepository.findById(vendorId);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    // Validate vendor status
    if (
      vendor.status !== UserStatus.PENDING_ONBOARDING &&
      vendor.status !== UserStatus.PENDING_DOCUMENTS
    ) {
      throw new ConflictException(
        `Cannot upload documents in current status: ${vendor.status}`,
      );
    }

    // Upload file to Cloudinary
    const uploadResult = await this.cloudinary.uploadDocument(file, {
      folder: `vendors/${vendorId}/documents`,
      resource_type: 'auto',
      tags: [dto.documentType, vendorId, file.originalname],
    });

    // Create document record in database
    const document = await this.userRepository.createVendorDocument({
      vendorId,
      documentType: dto.documentType,
      documentUrl: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      description: dto.description,
      isVerified: false,
    });

    return {
      success: true,
      message: `${dto.documentType} uploaded successfully`,
      document: {
        id: document.id,
        documentType: document.documentType,
        documentUrl: document.documentUrl,
        publicId: document.publicId,
        originalName: document.originalName,
        size: document.size,
      },
    };
  }

  /**
   * Upload multiple vendor documents to Cloudinary
   */
  private async uploadVendorDocuments(
    vendorId: string,
    files: Express.Multer.File[],
    documentsMetadata: VendorDocumentMetadataDto[],
  ): Promise<any[]> {
    this.logger.log(`Preparing to upload vendor ${vendorId} documents`);
    const uploadedDocuments: any[] = [];
    const uploadPromises: Promise<any>[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const metadata = documentsMetadata[i];

      const uploadPromise = this.cloudinary
        .uploadDocument(file, {
          folder: `vendors/${vendorId}/documents`,
          resource_type: 'auto',
          tags: [metadata.documentType, vendorId, file.originalname],
        })
        .then(async (uploadResult) => {
          // Check if document of this type already exists
          const existingDocument = await this.userRepository.findVendorDocument(
            {
              vendorId,
              documentType: metadata.documentType,
            },
          );

          if (existingDocument) {
            this.logger.log(
              `Skipping upload: ${metadata.documentType} already exists for vendor ${vendorId}`,
            );
            return existingDocument; // Return the existing document
          }

          // Create new document
          const document = await this.userRepository.createVendorDocument({
            vendorId,
            documentType: metadata.documentType,
            documentUrl: uploadResult.secure_url,
            publicId: uploadResult.public_id,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            description: metadata.description,
            isVerified: false,
          });

          this.logger.log(
            `Uploaded ${metadata.documentType} for vendor ${vendorId}: ${uploadResult.secure_url}`,
          );
          return document;
        })
        .catch((error) => {
          this.logger.error(
            `Failed to upload document ${file.originalname}: ${error.message}`,
          );
          throw new InternalServerErrorException(
            `Failed to upload ${metadata.documentType}: ${error.message}`,
          );
        });

      uploadPromises.push(uploadPromise);
    }

    const results = await Promise.all(uploadPromises);
    uploadedDocuments.push(...results);

    this.logger.log(
      `Successfully processed ${uploadedDocuments.length} documents for vendor ${vendorId}`,
    );

    return uploadedDocuments;
  }

  private async uploadVendorDocumentsWithoutDuplicates(
    vendorId: string,
    files: Express.Multer.File[],
    documentsMetadata: VendorDocumentMetadataDto[],
  ): Promise<any[]> {
    this.logger.log(`Preparing to upload vendor ${vendorId} documents`);
    const uploadedDocuments = [];
    const uploadPromises = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const metadata = documentsMetadata[i];

      // Create upload promise for each file
      const uploadPromise = this.cloudinary
        .uploadDocument(file, {
          folder: `vendors/${vendorId}/documents`,
          resource_type: 'auto',
          tags: [metadata.documentType, vendorId, file.originalname],
        })
        .then(async (uploadResult) => {
          // Create document record in database
          const document = await this.userRepository.createVendorDocument({
            vendorId,
            documentType: metadata.documentType,
            documentUrl: uploadResult.secure_url,
            publicId: uploadResult.public_id,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            description: metadata.description,
            isVerified: false,
          });

          this.logger.log(
            `Uploaded ${metadata.documentType} for vendor ${vendorId}: ${uploadResult.secure_url}`,
          );
          return document;
        })
        .catch((error) => {
          this.logger.error(
            `Failed to upload document ${file.originalname}: ${error.message}`,
          );
          throw new InternalServerErrorException(
            `Failed to upload ${metadata.documentType}: ${error.message}`,
          );
        });

      uploadPromises.push(uploadPromise);
    }

    // Wait for all uploads to complete
    const results = await Promise.all(uploadPromises);
    uploadedDocuments.push(...results);

    this.logger.log(
      `Successfully uploaded ${uploadedDocuments.length} documents for vendor ${vendorId}`,
    );
    return uploadedDocuments;
  }

  /**
   * Validate vendor is eligible for onboarding
   */
  private async validateVendorForOnboarding(vendorId: string): Promise<User> {
    this.logger.log(`Validating vendor ${vendorId} before onboarding`);

    const vendor = await this.userRepository.findById(vendorId);

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    // Allow document upload if status is PENDING_ONBOARDING
    // OR if status is PENDING_DOCUMENTS and onboardingStatus is IN_PROGRESS
    const canProceed =
      vendor.status === UserStatus.PENDING_ONBOARDING ||
      (vendor.status === UserStatus.PENDING_DOCUMENTS &&
        vendor.onboardingStatus === OnBoardingStatus.IN_PROGRESS);

    if (!canProceed) {
      throw new ConflictException(
        `Vendor is not ready for onboarding. Current status: ${vendor.status}, onboardingStatus: ${vendor.onboardingStatus}`,
      );
    }

    // Ensure email and phone are verified
    if (!vendor.isEmailVerified || !vendor.isPhoneVerified) {
      throw new ConflictException(
        'Both email and phone must be verified before onboarding',
      );
    }

    return vendor;
  }

  private async validateVendorForOnboardingold(
    vendorId: string,
  ): Promise<User> {
    this.logger.log(`Validating vendor ${vendorId} before onboarding `);

    const vendor = await this.userRepository.findById(vendorId);

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    if (vendor.status !== UserStatus.PENDING_ONBOARDING) {
      throw new ConflictException(
        `Vendor is not ready for onboarding. Current status: ${vendor.status}`,
      );
    }

    if (!vendor.isEmailVerified || !vendor.isPhoneVerified) {
      throw new ConflictException(
        'Both email and phone must be verified before onboarding',
      );
    }

    return vendor;
  }

  /**
   * Prepare business info data for repository
   */
  private prepareBusinessInfoData(dto: CompleteOnboardingDto): any {
    return {
      businessName: dto.businessName,
      businessType: dto.businessType,
      description: dto.description,
      businessPhone: dto.businessPhone,
      businessEmail: dto.businessEmail,
      address: dto.address,
      city: dto.city,
      state: dto.state,
      bankName: dto.bankName,
      accountName: dto.accountName,
      accountNumber: dto.accountNumber,
      registrationNumber: dto.registrationNumber,
      taxId: dto.taxId,
    };
  }

  /**
   * Upload a single document during onboarding
   */
  async uploadSingleDocumentbk(
    vendorId: string,
    dto: UploadDocumentDto,
    file: Express.Multer.File,
  ): Promise<{
    success: boolean;
    message: string;
    document: any;
  }> {
    this.logger.log(`Uploading ${dto.documentType} for vendor: ${vendorId}`);

    // Validate vendor
    const vendor = await this.userRepository.findById(vendorId);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    // Validate vendor status
    if (
      vendor.status !== UserStatus.PENDING_ONBOARDING &&
      vendor.status !== UserStatus.PENDING_DOCUMENTS
    ) {
      throw new ConflictException(
        `Cannot upload documents in current status: ${vendor.status}`,
      );
    }

    // Upload to Cloudinary
    const uploadResult = await this.cloudinary.uploadDocument(file, {
      folder: `vendors/${vendorId}/documents`,
      resource_type: 'auto',
      tags: [dto.documentType, vendorId],
    });

    // Create document record in database
    const document = await this.userRepository.createVendorDocument({
      vendorId,
      documentType: dto.documentType,
      documentUrl: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      description: dto.description,
      isVerified: false,
    });

    return {
      success: true,
      message: `${dto.documentType} uploaded successfully`,
      document: {
        id: document.id,
        documentType: document.documentType,
        documentUrl: document.documentUrl,
        publicId: document.publicId,
        originalName: document.originalName,
        size: document.size,
      },
    };
  }

  /**
   * Upload multiple documents at once
   */
  private async uploadVendorDocumentsbk1(
    vendorId: string,
    files: Express.Multer.File[],
    documentMetadata: VendorDocumentDto[],
  ): Promise<any[]> {
    const uploadedDocuments = [];
    const uploadPromises = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const metadata = documentMetadata[i];

      // Create upload promise
      const uploadPromise = this.cloudinary
        .uploadDocument(file, {
          folder: `vendors/${vendorId}/documents`,
          resource_type: 'auto',
          tags: [metadata.documentType, vendorId],
        })
        .then(async (uploadResult) => {
          // Create document record in database
          const document = await this.userRepository.createVendorDocument({
            vendorId,
            documentType: metadata.documentType,
            documentUrl: uploadResult.secure_url,
            publicId: uploadResult.public_id,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            description: metadata.description,
            isVerified: false,
          });

          return document;
        })
        .catch((error) => {
          this.logger.error(
            `Failed to upload document ${file.originalname}: ${error.message}`,
          );
          throw new InternalServerErrorException(
            `Failed to upload ${metadata.documentType}: ${error.message}`,
          );
        });

      uploadPromises.push(uploadPromise);
    }

    // Wait for all uploads to complete
    const results = await Promise.all(uploadPromises);
    uploadedDocuments.push(...results);

    this.logger.log(
      `Successfully uploaded ${uploadedDocuments.length} documents for vendor ${vendorId}`,
    );
    return uploadedDocuments;
  }

  /**
   * Upload a single document during onboarding
   */
  // async uploadSingleDocument(
  //   vendorId: string,
  //   dto: UploadDocumentDto,
  //   file: Express.Multer.File,
  // ): Promise<{
  //   success: boolean;
  //   message: string;
  //   document: any;
  // }> {
  //   this.logger.log(`Uploading ${dto.documentType} for vendor: ${vendorId}`);

  //   // Validate vendor
  //   const vendor = await this.userRepository.findById(vendorId);
  //   if (!vendor) {
  //     throw new NotFoundException('Vendor not found');
  //   }

  //   // Validate vendor status
  //   if (vendor.status !== UserStatus.PENDING_ONBOARDING &&
  //       vendor.status !== UserStatus.PENDING_DOCUMENTS) {
  //     throw new ConflictException(
  //       `Cannot upload documents in current status: ${vendor.status}`,
  //     );
  //   }

  //   // Upload to Cloudinary
  //   const uploadResult = await this.cloudinaryService.uploadDocument(file, {
  //     folder: `vendors/${vendorId}/documents`,
  //     resource_type: 'auto',
  //     tags: [dto.documentType, vendorId],
  //   });

  //   // Create document record in database
  //   const document = await this.userRepository.createVendorDocument({
  //     vendorId,
  //     documentType: dto.documentType,
  //     documentUrl: uploadResult.secure_url,
  //     publicId: uploadResult.public_id,
  //     originalName: file.originalname,
  //     mimeType: file.mimetype,
  //     size: file.size,
  //     description: dto.description,
  //     isVerified: false,
  //   });

  //   return {
  //     success: true,
  //     message: `${dto.documentType} uploaded successfully`,
  //     document: {
  //       id: document.id,
  //       documentType: document.documentType,
  //       documentUrl: document.documentUrl,
  //       publicId: document.publicId,
  //       originalName: document.originalName,
  //       size: document.size,
  //     },
  //   };
  // }

  /**
   * Upload multiple documents at once
   */
  // private async uploadVendorDocuments(
  //   vendorId: string,
  //   files: Express.Multer.File[],
  //   documentMetadata: VendorDocumentDto[],
  // ): Promise<any[]> {
  //   const uploadedDocuments = [];
  //   const uploadPromises = [];

  //   for (let i = 0; i < files.length; i++) {
  //     const file = files[i];
  //     const metadata = documentMetadata[i];

  //     // Create upload promise
  //     const uploadPromise = this.cloudinary
  //       .uploadDocument(file, {
  //         folder: `vendors/${vendorId}/documents`,
  //         resource_type: 'auto',
  //         tags: [metadata.documentType, vendorId],
  //       })
  //       .then(async (uploadResult) => {
  //         // Create document record in database
  //         const document = await this.userRepository.createVendorDocument({
  //           vendorId,
  //           documentType: metadata.documentType,
  //           documentUrl: uploadResult.secure_url,
  //           publicId: uploadResult.public_id,
  //           originalName: file.originalname,
  //           mimeType: file.mimetype,
  //           size: file.size,
  //           isVerified: false,
  //         });

  //         return document;
  //       })
  //       .catch((error) => {
  //         this.logger.error(
  //           `Failed to upload document ${file.originalname}: ${error.message}`,
  //         );
  //         throw new InternalServerErrorException(
  //           `Failed to upload ${metadata.documentType}: ${error.message}`,
  //         );
  //       });

  //     uploadPromises.push(uploadPromise);
  //   }

  //   // Wait for all uploads to complete
  //   const results = await Promise.all(uploadPromises);
  //   uploadedDocuments.push(...results);

  //   this.logger.log(
  //     `Successfully uploaded ${uploadedDocuments.length} documents for vendor ${vendorId}`,
  //   );
  //   return uploadedDocuments;
  // }

  /**
   * Validate vendor is eligible for onboarding
   */
  // private async validateVendorForOnboarding(vendorId: string): Promise<User> {
  //   const vendor = await this.userRepository.findById(vendorId);

  //   if (!vendor) {
  //     throw new NotFoundException('Vendor not found');
  //   }

  //   if (vendor.status !== UserStatus.PENDING_ONBOARDING) {
  //     throw new ConflictException(
  //       `Vendor is not ready for onboarding. Current status: ${vendor.status}`,
  //     );
  //   }

  //   if (!vendor.isEmailVerified || !vendor.isPhoneVerified) {
  //     throw new ConflictException(
  //       'Both email and phone must be verified before onboarding',
  //     );
  //   }

  //   return vendor;
  // }

  /**
   * Prepare business info data for repository
   */
  // private prepareBusinessInfoData(dto: CompleteOnboardingDto): any {
  //   return {
  //     businessName: dto.businessName,
  //     businessType: dto.businessType,
  //     description: dto.description,
  //     businessPhone: dto.businessPhone,
  //     businessEmail: dto.businessEmail,
  //     address: dto.address,
  //     city: dto.city,
  //     state: dto.state,
  //     bankName: dto.bankName,
  //     accountName: dto.accountName,
  //     accountNumber: dto.accountNumber,
  //   };
  // }
  // async completeVendorOnboarding(
  //   vendorId: string,
  //   dto: CompleteOnboardingDto,
  // ): Promise<{
  //   success: boolean;
  //   message: string;
  //   vendor: Partial<User>;
  // }> {
  //   this.logger.log(`Completing vendor onboarding: ${vendorId}`);

  //   const vendor = await this.userRepository.findById(vendorId);

  //   if (!vendor) {
  //     throw new NotFoundException('Vendor not found');
  //   }

  //   // Check if vendor is in correct state for onboarding
  //   if (vendor.status !== UserStatus.PENDING_ONBOARDING) {
  //     throw new ConflictException(
  //       `Vendor is not ready for onboarding. Current status: ${vendor.status}`,
  //     );
  //   }

  //   // Check if email and phone are verified
  //   if (!vendor.isEmailVerified || !vendor.isPhoneVerified) {
  //     throw new ConflictException(
  //       'Both email and phone must be verified before onboarding',
  //     );
  //   }

  //   // Ensure at least one document is provided
  //   if (!dto.documents || dto.documents.length === 0) {
  //     throw new BadRequestException(
  //       'At least one business document is required for onboarding',
  //     );
  //   }

  //   // Complete onboarding using repository method
  //   const updatedVendor = await this.userRepository.completeVendorOnboarding(
  //     vendorId,
  //     {
  //       businessName: dto.businessName,
  //       businessType: dto.businessType,
  //       description: dto.description,
  //       businessPhone: dto.businessPhone,
  //       businessEmail: dto.businessEmail,
  //       address: dto.address,
  //       city: dto.city,
  //       state: dto.state,
  //       bankName: dto.bankName,
  //       accountName: dto.accountName,
  //       accountNumber: dto.accountNumber,
  //     },
  //     dto.documents,
  //   );

  //   return {
  //     success: true,
  //     message:
  //       'Vendor onboarding completed successfully. Your account is now active.',
  //     vendor: {
  //       id: updatedVendor.id,
  //       email: updatedVendor.email,
  //       //businessName: updatedVendor.businessInfo.businessName,
  //       status: updatedVendor.status,
  //       // documentsCount: updatedVendor.documents?.length || 0,
  //     },
  //   };
  // }

  /**
   * Get vendor onboarding status
   */
  // async getVendorOnboardingStatus(vendorId: string): Promise<{
  //   status: UserStatus;
  //   isEmailVerified: boolean;
  //   isPhoneVerified: boolean;
  //   hasBusinessInfo: boolean;
  //   documentsRequired: string[];
  //   uploadedDocuments: any[];
  //   nextSteps: string[];
  // }> {
  //   const vendor = await this.userRepository.getVendorWithRelations(vendorId);

  //   if (!vendor) {
  //     throw new NotFoundException('Vendor not found');
  //   }

  //   const requiredDocuments = [DocumentType.CAC];
  //   const uploadedDocTypes = vendor.documents?.map((d) => d.documentType) || [];

  //   const missingDocuments = requiredDocuments.filter(
  //     (docType) => !uploadedDocTypes.includes(docType),
  //   );

  //   const nextSteps = [];
  //   if (!vendor.isEmailVerified) nextSteps.push('Verify your email address');
  //   if (!vendor.isPhoneVerified) nextSteps.push('Verify your phone number');
  //   if (!vendor.businessInfo) nextSteps.push('Complete business information');
  //   if (missingDocuments.length > 0) {
  //     nextSteps.push(
  //       `Upload required documents: ${missingDocuments.join(', ')}`,
  //     );
  //   }
  //   if (
  //     vendor.status === UserStatus.PENDING_ONBOARDING &&
  //     nextSteps.length === 0
  //   ) {
  //     nextSteps.push('Submit for admin review');
  //   }

  //   return {
  //     status: vendor.status as UserStatus,
  //     isEmailVerified: vendor.isEmailVerified,
  //     isPhoneVerified: vendor.isPhoneVerified,
  //     hasBusinessInfo: !!vendor.businessInfo,
  //     documentsRequired: missingDocuments,
  //     uploadedDocuments: vendor.documents || [],
  //     nextSteps,
  //   };
  // }

  /**
   * Add additional vendor documents
   */
  async addVendorDocuments(
    vendorId: string,
    documents: Array<{
      documentType: DocumentType;
      documentUrl: string;
      publicId?: string;
      metadata?: any;
    }>,
  ): Promise<{
    success: boolean;
    message: string;
    documents: any[];
  }> {
    const vendor = await this.userRepository.findById(vendorId);

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const createdDocuments = await this.userRepository.createVendorDocuments(
      vendorId,
      documents,
    );

    return {
      success: true,
      message: `${createdDocuments.length} document(s) uploaded successfully`,
      documents: createdDocuments,
    };
  }
}
// async completeVendorOnboarding(
//   vendorId: string,
//   businessDetails: any
// ): Promise<{
//   success: boolean;
//   message: string;
//   vendor: Partial<User>;
// }> {
//   this.logger.log(`Completing vendor onboarding: ${vendorId}`);

//   const vendor = await this.userRepository.findById(vendorId);

//   if (!vendor) {
//     throw new ConflictException('Vendor not found');
//   }

//   if (vendor.status !== UserStatus.PENDING_ONBOARDING) {
//     throw new ConflictException('Vendor is not in the correct status for onboarding');
//   }

//   // Update vendor with business details
//   const updatedVendor = await this.userRepository.update(vendorId, {
//     ...businessDetails,
//     status: UserStatus.ACTIVE,
//     onboardingCompletedAt: new Date(),
//   });

//   return {
//     success: true,
//     message: 'Vendor onboarding completed successfully',
//     vendor: {
//       id: updatedVendor.id,
//       email: updatedVendor.email,
//       businessName: updatedVendor.businessName,
//       status: updatedVendor.status,
//     },
//   };
// }

// private async generateAuthResponse(vendor: Vendor): Promise<AuthResponse> {
//   const payload = {
//     sub: vendor.id,
//     email: vendor.email,
//     role: vendor.role,
//     type: 'vendor_access',
//   };

//   const accessToken = await this.jwtService.signAsync(payload as any, {
//     secret:
//       this.configService.get<string>('JWT_VENDOR_SECRET') ||
//       this.configService.get<string>('JWT_SECRET'),
//     expiresIn:
//       this.configService.get<string>('JWT_VENDOR_EXPIRES_IN') || '24h',
//   });

//   const refreshToken = await this.jwtService.signAsync(
//     { ...payload, type: 'vendor_refresh' } as any,
//     {
//       secret:
//         this.configService.get<string>('JWT_VENDOR_REFRESH_SECRET') ||
//         this.configService.get<string>('JWT_REFRESH_SECRET'),
//       expiresIn: '30d',
//     },
//   );

//   return {
//     accessToken,
//     refreshToken,
//     user: {
//       id: vendor.id,
//       email: vendor.email,
//       phoneNumber: vendor.phoneNumber,
//       role: vendor.role,
//       status: vendor.status,
//       businessInfo: vendor.businessInfo,
//     },
//   };
// }
