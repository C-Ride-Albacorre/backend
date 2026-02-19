/* eslint-disable prettier/prettier */
import { Injectable, ExecutionContext, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const role = request.query.role as string | undefined;

    if (role) {
      // Create state object with role
      const stateData = {
        role,
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(2, 15),
      };

      // In strategy validate
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      if (stateData.timestamp < fiveMinutesAgo) {
        throw new Error('State parameter expired');
      }

      // Encode to base64
      const stateString = JSON.stringify(stateData);
      const state = Buffer.from(stateString).toString('base64');

      // Store in request for getAuthenticateOptions
      request.oauthState = state;

      // Also set a cookie as backup
      response.cookie('oauth_role', role, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 5 * 60 * 1000,
      });

      this.logger.debug(`Set OAuth state with role: ${role}`);
    }

    return (await super.canActivate(context)) as boolean;
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    const options: any = {
      scope: ['email', 'profile'],
    };

    if (request.oauthState) {
      options.state = request.oauthState;
    }

    return options;
  }
}
