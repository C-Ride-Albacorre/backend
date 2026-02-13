// src/verification/services/verification-cache.service.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';

interface OtpCache {
  otp: string;
  attempts: number;
  expiresAt: number; // Unix timestamp in seconds
  verified: boolean;
  createdAt: number; // Unix timestamp in seconds
}

@Injectable()
export class VerificationCacheService {
  private readonly logger = new Logger(VerificationCacheService.name);

  // Configurable defaults with environment overrides
  private readonly OTP_EXPIRY: number;
  private readonly MAX_ATTEMPTS: number;
  private readonly ATTEMPT_WINDOW: number;
  private readonly VERIFIED_EXPIRY: number;

  // Key prefixes for better organization
  private readonly KEY_PREFIX = 'verification:otp';
  private readonly VALUE_PREFIX = 'verification:otp:value';
  private readonly ATTEMPT_PREFIX = 'verification:attempts';

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.OTP_EXPIRY = this.configService.get<number>('OTP_EXPIRY_SECONDS', 600); // 10 minutes
    this.MAX_ATTEMPTS = this.configService.get<number>('OTP_MAX_ATTEMPTS', 3);
    this.ATTEMPT_WINDOW = this.configService.get<number>(
      'OTP_ATTEMPT_WINDOW_SECONDS',
      300,
    ); // 5 minutes
    this.VERIFIED_EXPIRY = this.configService.get<number>(
      'OTP_VERIFIED_EXPIRY_SECONDS',
      300,
    ); // 5 minutes
  }

  /* ------------------ Key Helpers ------------------ */

  private buildOtpKey(identifier: string): string {
    return `${this.KEY_PREFIX}:${identifier}`;
  }

  private buildOtpValueKey(otp: string): string {
    return `${this.VALUE_PREFIX}:${otp}`;
  }

  private buildAttemptKey(identifier: string): string {
    return `${this.ATTEMPT_PREFIX}:${identifier}`;
  }

  /* ------------------ OTP Storage ------------------ */

  async storeOtp(identifier: string, otp: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + this.OTP_EXPIRY;

    const cacheData: OtpCache = {
      otp,
      attempts: 0,
      expiresAt,
      verified: false,
      createdAt: now,
    };

    // Store OTP data
    const otpKey = this.buildOtpKey(identifier);
    await this.redisService.safeSet(
      otpKey,
      cacheData,
      this.OTP_EXPIRY,
    );

    // Store OTP lookup by value (optional, with shorter TTL for security)
    const valueKey = this.buildOtpValueKey(otp);
    await this.redisService.safeSet(
      valueKey,
      { identifier, storedAt: now },
      Math.min(this.OTP_EXPIRY, 60), // Shorter TTL for value lookup (max 1 minute)
    );

    // Reset attempt counter for this identifier
    const attemptKey = this.buildAttemptKey(identifier);
    await this.redisService.safeSet(
      attemptKey,
      { attempts: 0, firstAttemptAt: now },
      this.ATTEMPT_WINDOW,
    );

    this.logger.debug(
      `OTP stored for ${identifier} (expires: ${new Date(expiresAt * 1000).toISOString()})`,
    );
    return true;
  }

  /* ------------------ OTP Validation ------------------ */

  async validateOtp(identifier: string, otp: string): Promise<boolean> {
    const cacheData = await this.getOtpCache(identifier);

    // Check if OTP exists
    if (!cacheData) {
      this.logger.debug(`No OTP found for ${identifier}`);
      return false;
    }

    // Check if already verified
    if (cacheData.verified) {
      this.logger.warn(`OTP already verified for ${identifier}`);
      await this.incrementFailedAttempt(identifier, 'already_verified');
      return false;
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (now > cacheData.expiresAt) {
      this.logger.warn(`OTP expired for ${identifier}`);
      await this.incrementFailedAttempt(identifier, 'expired');
      return false;
    }

    // Check attempt limits
    const currentAttempts = await this.getCurrentAttempts(identifier);
    if (currentAttempts >= this.MAX_ATTEMPTS) {
      this.logger.warn(
        `Max attempts (${this.MAX_ATTEMPTS}) reached for ${identifier}`,
      );
      return false;
    }

    // Validate OTP
    if (cacheData.otp !== otp) {
      this.logger.debug(`Invalid OTP for ${identifier}`);
      await this.incrementFailedAttempt(identifier, 'invalid_otp');

      // Update attempt count in cache
      cacheData.attempts++;
      await this.redisService.safeSet(
        this.buildOtpKey(identifier),
        cacheData,
        this.OTP_EXPIRY,
      );

      return false;
    }

    // OTP is valid - mark as verified
    this.logger.debug(`Valid OTP for ${identifier}`);
    await this.markAsVerified(identifier);

    // Clear attempt counter on successful verification
    await this.redisService.safeDel(this.buildAttemptKey(identifier));

    return true;
  }

  /* ------------------ Verification Management ------------------ */

  async markAsVerified(identifier: string): Promise<boolean> {
    const cacheData = await this.getOtpCache(identifier);
    if (!cacheData) {
      this.logger.warn(
        `Cannot mark non-existent OTP as verified for ${identifier}`,
      );
      return false;
    }

    cacheData.verified = true;
    // Update with shorter TTL for verified state
    await this.redisService.safeSet(
      this.buildOtpKey(identifier),
      cacheData,
      this.VERIFIED_EXPIRY,
    );

    this.logger.debug(`OTP marked as verified for ${identifier}`);

    return true;
  }

  async isVerified(identifier: string): Promise<boolean> {
    const cacheData = await this.getOtpCache(identifier);
    return cacheData?.verified || false;
  }

  /* ------------------ Cache Retrieval ------------------ */

  async getOtpCache(identifier: string): Promise<OtpCache | null> {
    try {
      return await this.redisService.safeGet<OtpCache>(
        this.buildOtpKey(identifier),
      );
    } catch (error) {
      this.logger.error(`Failed to get OTP cache for ${identifier}`, error);
      return null;
    }
  }

  async getIdentifierByOtp(otp: string): Promise<string | null> {
    try {
      const data = await this.redisService.safeGet<{
        identifier: string;
        storedAt: number;
      }>(this.buildOtpValueKey(otp));
      return data?.identifier || null;
    } catch (error) {
      this.logger.error(`Failed to get identifier by OTP`, error);
      return null;
    }
  }

  /* ------------------ Attempt Management ------------------ */

  private async getCurrentAttempts(identifier: string): Promise<number> {
    try {
      const attemptData = await this.redisService.safeGet<{
        attempts: number;
        firstAttemptAt: number;
      }>(this.buildAttemptKey(identifier));
      return attemptData?.attempts || 0;
    } catch (error) {
      return 0;
    }
  }

  private async incrementFailedAttempt(
    identifier: string,
    reason: string,
  ): Promise<void> {
    const attemptKey = this.buildAttemptKey(identifier);
    const now = Math.floor(Date.now() / 1000);

    let attemptData = await this.redisService.safeGet<{
      attempts: number;
      firstAttemptAt: number;
    }>(attemptKey);

    if (!attemptData) {
      attemptData = { attempts: 1, firstAttemptAt: now };
    } else {
      attemptData.attempts++;
    }

    await this.redisService.safeSet(
      attemptKey,
      attemptData,
      this.ATTEMPT_WINDOW,
    );

    this.logger.debug(
      `Failed attempt for ${identifier} (reason: ${reason}, attempts: ${attemptData.attempts})`,
    );
  }

  async getRemainingAttempts(identifier: string): Promise<number> {
    const currentAttempts = await this.getCurrentAttempts(identifier);
    return Math.max(0, this.MAX_ATTEMPTS - currentAttempts);
  }

  async getAttemptInfo(identifier: string): Promise<{
    attempts: number;
    remaining: number;
    firstAttemptAt?: number;
    windowExpiresAt?: number;
  }> {
    const attemptData = await this.redisService.safeGet<{
      attempts: number;
      firstAttemptAt: number;
    }>(this.buildAttemptKey(identifier));

    const attempts = attemptData?.attempts || 0;

    return {
      attempts,
      remaining: Math.max(0, this.MAX_ATTEMPTS - attempts),
      firstAttemptAt: attemptData?.firstAttemptAt,
      windowExpiresAt: attemptData?.firstAttemptAt
        ? attemptData.firstAttemptAt + this.ATTEMPT_WINDOW
        : undefined,
    };
  }

  /* ------------------ Cleanup & Maintenance ------------------ */

  async cleanupExpired(): Promise<number> {
    if (!this.redisService.isConnected()) {
      return 0;
    }

    let cleaned = 0;
    const now = Math.floor(Date.now() / 1000);

    // Note: This is a simplified cleanup. In production, use Redis SCAN for larger datasets
    try {
      // Optional: Implement pattern-based cleanup if needed
      // This would require adding scanKeys method to RedisService
      this.logger.debug(
        'Cleanup would run here - implement pattern scanning if needed',
      );
    } catch (error) {
      this.logger.error('Failed to clean up expired OTPs', error);
    }

    return cleaned;
  }

  async revokeOtp(identifier: string): Promise<boolean> {
    const cacheData = await this.getOtpCache(identifier);
    if (!cacheData) {
      return false;
    }

    // Delete OTP data
    await this.redisService.safeDel(this.buildOtpKey(identifier));

    // Delete OTP value lookup
    await this.redisService.safeDel(this.buildOtpValueKey(cacheData.otp));

    // Delete attempt counter
    await this.redisService.safeDel(this.buildAttemptKey(identifier));

    this.logger.debug(`OTP revoked for ${identifier}`);
    return true;
  }

  async getOtpStatus(identifier: string): Promise<{
    exists: boolean;
    verified: boolean;
    expired: boolean;
    attempts: number;
    remainingAttempts: number;
    expiresAt?: number;
    createdAt?: number;
  }> {
    const cacheData = await this.getOtpCache(identifier);
    const attemptInfo = await this.getAttemptInfo(identifier);
    const now = Math.floor(Date.now() / 1000);

    return {
      exists: !!cacheData,
      verified: cacheData?.verified || false,
      expired: cacheData ? now > cacheData.expiresAt : true,
      attempts: attemptInfo.attempts,
      remainingAttempts: attemptInfo.remaining,
      expiresAt: cacheData?.expiresAt,
      createdAt: cacheData?.createdAt,
    };
  }

  /* ------------------ Statistics ------------------ */

  async getStats(): Promise<{
    redisConnected: boolean;
    config: {
      otpExpiry: number;
      maxAttempts: number;
      attemptWindow: number;
      verifiedExpiry: number;
    };
  }> {
    return {
      redisConnected: this.redisService.isConnected(),
      config: {
        otpExpiry: this.OTP_EXPIRY,
        maxAttempts: this.MAX_ATTEMPTS,
        attemptWindow: this.ATTEMPT_WINDOW,
        verifiedExpiry: this.VERIFIED_EXPIRY,
      },
    };
  }


  
}
