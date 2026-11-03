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
    const redirectUri = request.query.redirect_uri as string | undefined;

    // Whitelist redirect_uri (only allow known schemes / domains)
    const safeRedirect = this.sanitizeRedirect(redirectUri);

    const stateData = {
      role,
      redirectUri: safeRedirect, // <-- carried through Google
      timestamp: Date.now(),
      nonce: Math.random().toString(36).substring(2, 15),
    };

    const state = Buffer.from(JSON.stringify(stateData)).toString('base64');

    request.oauthState = state;

    response.cookie('oauth_role', role, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
    });

    this.logger.debug(`OAuth state: role=${role}, redirectUri=${safeRedirect}`);

    return (await super.canActivate(context)) as boolean;
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const options: any = { scope: ['email', 'profile'] };
    if (request.oauthState) options.state = request.oauthState;
    return options;
  }

  private sanitizeRedirect(uri?: string): string | null {
    if (!uri) return null;

    try {
      // Allow custom schemes (mobile deep links)
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) {
        const scheme = uri.split('://')[0];
        const allowedSchemes = (process.env.OAUTH_ALLOWED_SCHEMES || 'yourapp,exp')
          .split(',')
          .map((s) => s.trim());
        if (!allowedSchemes.includes(scheme)) {
          this.logger.warn(`Blocked redirect scheme: ${scheme}`);
          return null;
        }
        return uri;
      }

      // Allow only your frontend host for https
      const allowedHosts = (process.env.OAUTH_ALLOWED_HOSTS || '')
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean);
      const parsed = new URL(uri);
      if (allowedHosts.includes(parsed.host)) return uri;

      this.logger.warn(`Blocked redirect host: ${parsed.host}`);
      return null;
    } catch {
      return null;
    }
  }
}