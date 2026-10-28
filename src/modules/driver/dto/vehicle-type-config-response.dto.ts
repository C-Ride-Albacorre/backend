import { ApiProperty } from '@nestjs/swagger';

export class VehicleTypeConfigOptionDto {
  @ApiProperty({ example: 'a1b2c3d4-...' })
  id: string;

  @ApiProperty({ example: 'CAR' })
  name: string;

  @ApiProperty({ example: 'Car', required: false })
  label?: string;
}