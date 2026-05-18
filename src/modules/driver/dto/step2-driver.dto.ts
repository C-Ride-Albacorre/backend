// src/drivers/dto/step2-driver.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsInt, Min, Max, Matches } from 'class-validator';

export enum VehicleType {
  CAR = 'CAR',
  EV = 'EV',
}

export class DriverStep2Dto {
  @ApiProperty({ enum: VehicleType, example: VehicleType.CAR })
  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @ApiProperty({ example: 'Toyota' })
  @IsString()
  vehicleMake: string;

  @ApiProperty({ example: 'Camry' })
  @IsString()
  vehicleModel: string;

  @ApiProperty({ example: 2022 })
  @IsInt()
  @Min(1900)
  @Max(new Date().getFullYear())
  year: number;

  @ApiProperty({ example: 'ABC-123-EF' })
  @IsString()
  @Matches(/^[A-Z0-9-]+$/, { message: 'Invalid license plate format' })
  licensePlate: string;
}
