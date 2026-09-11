import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { CreateDistanceBandDto } from './create-distance-band.dto';

export class CreateVehicleTypeConfigDto {
  @ApiProperty({ example: 'eBike', description: 'Name of the vehicle type' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Lagos Island', description: 'Location where this applies' })
  @IsString()
  location: string;

  @ApiProperty({ example: 'https://cdn-icons-png.flaticon.com/512/...', required: false })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiProperty({ example: 10, description: 'Max delivery radius in km' })
  @IsNumber()
  @Min(1)
  deliveryRadiusKm: number;

  @ApiProperty({ example: 1, description: 'Order of display in the app' })
  @IsNumber()
  displayOrder: number;

  @ApiProperty({ example: true, description: 'Is this vehicle type active?' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({ example: 1000, description: 'Minimum delivery fee' })
  @IsNumber()
  @Min(0)
  minDeliveryFee: number;

  @ApiProperty({ example: 150, description: 'Rate per kilometer' })
  @IsNumber()
  @Min(0)
  perKmRate: number;

  @ApiProperty({ example: 20, description: 'C-Ride commission percentage on delivery fee' })
  @IsNumber()
  @Min(0)
  deliveryCommissionPct: number;

  @ApiProperty({ type: [CreateDistanceBandDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDistanceBandDto)
  @IsOptional()
  distanceBands?: CreateDistanceBandDto[];
}