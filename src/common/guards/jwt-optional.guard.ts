// common/guards/jwt-optional.guard.ts
import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtOptionalGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    // If there's an error or no user, just return null – do NOT throw
    if (err || !user) {
      return null;
    }
    return user;
  }
}
