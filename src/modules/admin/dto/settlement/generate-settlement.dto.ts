import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class GenerateSettlementsDto {
  @ApiProperty({
    example: '2026-09-01T00:00:00.000Z',
    description: 'Start of the settlement period',
  })
  @IsDateString()
  periodStart: string;

  @ApiProperty({
    example: '2026-09-18T23:59:59.999Z',
    description: 'End of the settlement period',
  })
  @IsDateString()
  periodEnd: string;
}
