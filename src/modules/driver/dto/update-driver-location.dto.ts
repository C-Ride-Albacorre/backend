// dto/update-driver-location.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString } from 'class-validator';

export class UpdateDriverLocationDto {
  @ApiProperty({
    example: 'drv_12345',
    description: 'Driver identifier',
  })
  @IsString()
  driverId: string;

  @ApiProperty({
    example: 'ord_98765',
    description: 'Order identifier',
  })
  @IsString()
  orderId: string;

  @ApiProperty({
    example: 6.5244,
    description: 'Driver latitude',
  })
  @IsNumber()
  lat: number;

  @ApiProperty({
    example: 3.3792,
    description: 'Driver longitude',
  })
  @IsNumber()
  lng: number;

  @ApiProperty({
    example: 180,
    description: 'Driver heading in degrees',
  })
  @IsNumber()
  heading: number;
}