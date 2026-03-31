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
  VendorDocument,
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

  async login(dto: { email: string; password: string }) {
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
    const payload = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      success: true,
      accessToken,
      user: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
      },
    };
  }

  async loginWithVerification(dto: { email: string; password: string }) {
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

    return {
      status: 'OTP_REQUIRED',
      requiresVerification: true,
      verificationIdentifier: admin.email,
    };
  }

  /**
   * Register customer with automatic OTP
   */
  async registerCustomer(dto: CreateCustomerDto): Promise<RegisterResponseDto> {
    const { email, phoneNumber } = dto;

    this.logger.log(`Registering customer: ${email || phoneNumber}`);

    const registrationResponse = await this.userService.createCustomer({
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    return {
      status: registrationResponse.status,
      requiresVerification: registrationResponse.requiresVerification,
      registrationMethod: registrationResponse.registrationMethod,
      verificationIdentifier: email || phoneNumber,
    };
  }

  /**
   * Verify OTP during registration
   */
  async verifyRegistration(dto: VerifyOtpDto) {
    const { identifier, otp } = dto;

    const result = await this.userService.verifyUser(identifier, otp);

    if (!result.success || !result.user) {
      throw new UnauthorizedException('Invalid OTP');
    }

    // Generate tokens after successful verification
    return this.generateAuthResponse(result.user);
  }

  /**
   * Login - user with email/phone and password - only works for verified users
   */
  async loginCustomer(loginDto: LoginCustomerDto) {
    const { email, phoneNumber } = loginDto;
    const identifier = email || phoneNumber;

    this.logger.log(`Login attempt: ${identifier}`);

    // This will throw if user is not verified
    const user = await this.userService.authenticateUser(loginDto);

    // Check if user is verified (redundant but safe)
    if (!user.isVerified) {
      throw new UnauthorizedException(
        'Account not verified. Please verify your account.',
      );
    }

    return this.generateAuthResponse(user);
  }

  /**
   * Login user with email/phone and password
   */
  async loginCustomer2(loginDto: LoginCustomerDto): Promise<AuthResponse> {
    const { email, phoneNumber } = loginDto;
    const identifier = email || phoneNumber;

    this.logger.log(`Login attempt: ${identifier}`);

    // Delegate authentication to UserService
    const user = await this.userService.authenticateUser(loginDto);

    return this.generateAuthResponse(user);
  }

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
      // 1. Verify token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.refreshTokenSecret,
      });

      // 2. Find user
      const user = await this.userService.findById(payload.sub);

      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // 3. Match login checks EXACTLY
      if (!user.isActive) {
        this.logger.warn(`Refresh attempt for inactive user: ${user.id}`);
        throw new UnauthorizedException('Account is deactivated');
      }

      if (!user.isVerified) {
        this.logger.warn(`Refresh attempt for unverified user: ${user.id}`);
        throw new UnauthorizedException(
          'Account not verified. Please verify your email/phone.',
        );
      }

      // 4. Validate refresh token (rotation security)
      if (this.refreshTokenRotationEnabled && user.refreshTokenHash) {
        const isValid = await bcrypt.compare(
          refreshToken,
          user.refreshTokenHash,
        );

        if (!isValid) {
          this.logger.warn(
            `Invalid refresh token reuse detected for user: ${user.id}`,
          );

          // possible token theft → revoke all sessions
          await this.userService.updateRefreshToken(user.id, null);

          throw new UnauthorizedException('Invalid credentials');
        }
      }

      // 5. Generate new tokens (same as login)
      const authResponse = await this.generateAuthResponse(user);

      this.logger.log(`Tokens refreshed for user: ${user.id}`);

      return authResponse;
    } catch (error) {
      this.logger.error(`Refresh failed: ${error.message}`);
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  // async refreshTokensbk(refreshTokenDto: RefreshTokenDto): Promise<AuthResponse> {
  //   const { refreshToken } = refreshTokenDto;

  //   try {
  //     // Verify the refresh token
  //     const payload = this.jwtService.verify(refreshToken, {
  //       secret: this.refreshTokenSecret,
  //     });

  //     const user = await this.userService.findById(payload.sub);

  //     if (!user || !user.isActive) {
  //       throw new UnauthorizedException('User not found or inactive');
  //     }

  //     // If rotation is enabled, verify stored hash
  //     if (this.refreshTokenRotationEnabled && user.refreshTokenHash) {
  //       const isValid = await bcrypt.compare(
  //         refreshToken,
  //         user.refreshTokenHash,
  //       );
  //       if (!isValid) {
  //         this.logger.warn(`Invalid refresh token used for user: ${user.id}`);
  //         // Invalidate all refresh tokens for this user (potential token theft)
  //         await this.userService.updateRefreshToken(user.id, null);
  //         throw new UnauthorizedException('Invalid refresh token');
  //       }
  //     }

  //     // Generate new tokens
  //     const newTokens = await this.generateAuthResponse(user);

  //     // Invalidate old refresh token if rotation is enabled
  //     if (this.refreshTokenRotationEnabled) {
  //       await this.rotateRefreshToken(
  //         user.id,
  //         refreshToken,
  //         newTokens.refreshToken,
  //       );
  //     }

  //     this.logger.log(`Tokens refreshed for user: ${user.id}`);
  //     return newTokens;
  //   } catch (error) {
  //     this.logger.error(`Token refresh failed: ${error.message}`);
  //     throw new UnauthorizedException('Invalid refresh token');
  //   }
  // }

  async logout(userId: string): Promise<void> {
    this.logger.log(`Logging out user: ${userId}`);
    await this.userService.updateRefreshToken(userId, null);
  }

  private async generateAuthResponse(user: User): Promise<AuthResponse> {
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
    if (!profile?.email) {
      throw new BadRequestException('OAuth account has no email');
    }

    const allowedSelfAssignableRoles: UserRole[] = [
      UserRole.CUSTOMER,
      UserRole.VENDOR,
    ];

    // let finalRole: UserRole = UserRole.CUSTOMER;

    if (requestedRole) {
      if (!Object.values(UserRole).includes(requestedRole)) {
        throw new BadRequestException('Invalid role selected');
      }

      if (!allowedSelfAssignableRoles.includes(requestedRole)) {
        throw new ForbiddenException('You cannot assign this role');
      }

      //finalRole = requestedRole;
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

    return this.generateAuthResponse(user);
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
      return this.generateAuthResponse(user);
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
  async registerVendor(dto: CreateVendorDto): Promise<{
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
    const auth = await this.generateAuthResponse(updatedVendor);

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
    const auth = await this.generateAuthResponse(vendor);

    return {
      ...auth,
      // Return onboarding + account state
      onboardingStatus: vendor.onboardingStatus,
      onboardingStep: vendor.onboardingStep,
      status: vendor.status,
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
    return this.generateAuthResponse(vendor);
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

  async saveVendorOnboardingStepwk(
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

    const userData: any = {
      onboardingStatus: OnBoardingStatus.IN_PROGRESS,
      onboardingStep: step,
    };

    const businessData: any = {};

    switch (step) {
      case 1:
        Object.assign(businessData, {
          businessName: dto.businessName,
          businessType: dto.businessType,
          registrationNumber: dto.registrationNumber,
          taxId: dto.taxId,
          description: dto.description,
        });
        break;

      case 2:
        Object.assign(businessData, {
          businessPhone: dto.businessPhone,
          businessEmail: dto.businessEmail,
        });
        break;

      case 3:
        Object.assign(businessData, {
          address: dto.address,
          city: dto.city,
          state: dto.state,
        });
        break;

      case 4:
        Object.assign(businessData, {
          bankName: dto.bankName,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
        });
        break;
    }

    return this.prisma.user.update({
      where: { id: vendorId },
      data: {
        ...userData,
        businessInfo: {
          upsert: {
            create: {
              ...businessData,
            },
            update: {
              ...businessData,
            },
          },
        },
      },
      include: {
        businessInfo: true,
      },
    });
  }

  async saveVendorOnboardingStepbk(
    vendorId: string,
    step: number,
    dto: Partial<CompleteOnboardingDto>,
  ): Promise<{
    success: boolean;
    message: string;
    onboardingStep: number;
    onboardingStatus: string;
  }> {
    this.logger.log(`Saving onboarding step ${step} for vendor ${vendorId}`);

    const vendor = await this.validateVendorForOnboarding(vendorId);

    if (step < 1 || step > 4) {
      throw new BadRequestException('Invalid onboarding step');
    }

    // Prevent skipping steps
    if (step > vendor.onboardingStep + 1) {
      throw new ConflictException(
        `Complete step ${vendor.onboardingStep + 1} first`,
      );
    }

    const updatePayload: any = {
      onboardingStatus: OnBoardingStatus.IN_PROGRESS, //'IN_PROGRESS',
      onboardingStep: step,
    };

    switch (step) {
      case 1:
        Object.assign(updatePayload, {
          businessName: dto.businessName,
          businessType: dto.businessType,
          registrationNumber: dto.registrationNumber,
          taxId: dto.taxId,
          description: dto.description,
        });
        break;

      case 2:
        Object.assign(updatePayload, {
          businessPhone: dto.businessPhone,
          businessEmail: dto.businessEmail,
        });
        break;

      case 3:
        Object.assign(updatePayload, {
          address: dto.address,
          city: dto.city,
          state: dto.state,
        });
        break;

      case 4:
        Object.assign(updatePayload, {
          bankName: dto.bankName,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
        });
        break;
    }

    await this.userRepository.update(vendorId, updatePayload);

    return {
      success: true,
      message: `Step ${step} saved successfully`,
      onboardingStep: step,
      onboardingStatus: OnBoardingStatus.IN_PROGRESS,
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
