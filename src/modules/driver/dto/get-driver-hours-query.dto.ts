// dto/get-driver-hours-query.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsDateString } from 'class-validator';

export class GetDriverHoursQueryDto {
  @ApiPropertyOptional({
    description: 'Date in ISO format (YYYY-MM-DD). Defaults to today.',
    example: '2026-08-28',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}