import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZohoEmailProvider } from './providers/zoho-email.provider';
import { TermiiSmsProvider } from './providers/termii-sms.provider';
import {
  ConsoleEmailProvider,
  ConsoleSmsProvider,
} from './providers/console.provider';
import { VerificationCacheService } from './verification-cache.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { VerificationPurpose } from '../../shared/enums';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  public readonly emailProvider: any;
  public readonly smsProvider: any;
  public readonly isProduction: boolean;

  constructor(
    private configService: ConfigService,
    private verificationCache: VerificationCacheService,
    private zohoEmailProvider: ZohoEmailProvider,
    private termiiSmsProvider: TermiiSmsProvider,
    private consoleEmailProvider: ConsoleEmailProvider,
    private consoleSmsProvider: ConsoleSmsProvider,
  ) {
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    // Choose providers based on environment
    // this.emailProvider = this.isProduction
    //   ? zohoEmailProvider
    //   : consoleEmailProvider;
     this.emailProvider = this.isProduction
      ? zohoEmailProvider
      : zohoEmailProvider;

    this.smsProvider = this.isProduction
      ? termiiSmsProvider
      : consoleSmsProvider;
  }

  /**
   * Send OTP based on identifier type (email or phone)
   */
  async sendOtp(dto: SendOtpDto): Promise<any> {
    const { identifier, purpose = VerificationPurpose.REGISTRATION } = dto;

    // Check if identifier is email or phone
    const isEmail = identifier.includes('@');

    // Generate OTP
    const otp = this.generateOtp();

    // Store in cache
    await this.verificationCache.storeOtp(identifier, otp);

    // Send OTP via appropriate channel
    if (isEmail) {
      return await this.emailProvider.sendOtp(identifier, otp);
    } else {
      return await this.smsProvider.sendOtp(identifier, otp);
    }
  }

  // 2. Update your verification.service.ts
  async verifyOtp(dto: VerifyOtpDto): Promise<boolean> {
    const { identifier, otp } = dto;

    const isValid = await this.verificationCache.validateOtp(identifier, otp);

    if (isValid) {
      this.logger.log(`OTP verified successfully for ${identifier}`);
      await this.verificationCache.markAsVerified(identifier);
    } else {
      this.logger.warn(`Invalid OTP attempt for ${identifier}`);
    }

    return isValid;
  }

  /**
   * Verify OTP
   */
  async verifyOtpBK(dto: VerifyOtpDto): Promise<boolean> {
    const { identifier, otp } = dto;

    const isValid = await this.verificationCache.validateOtp(identifier, otp);

    if (isValid) {
      this.logger.log(`OTP verified successfully for ${identifier}`);

      // Mark as verified
      await this.verificationCache.markAsVerified(identifier);

      // Here you would update user verification status in database
      // await this.userService.markAsVerified(identifier);
    } else {
      this.logger.warn(`Invalid OTP attempt for ${identifier}`);
    }

    return isValid;
  }

  /**
   * Check if identifier is verified
   */
  async isVerified(identifier: string): Promise<boolean> {
    const cacheData = await this.verificationCache.getOtpCache(identifier);
    return cacheData?.verified || false;
  }

  /**
   * Get remaining verification attempts
   */
  async getRemainingAttempts(identifier: string): Promise<number> {
    return this.verificationCache.getRemainingAttempts(identifier);
  }

  /**
   * Generate random OTP
   */
  private generateOtp(length: number = 6): string {
    const digits = '0123456789';
    let otp = '';

    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }

    return otp;
  }

  /**
   * Send welcome email after successful verification
   */
  async sendWelcomeEmail(email: string, name: string): Promise<void> {
    const subject = 'Welcome to Our Platform!';
    const html = `
      <h1>Welcome, ${name}!</h1>
      <p>Your account has been successfully verified and is now active.</p>
      <p>Thank you for joining our community!</p>
    `;

    await this.emailProvider.sendEmail(email, subject, '', html);
  }

  /**
   * Send welcome SMS after successful verification
   */
  async sendWelcomeSms(phoneNumber: string, name: string): Promise<void> {
    const message = `Welcome ${name}! Your account has been verified. Thank you for joining us!`;

    await this.smsProvider.sendSms(phoneNumber, message);
  }

  /**
   * Clear OTP after use (for password reset)
   */
  /**
   * Clear OTP after successful use
   */
  async clearOtp(identifier: string): Promise<boolean> {
    return this.verificationCache.revokeOtp(identifier);
  }

  async verifyVendorOtp(
    identifier: string,
    otp: string,
    purpose: VerificationPurpose,
  ): Promise<{
    isValid: boolean;
    identifier: string;
    purpose: VerificationPurpose;
  }> {
    const isValid = await this.verificationCache.validateOtp(identifier, otp);

    if (isValid) {
      this.logger.log(
        `Vendor OTP verified successfully for ${identifier} (${purpose})`,
      );
      await this.verificationCache.markAsVerified(identifier);

      // You could emit an event here for vendor verification
      // this.eventEmitter.emit('vendor.verified', { identifier, purpose });
    }

    return { isValid, identifier, purpose };
  }
}
