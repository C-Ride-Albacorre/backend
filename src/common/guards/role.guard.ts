// // src/common/guards/roles.guard.ts
// import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
// import { Reflector } from '@nestjs/core';
// import { Roles } from '../decorators/role.decorator';
// import { UserRole } from '../../shared/enums';

// @Injectable()
// export class RolesGuard implements CanActivate {
//   constructor(private reflector: Reflector) {}

//   canActivate(context: ExecutionContext): boolean {
//     const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(Roles, [
//       context.getHandler(),
//       context.getClass(),
//     ]);
//     if (!requiredRoles) return true; // No roles required, allow access

//     const request = context.switchToHttp().getRequest();
//     const user = request.user;

//     if (!user) return false; // User not logged in
//     return requiredRoles.includes(user.role);
//   }
// }
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../decorators/role.decorator';
import { UserRole } from '../../shared/enums';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // ✅ Skip guard if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);

    // ✅ No roles required → allow
    if (!requiredRoles) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // ❌ Not authenticated
    if (!user) return false;

    // ✅ Check role
    return requiredRoles.includes(user.role);
  }
}
