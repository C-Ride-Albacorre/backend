// src/admin/dto/approve-vendor.dto.ts
import {
  IsString,
  IsOptional,
  IsEnum,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '../../../shared/enums';
import { CreateCommissionDto } from '../../comission/dto/create-commission.dto';

export class ApproveVendorDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  action: UserStatus;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.action === UserStatus.REJECTED)
  @IsString()
  rejectionReason?: string;

  @ApiPropertyOptional({
    type: CreateCommissionDto,
    description:
      'Required when action = APPROVED. Vendor commission must be set before approval.',
  })
  @ValidateIf((o) => o.action === UserStatus.APPROVED)
  @ValidateNested()
  @Type(() => CreateCommissionDto)
  commission?: CreateCommissionDto;
}