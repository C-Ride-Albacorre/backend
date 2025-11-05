// google.strategy.ts
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get('GOOGLE_CLIENT_ID'),
      clientSecret: config.get('GOOGLE_CLIENT_SECRET'),
      callbackURL: `${config.get('GOOGLE_CALLBACK_URL')} || https://clear-essence-backend.onrender.com/api/v1/auth/google/callback`,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, name, emails, photos } = profile;
      const fullName = name?.givenName + ' ' + (name?.familyName || '');

    const user = {
      id, // providerId
      email: emails?.[0]?.value,
      name: fullName,
      picture: photos?.[0]?.value,
      accessToken,
    };

    done(null, user);
  }
}
