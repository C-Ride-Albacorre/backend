import { IsEnum } from 'class-validator';
import { UserStatus } from '@prisma/client';

export class UpdateCustomerStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;
}
