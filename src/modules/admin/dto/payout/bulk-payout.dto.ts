// src/modules/admin/dto/bulk-payout.dto.ts
import {
  IsArray, IsDateString, IsEnum, IsOptional, IsUUID,
  ArrayMaxSize, ArrayMinSize, IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutStatus } from '@prisma/client';

export class BulkGeneratePayoutsDto {
  @ApiProperty({ description: 'Period start (ISO date)' })
  @IsDateString()
  periodStart: string;

  @ApiProperty({ description: 'Period end (ISO date)' })
  @IsDateString()
  periodEnd: string;

  @ApiProperty({
    description: 'Driver IDs to include',
    type: [String],
    example: ['a8fb9168-b6bf-4ef9-9135-12f8b4bd69a2'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200) // hard safety cap
  @IsUUID('4', { each: true })
  driverIds: string[];

  @ApiPropertyOptional({
    description: 'Auto-approve payouts after generation (PENDING → PROCESSING)',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  autoApprove?: boolean = false;

  @ApiPropertyOptional({
    description: 'Skip drivers who already have a payout for this period',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  skipExisting?: boolean = true;
}

export class BulkPayoutResultDto {
  driverId: string;
  status: 'CREATED' | 'SKIPPED' | 'FAILED';
  payoutId?: string;
  payoutNumber?: string;
  amount?: number;
  reason?: string;
}