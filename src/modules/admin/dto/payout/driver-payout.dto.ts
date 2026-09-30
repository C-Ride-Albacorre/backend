// src/admin/dto/driver-payout.dto.ts
import {
  IsEnum, IsOptional, IsString, IsUUID, IsDateString, IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutStatus, VehicleType } from '@prisma/client';

export class ListPayoutsDto {
  @ApiPropertyOptional({ enum: PayoutStatus })
  @IsEnum(PayoutStatus)
  @IsOptional()
  status?: PayoutStatus;

  @ApiPropertyOptional({ description: 'Driver name, ID, vehicle tier' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: VehicleType })
  @IsEnum(VehicleType)
  @IsOptional()
  tier?: VehicleType;

  @ApiPropertyOptional({ description: 'Filter by period start (ISO)' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter by period end (ISO)' })
  @IsDateString()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  limit?: number = 20;
}

export class GeneratePayoutsDto {
  @ApiProperty({ description: 'Period start (ISO date)' })
  @IsDateString()
  periodStart: string;

  @ApiProperty({ description: 'Period end (ISO date)' })
  @IsDateString()
  periodEnd: string;

  @ApiPropertyOptional({ description: 'Only generate for this driver' })
  @IsUUID()
  @IsOptional()
  driverId?: string;
}

export class UpdatePayoutStatusDto {
  @ApiProperty({ enum: PayoutStatus })
  @IsEnum(PayoutStatus)
  status: PayoutStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  reference?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  failureReason?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  note?: string;
}