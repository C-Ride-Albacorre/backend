// src/auth/services/google-token-verifier.service.ts
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleIdTokenPayload {
  sub: string;              // Google's stable user ID (= providerId)
  email: string;
  email_verified: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
}

@Injectable()
export class GoogleTokenVerifier {
  private readonly logger = new Logger(GoogleTokenVerifier.name);
  private readonly client: OAuth2Client;
  private readonly audiences: string[];

  constructor(private readonly configService: ConfigService) {
    this.client = new OAuth2Client();

    // Collect ALL possible audiences for this app:
    // - Web client ID (browser flow uses this; native tokens also target it by default)
    // - iOS client ID
    // - Android client ID
    this.audiences = [
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_IOS_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_ANDROID_CLIENT_ID'),
    ].filter((v): v is string => !!v);

    if (this.audiences.length === 0) {
      this.logger.error(
        'No Google client IDs configured (GOOGLE_CLIENT_ID / GOOGLE_IOS_CLIENT_ID / GOOGLE_ANDROID_CLIENT_ID)',
      );
    }
  }

  async verify(idToken: string): Promise<GoogleIdTokenPayload> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.audiences,
      });

      const payload = ticket.getPayload();
      if (!payload?.sub || !payload?.email) {
        throw new UnauthorizedException('Invalid Google token payload');
      }

      if (!payload.email_verified) {
        throw new UnauthorizedException('Google account email is not verified');
      }

      return {
        sub: payload.sub,
        email: payload.email,
        email_verified: payload.email_verified,
        given_name: payload.given_name,
        family_name: payload.family_name,
        name: payload.name,
        picture: payload.picture,
      };
    } catch (error: any) {
      this.logger.warn(`Google ID token verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid Google ID token');
    }
  }
}