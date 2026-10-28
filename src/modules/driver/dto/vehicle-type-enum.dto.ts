import { ApiProperty } from '@nestjs/swagger';
import { VehicleType } from '@prisma/client';

export class VehicleTypeEnumResponseDto {
  @ApiProperty({
    enum: VehicleType,
    isArray: true,
    example: Object.values(VehicleType),
  })
  vehicleTypes: VehicleType[];
}