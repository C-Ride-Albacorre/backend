import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../shared/enums/user-role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRole = this.reflector.get<UserRole>('roles', context.getHandler());
    if (!requiredRole) {
      return true; // No specific role required, access allowed
    }
    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.role || user.role !== requiredRole) {
      return false; // User doesn't have required role
    }
    return true;
  }
}
