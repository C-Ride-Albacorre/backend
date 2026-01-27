// // src/verification/services/verification-cache.service.ts
// import { Injectable, Logger } from '@nestjs/common';
// import { InjectRedis } from '@nestjs-modules/ioredis';
// import Redis from 'ioredis';

// interface OtpCache {
//   otp: string;
//   attempts: number;
//   expiresAt: Date;
//   verified: boolean;
// }

// @Injectable()
// export class VerificationCacheService {
//   private readonly logger = new Logger(VerificationCacheService.name);
//   private readonly OTP_EXPIRY = 600; // 10 minutes in seconds
//   private readonly MAX_ATTEMPTS = 3;
//   private readonly ATTEMPT_WINDOW = 300; // 5 minutes in seconds

//   constructor(@InjectRedis() private readonly redis: Redis) {}

//   async storeOtp(identifier: string, otp: string): Promise<void> {
//     const cacheData: OtpCache = {
//       otp,
//       attempts: 0,
//       expiresAt: new Date(Date.now() + this.OTP_EXPIRY * 1000),
//       verified: false,
//     };

//     await this.redis.setex(
//       `otp:${identifier}`,
//       this.OTP_EXPIRY,
//       JSON.stringify(cacheData),
//     );

//     // Store OTP for lookup by value (optional, for debugging)
//     await this.redis.setex(`otp:value:${otp}`, this.OTP_EXPIRY, identifier);

//     this.logger.debug(`OTP stored for ${identifier}`);
//   }

//   async validateOtp(identifier: string, otp: string): Promise<boolean> {
//     const cacheData = await this.getOtpCache(identifier);

//     if (!cacheData) {
//       return false;
//     }

//     if (cacheData.verified) {
//       this.logger.warn(`OTP already verified for ${identifier}`);
//       return false;
//     }

//     if (cacheData.attempts >= this.MAX_ATTEMPTS) {
//       this.logger.warn(`Max attempts reached for ${identifier}`);
//       return false;
//     }

//     if (new Date() > cacheData.expiresAt) {
//       this.logger.warn(`OTP expired for ${identifier}`);
//       return false;
//     }

//     // Increment attempts
//     cacheData.attempts++;
//     await this.redis.setex(
//       `otp:${identifier}`,
//       this.OTP_EXPIRY,
//       JSON.stringify(cacheData),
//     );

//     if (cacheData.otp === otp) {
//       // Mark as verified
//       cacheData.verified = true;
//       await this.redis.setex(
//         `otp:${identifier}`,
//         300, // Keep verified status for 5 minutes
//         JSON.stringify(cacheData),
//       );
//       return true;
//     }

//     return false;
//   }

//   async markAsVerified(identifier: string): Promise<void> {
//     const cacheData = await this.getOtpCache(identifier);
//     if (cacheData) {
//       cacheData.verified = true;
//       await this.redis.setex(
//         `otp:${identifier}`,
//         300,
//         JSON.stringify(cacheData),
//       );
//     }
//   }

//   async getOtpCache(identifier: string): Promise<OtpCache | null> {
//     const data = await this.redis.get(`otp:${identifier}`);
//     if (!data) return null;
//     return JSON.parse(data);
//   }

//   async getRemainingAttempts(identifier: string): Promise<number> {
//     const cacheData = await this.getOtpCache(identifier);
//     if (!cacheData) return this.MAX_ATTEMPTS;
//     return Math.max(0, this.MAX_ATTEMPTS - cacheData.attempts);
//   }

//   async cleanup(): Promise<void> {
//     // Cleanup expired OTPs periodically
//     // This can be called from a scheduled task
//   }
// }
