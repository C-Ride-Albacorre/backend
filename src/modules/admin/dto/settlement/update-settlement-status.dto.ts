import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { SettlementStatus } from '@prisma/client';

export class UpdateSettlementStatusDto {
  @ApiProperty({ enum: SettlementStatus })
  @IsEnum(SettlementStatus)
  status: SettlementStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}