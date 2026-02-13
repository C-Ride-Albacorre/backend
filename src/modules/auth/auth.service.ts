import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ConfigService } from '@nestjs/config';
// import { ForgotPasswordDto } from './dto/forgot-password.dto';
// import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetTokenDto,
} from './dto/password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { OAuthProviderType, UserStatus } from '@prisma/client';
import Helper from '../../shared/utils/helpers';
import {
  AuthResponse,
  TokenPayload,
} from './interface/auth-response.interface';
import { BusinessInfo, User } from '../user/entities/user.entity';
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
   * Register customer with automatic OTP
   */
  async registerCustomer(dto: CreateCustomerDto) {
    const { email, phoneNumber } = dto;
    this.logger.log(`Registering customer: ${email || phoneNumber}`);

    const { user, requiresVerification } =
      await this.userService.createCustomer({
        email: email,
        phoneNumber: phoneNumber,
        password: dto.password,
        firstName: dto.firstName,
        lastName: dto.lastName,
      });

    // Return different response based on verification status
    if (requiresVerification) {
      return {
        success: true,
        requiresVerification: true,
        message: 'Registration successful. Please verify your account.',
        verificationIdentifier: user.email || user.phoneNumber,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          isVerified: false,
        },
      };
    }

    // If no verification required, generate tokens immediately
    return this.generateAuthResponse(user);
  }

  // async registerCustomer(dto: CreateCustomerDto) {
  //   const { email, phoneNumber, firstName, lastName, password } = dto;
  //   this.logger.log(`Registering customer: ${email || phoneNumber}`);

  //   const user = await this.userService.createCustomer({
  //     email: email,
  //     phoneNumber: phoneNumber,
  //     password: password,
  //     firstName: firstName,
  //     lastName: lastName,
  //   });

  //   return this.generateAuthResponse(user);
  // }

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

    try {
      // Verify the refresh token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.refreshTokenSecret,
      });

      const user = await this.userService.findById(payload.sub);

      if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or inactive');
      }

      // If rotation is enabled, verify stored hash
      if (this.refreshTokenRotationEnabled && user.refreshTokenHash) {
        const isValid = await bcrypt.compare(
          refreshToken,
          user.refreshTokenHash,
        );
        if (!isValid) {
          this.logger.warn(`Invalid refresh token used for user: ${user.id}`);
          // Invalidate all refresh tokens for this user (potential token theft)
          await this.userService.updateRefreshToken(user.id, null);
          throw new UnauthorizedException('Invalid refresh token');
        }
      }

      // Generate new tokens
      const newTokens = await this.generateAuthResponse(user);

      // Invalidate old refresh token if rotation is enabled
      if (this.refreshTokenRotationEnabled) {
        await this.rotateRefreshToken(
          user.id,
          refreshToken,
          newTokens.refreshToken,
        );
      }

      this.logger.log(`Tokens refreshed for user: ${user.id}`);
      return newTokens;
    } catch (error) {
      this.logger.error(`Token refresh failed: ${error.message}`);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

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

    await this.userService.markUserLogin(user.id);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        role: user.role, // ✅ dynamic role
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

  // private generateResetToken(userId: string): string {
  //   return this.jwtService.sign(
  //     {
  //       userId,
  //       type: 'password_reset',
  //       jti: crypto.randomBytes(16).toString('hex'),
  //     },
  //     {
  //       secret: this.config.get<string>('JWT_SECRET'),
  //       expiresIn: this.passwordResetTokenExpiresIn,
  //     },
  //   );
  // }

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
   * Initiate password reset process
   */
  // async forgotPassword(dto: ForgotPasswordDto): Promise<{
  //   success: boolean;
  //   message: string;
  //   identifier?: string;
  //   method?: 'email' | 'sms';
  // }> {
  //   const { email, phoneNumber } = dto;
  //   const identifier = email || phoneNumber;

  //   this.logger.log(`Password reset requested for: ${identifier}`);

  //   // Find user by identifier
  //   // const user = await this.userService.findExistingUser(email, phoneNumber);
  //   const user = await this.userService.findUserByIdentifier(identifier);
  //   // Security: Always return success even if user not found
  //   if (!user) {
  //     this.logger.debug(`User not found for password reset: ${identifier}`);
  //     return {
  //       success: true,
  //       message:
  //         'If an account exists with this email/phone, you will receive reset instructions.',
  //     };
  //   }

  //   // Check if user is active
  //   if (!user.isActive) {
  //     this.logger.warn(`Password reset attempt for inactive user: ${user.id}`);
  //     return {
  //       success: true,
  //       message:
  //         'If an account exists with this email/phone, you will receive reset instructions.',
  //     };
  //   }

  //   // Check if user is verified
  //   if (!user.isVerified) {
  //     this.logger.warn(
  //       `Password reset attempt for unverified user: ${user.id}`,
  //     );
  //     return {
  //       success: false,
  //       message: 'Please verify your account first before resetting password.',
  //     };
  //   }

  //   // Generate reset token
  //   const resetToken = this.generateResetToken(user.id);

  //   // Determine reset method (email or SMS)
  //   const method = email ? 'email' : 'sms';

  //   try {
  //     if (method === 'email' && user.email) {
  //       await this.sendPasswordResetEmail(user, resetToken);
  //     } else if (method === 'sms' && user.phoneNumber) {
  //       await this.sendPasswordResetSms(user, resetToken);
  //     } else {
  //       throw new Error(`No ${method} available for user ${user.id}`);
  //     }

  //     this.logger.log(
  //       `Password reset ${method} sent to ${identifier} for user ${user.id}`,
  //     );

  //     return {
  //       success: true,
  //       message: 'Password reset instructions sent successfully.',
  //       identifier,
  //       method,
  //     };
  //   } catch (error) {
  //     this.logger.error(
  //       `Failed to send password reset ${method}: ${error.message}`,
  //     );
  //     return {
  //       success: false,
  //       message: 'Failed to send reset instructions. Please try again later.',
  //     };
  //   }
  // }

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
    const resetLink = `${this.frontendUrl}/auth/reset-password?token=${resetToken}`;
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

  // async forgotPassword(dto: ForgotPasswordDto) {
  //   const { email } = dto;
  //   if (!email) throw new BadRequestException('Email is required');

  //   const user = await this.userService.findByEmail(email);
  //   if (!user) {
  //     return { ok: true }; // do not reveal if user exists
  //   }

  //   const secret = this.config.get<string>('JWT_SECRET');
  //   if (!secret) throw new Error('JWT_SECRET not configured');

  //   const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '1d' });

  //   console.log('Generated reset token:', token);

  //   const expiresAt = new Date(
  //     Date.now() +
  //       Number(this.config.get('PASSWORD_RESET_TOKEN_EXPIRES_MIN') || 60) *
  //         60000,
  //   );

  //   const frontendUrl = this.config.get('FRONTEND_URL');
  //   if (!frontendUrl) throw new Error('FRONTEND_URL not configured');

  //   const resetLink = `${frontendUrl}/auth/reset-password?token=${token}`;
  //   const timeframe = expiresAt;
  //   const subject = 'Password reset';
  //   const context = {
  //     user: user?.firstName + ' ' + user?.lastName || 'there',
  //     resetLink,
  //     timeframe,
  //   };
  //   const templateName = 'forgotPassword';

  //   // try {
  //   //   await this.mailGunService.sendEmailWithTemplate({
  //   //     to: email,
  //   //     subject,
  //   //     templateName,
  //   //     context,
  //   //   });
  //   // } catch (error) {
  //   //   console.error('Mail sending failed:', error);
  //   //   throw new InternalServerErrorException(
  //   //     'Failed to send password reset email',
  //   //   );
  //   // }

  //   return { ok: true, message: 'Password reset email sent' };
  // }

  // async resetPassword(dto: ResetPasswordDto) {
  //   const { token, newPassword } = dto;
  //   if (!token || !newPassword) {
  //     throw new BadRequestException('Token and new password are required');
  //   }
  //   const decoded = this.jwtService.verify(token);
  //   if (!decoded || !decoded.userId) {
  //     throw new UnauthorizedException('Invalid token');
  //   }

  //   const hashed = await bcrypt.hash(newPassword, 12);
  //   await this.userService.updatePassword(decoded.userId, hashed);

  //   return 'Password successfully reset';
  // }

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
  async handleOAuthCallback(profile: any, provider: OAuthProviderType) {
    if (!profile?.email) {
      throw new BadRequestException(`${provider} account has no email`);
    }

    // Call existing helper in UserService
    const user = await this.userService.createOrGetOAuthUser({
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      provider,
      providerId: profile.id, // Google ID
    });

    // Sign JWT (same as manual signup)
    return this.signJwt(user);
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
        'Verify email first, then phone',
        'Complete business onboarding after both verifications',
      ],
    };
  }

  /**
   * Verify Vendor Email - Step 2
   */
  // 3. Update your vendor-auth.service.ts
  async verifyVendorEmail(dto: VerifyEmailDto): Promise<{
    success: boolean;
    message: string;
    nextAction: string;
    vendor: Partial<User>;
  }> {
    this.logger.log(`Verifying email for: ${dto.email}`);

    const isValid = await this.verificationService.verifyOtp({
      identifier: dto.email,
      otp: dto.otp,
      purpose: VerificationPurpose.VENDOR_EMAIL_VERIFICATION,
      // metadata: {
      //   vendorId: dto.vendorId, // If you have it
      //   verificationType: 'email',
      // },
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    // Get vendor by email
    const vendor = await this.userRepository.findByEmail(dto.email);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    // Update email verification status
    vendor.isEmailVerified = true;
    vendor.emailVerifiedAt = new Date();

    // Update overall status
    if (!vendor.isPhoneVerified) {
      vendor.status = UserStatus.PENDING_PHONE_VERIFICATION;
    } else {
      vendor.status = UserStatus.PENDING_ONBOARDING;
    }

    const updatedVendor = await this.userRepository.update(vendor.id, vendor);

    return {
      success: true,
      message: 'Email verified successfully',
      nextAction: vendor.isPhoneVerified
        ? 'Complete business onboarding'
        : 'Verify your phone number',
      vendor: {
        id: updatedVendor.id,
        email: updatedVendor.email,
        phoneNumber: updatedVendor.phoneNumber,
        isEmailVerified: updatedVendor.isEmailVerified,
        isPhoneVerified: updatedVendor.isPhoneVerified,
        status: updatedVendor.status,
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

    // Verify OTP
    const isValid = await this.verificationService.verifyOtp({
      identifier: dto.phoneNumber,
      otp: dto.otp,
      purpose: VerificationPurpose.VENDOR_PHONE_VERIFICATION,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    // Get vendor by phone
    const vendor = await this.userRepository.findByPhone(dto.phoneNumber);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    // Check if email is already verified
    if (!vendor.isEmailVerified) {
      throw new BadRequestException('Please verify your email first');
    }

    // Update phone verification status
    vendor.isPhoneVerified = true;
    vendor.phoneVerifiedAt = new Date();
    vendor.status = UserStatus.PENDING_ONBOARDING;

    const updatedVendor = await this.userRepository.update(vendor.id, vendor);

    return {
      success: true,
      message: 'Phone verified successfully',
      nextAction: 'Complete business onboarding',
      vendor: {
        id: updatedVendor.id,
        email: updatedVendor.email,
        phoneNumber: updatedVendor.phoneNumber,
        isEmailVerified: updatedVendor.isEmailVerified,
        isPhoneVerified: updatedVendor.isPhoneVerified,
        status: updatedVendor.status,
      },
    };
  }

  /**
   * Vendor Login
   */
  async loginVendor(loginDto: LoginDto): Promise<AuthResponse> {
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
    if (!vendor.onboardingCompletedAt) {
      throw new UnauthorizedException(
        'Please complete business onboarding before logging in',
      );
    }

    // Check account status
    if (vendor.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(
        `Account is ${vendor.status.toLowerCase()}. Please contact support.`,
      );
    }

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

  /**
 Complete vendor onboarding with business details
   **/
  async completeVendorOnboarding0(
    vendorId: string,
    businessDetails: Partial<BusinessInfo>,
  ): Promise<User> {
    try {
      this.logger.log(`Completing vendor onboarding for: ${vendorId}`);

      const vendor = await this.userRepository.findById(vendorId);

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
      }

      if (vendor.status !== UserStatus.PENDING_ONBOARDING) {
        throw new ConflictException(
          'Vendor is not in the correct status for onboarding',
        );
      }

      const now = new Date();

      // Use transaction to ensure atomic operation
      await this.prisma.$transaction(async (tx) => {
        // 1️⃣ Update user status
        await tx.user.update({
          where: { id: vendorId },
          data: {
            status: UserStatus.ACTIVE,
            onboardingCompletedAt: now,
            updatedAt: now,
          },
        });

        // 2️⃣ Upsert business info
        await tx.businessInfo.upsert({
          where: { userId: vendorId },
          update: {
            ...businessDetails,
            updatedAt: now,
          },
          create: {
            user: {
              connect: { id: vendorId },
            },
            businessName: businessDetails.businessName ?? '',
            businessType: businessDetails.businessType ?? '',
            description: businessDetails.description ?? '',
            businessEmail: businessDetails.businessEmail ?? '',
            businessPhone: businessDetails.businessPhone ?? '',
            address: businessDetails.address ?? '',
            city: businessDetails.city ?? '',
            state: businessDetails.state ?? '',
            bankName: businessDetails.bankName ?? '',
            accountNumber: businessDetails.accountNumber ?? '',
            accountName: businessDetails.accountName ?? '',
          },
        });
      });

      // Return updated user with relations
      return await this.userRepository.findById(vendorId);
    } catch (error) {
      this.logger.error(
        `Failed to complete vendor onboarding ${vendorId}: ${error.message}`,
      );
      throw error;
    }
  }

  // src/users/services/vendor.service.ts

  // Add these methods to your existing VendorService

  /**
   * Complete vendor onboarding with business details and documents
   */
  /**
   * Complete vendor onboarding with document uploads
   */

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
    };
  }

  // async completeVendorOnboardingbk(
  //   vendorId: string,
  //   dto: CompleteOnboardingDto,
  //   files: Express.Multer.File[], // Files from the request
  // ): Promise<{
  //   success: boolean;
  //   message: string;
  //   vendor: Partial<User>;
  //   uploadedDocuments: any[];
  // }> {
  //   this.logger.log(`Completing vendor onboarding: ${vendorId}`);

  //   // Validate vendor
  //   await this.validateVendorForOnboarding(vendorId);

  //   // Validate files match document descriptions
  //   if (files.length !== dto.documents.length) {
  //     throw new BadRequestException(
  //       `Number of files (${files.length}) does not match number of document descriptions (${dto.documents.length})`,
  //     );
  //   }

  //   // Upload all documents to Cloudinary
  //   const uploadedDocuments = await this.uploadVendorDocuments(
  //     vendorId,
  //     files,
  //     dto.documents,
  //   );

  //   // Prepare business info data
  //   const businessInfoData = this.prepareBusinessInfoData(dto);

  //   // Complete onboarding in repository
  //   const updatedVendor = await this.userRepository.completeVendorOnboarding(
  //     vendorId,
  //     businessInfoData,
  //     uploadedDocuments,
  //   );

  //   return {
  //     success: true,
  //     message:
  //       'Vendor onboarding completed successfully. Your account is now under review.',
  //     vendor: {
  //       id: updatedVendor.id,
  //       email: updatedVendor.email,
  //       status: updatedVendor.status,
  //     },
  //     uploadedDocuments: uploadedDocuments.map((doc) => ({
  //       documentType: doc.documentType,
  //       documentUrl: doc.documentUrl,
  //       publicId: doc.publicId,
  //     })),
  //   };
  // }

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
  private async uploadVendorDocumentsbk(
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
