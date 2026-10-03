import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class RunPayoutDto {
  @ApiPropertyOptional({
    description:
      'How many days back the settlement/payout period starts. Defaults to 7.',
    example: 7,
    minimum: 1,
    maximum: 3650,
    default: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;
}