import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { OAuthProviderType } from '@prisma/client';
import { AuthService } from '../../modules/auth/auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL:
        configService.get<string>('GOOGLE_CALLBACK_URL') ||
        'https://staging.menuapi.tezzasolutions.com/api/v1/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    try {
      const { id: providerId, name, emails } = profile;
      const email = emails?.[0]?.value;
      const fullName = name?.givenName + ' ' + (name?.familyName || '');

      const result = await this.authService.validateOAuthLogin({
        provider: OAuthProviderType.GOOGLE,
        providerId,
        email,
        name: fullName,
       
      });

      done(null, result);
    } catch (error) {
      done(error, false);
    }
  }
}
