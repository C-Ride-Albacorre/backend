// src/admin/dto/store-filter.dto.ts
import {
  IsOptional,
  IsEnum,
  IsString,
  IsBoolean,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { StoreStatus } from '@prisma/client';

export class StoreFilterDto {
  @ApiProperty({ enum: StoreStatus, required: false })
  @IsOptional()
  @IsEnum(StoreStatus)
  status?: StoreStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string; // Search by store name, email

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  page?: number;

  @ApiProperty({ required: false, default: 10 })
  @IsOptional()
  limit?: number;
}
