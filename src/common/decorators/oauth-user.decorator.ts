import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface OAuthUser {
  provider: string;
  providerId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  picture?: string;
  requestedRole?: string;
}

export const OAuthUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): OAuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
