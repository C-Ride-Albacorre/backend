import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { OAuthState } from '../interfaces/interface';
import { UserRole } from 'src/shared/enums';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(private readonly config: ConfigService) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.get<string>('GOOGLE_CALLBACK_URL'),
      passReqToCallback: true,
    });
  }

  async validate(
    req: Request,
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ) {
    let role: string | undefined;

    // Method 1: Try to get from state parameter (this is where it should be)
    const stateRaw = req.query.state as string | undefined;

    if (stateRaw) {
      try {
        // The state might be URL encoded, so decode it first
        const decodedState = decodeURIComponent(stateRaw);

        // Parse the base64
        const jsonStr = Buffer.from(decodedState, 'base64').toString('utf-8');

        // Parse the JSON
        const stateData = JSON.parse(jsonStr) as OAuthState;

        role = stateData?.role;

        this.logger.debug(`Parsed role from state: ${role}`);
      } catch (err) {
        this.logger.error('Failed to parse state:', err);
      }
    }

    // Method 2: Try cookie as fallback
    if (!role && req.cookies?.oauth_role) {
      role = req.cookies.oauth_role;
    }

    // ADD DEFAULT ROLE FALLBACK HERE 🔥
    if (!role) {
      this.logger.warn(
        'No role provided in OAuth flow, using default CUSTOMER role',
      );
      role = UserRole.CUSTOMER;
    }

    // Clear cookie if it exists
    if (req.res && req.cookies?.oauth_role) {
      req.res.clearCookie('oauth_role');
    }

    // Create the user object
    const user = {
      provider: 'GOOGLE',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      firstName: profile.name?.givenName,
      lastName: profile.name?.familyName,
      picture: profile.photos?.[0]?.value,
      requestedRole: role,
    };

    done(null, user);
  }
}
