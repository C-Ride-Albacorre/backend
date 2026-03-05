// src/admin/dto/approve-vendor.dto.ts
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../../../shared/enums';

export enum ApprovalAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  SUSPEND = 'SUSPEND',
}

export class ApproveVendorDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  action: UserStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
