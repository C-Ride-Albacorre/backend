import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class CreateDistanceBandDto {
  @ApiProperty({ example: 0, description: 'Starting kilometer for the band' })
  @IsNumber()
  @Min(0)
  fromKm: number;

  @ApiProperty({ example: 5, description: 'Ending kilometer for the band' })
  @IsNumber()
  @Min(0)
  toKm: number;

  @ApiProperty({ example: 1000, description: 'Flat fee for this distance band' })
  @IsNumber()
  @Min(0)
  flatFee: number;
}