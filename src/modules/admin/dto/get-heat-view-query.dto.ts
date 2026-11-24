// src/modules/admin/analytics/dto/get-heat-view-query.dto.ts

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetHeatViewQueryDto {
  @ApiPropertyOptional({
    description: 'Time window in minutes to look back for orders.',
    default: 60,
    minimum: 15,
    maximum: 1440, // 24 hours
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1440)
  timeWindow?: number = 60;

  @ApiPropertyOptional({
    description: 'Force bypass the Redis cache and fetch fresh data.',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  refresh?: boolean = false;
}