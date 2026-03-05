// src/admin/dto/approve-store.dto.ts
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { StoreStatus } from '../../../shared/enums';

export enum StoreApprovalAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  SUSPEND = 'SUSPEND',
}

export class ApproveStoreDto {
  @ApiProperty({ enum: StoreStatus })
  @IsEnum(StoreStatus)
  action: StoreStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  rejectionReason?: string;

  // @ApiProperty({ required: false })
  // @IsOptional()
  // commissionRate?: number;
}
