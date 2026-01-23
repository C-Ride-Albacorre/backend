import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../shared/enums';

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);
