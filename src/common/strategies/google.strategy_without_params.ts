import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(config: ConfigService) {
    super({
      clientID: config.get('GOOGLE_CLIENT_ID'),
      clientSecret: config.get('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.get('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    this.logger.debug(
      `Google profile received: ${JSON.stringify({
        id: profile.id,
        emails: profile.emails,
        name: profile.name,
        photos: profile.photos?.[0]?.value,
      })}`,
    );

    const { id, name, emails, photos } = profile;

    // IMPORTANT: Return the user object with the correct structure
    const user = {
      provider: 'GOOGLE',
      providerId: id, // ← This is the Google ID
      email: emails?.[0]?.value || null,
      firstName: name?.givenName || '',
      lastName: name?.familyName || '',
      picture: photos?.[0]?.value,
      accessToken,
      refreshToken,
    };

    this.logger.debug(
      `User object being passed to request: ${JSON.stringify({
        provider: user.provider,
        providerId: user.providerId,
        email: user.email,
      })}`,
    );

    done(null, user);
  }
}
