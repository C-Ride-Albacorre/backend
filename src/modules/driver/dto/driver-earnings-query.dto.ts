import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, ValidateIf } from 'class-validator';

export enum EarningsPeriod {
  TODAY = 'TODAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  CUSTOM = 'CUSTOM',
}

export class DriverEarningsQueryDto {
  @ApiPropertyOptional({
    description:
      'Time period for the dashboard. `CUSTOM` requires `from` and `to` (ISO 8601, UTC).',
    enum: EarningsPeriod,
    example: EarningsPeriod.WEEK,
    default: EarningsPeriod.TODAY,
  })
  @IsOptional()
  @IsEnum(EarningsPeriod)
  period: EarningsPeriod = EarningsPeriod.TODAY;

  @ApiPropertyOptional({
    description:
      'Start of the custom range. **Required when `period=CUSTOM`.** ISO 8601 UTC.',
    example: '2026-09-01T00:00:00.000Z',
  })
  @ValidateIf((o) => o.period === EarningsPeriod.CUSTOM)
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description:
      'End of the custom range. **Required when `period=CUSTOM`.** ISO 8601 UTC. Must be after `from`, and the range cannot exceed 90 days.',
    example: '2026-09-07T23:59:59.999Z',
  })
  @ValidateIf((o) => o.period === EarningsPeriod.CUSTOM)
  @IsDateString()
  to?: string;
}