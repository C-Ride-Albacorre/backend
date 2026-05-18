import { UserStatus } from '@prisma/client';

export class DispatcherFilterDto {
  search?: string;
  status?: UserStatus;
  page?: number;
  limit?: number;
}