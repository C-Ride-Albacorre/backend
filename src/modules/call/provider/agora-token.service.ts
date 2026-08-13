// agora-token.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';

@Injectable()
export class AgoraTokenService {
  public appId: string;
  private appCertificate: string;

  constructor(private config: ConfigService) {
    this.appId = this.config.get('AGORA_APP_ID');
    this.appCertificate = this.config.get('AGORA_APP_CERTIFICATE');
    if (!this.appId || !this.appCertificate) {
      throw new Error('Agora credentials are missing');
    }
  }

  /**
   * Generate an RTC token for a user to join a specific channel.
   * @param userId - Unique identifier for the user (string or number)
   * @param channelName - The Agora channel name
   * @param role - RtcRole.PUBLISHER (for both caller and callee) or SUBSCRIBER
   * @param expireTimeInSeconds - Token validity (default 24h)
   */
  generateToken(
    userId: string | number,
    channelName: string,
    role: number = RtcRole.PUBLISHER,
    expireTimeInSeconds: number = 86400,
  ): string {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expireTimeInSeconds;

    // Agora expects a numeric UID; we can hash the userId if it's a string.
    const uid = typeof userId === 'string' ? this.hashUserId(userId) : userId;

    const token = RtcTokenBuilder.buildTokenWithUid(
      this.appId,
      this.appCertificate,
      channelName,
      uid,
      role,
      privilegeExpiredTs,
    );
    return token;
  }

  /**
   * Simple hash to convert a string userId to a 32-bit integer.
   * (Agora accepts uint32; collisions are rare enough for this purpose.)
   */
  private hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}