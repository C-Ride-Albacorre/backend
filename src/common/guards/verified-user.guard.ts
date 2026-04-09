import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class VerifiedUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user.isEmailVerified || !user.isPhoneVerified) {
      throw new ForbiddenException(
        'Complete verification before accessing this resource',
      );
    }

    return true;
  }
}
