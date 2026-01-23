import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../shared/enums';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  private normalizeRole(role: string): string {
    if (!role) return '';
    const r = role.toLowerCase().replace(/[-\s]/g, '');
    if (r === 'SUPER_ADMIN' || r === 'SUPER_ADMIN') return 'SUPER_ADMIN';
    if (r === 'ADMIN') return 'ADMIN';
    if (r === 'CUSTOMER') return 'CUSTOMER';
    if (r === 'VENDOR') return 'VENDOR';
    if (r === 'DISPATCHER') return 'DISPATCHER';
     return role.toUpperCase();
  }

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<(UserRole | string)[] | UserRole | string | undefined>(
      'roles',
      context.getHandler(),
    );

   
    if (!required || (Array.isArray(required) && required.length === 0)) return true;

    const requiredRoles = (Array.isArray(required) ? required : [required]).map((r) =>
      this.normalizeRole(String(r)),
    );

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    const userRolesRaw: string[] = Array.isArray(user?.roles)
      ? user.roles
      : user?.role
      ? [user.role]
      : [];

    const userRoles = userRolesRaw.map((r) => this.normalizeRole(String(r)));

    
    return requiredRoles.some((req) => userRoles.includes(req));
  }
}
