// import { VehicleType } from '@prisma/client';

// export class DriverOnboardingDto {
//   // Step 1
//   fullName: string;
//   phoneNumber: string;
//   email: string;
//   address: string;
//   city: string;
//   state: string;

//   // Step 2
//   vehicleType: VehicleType;
//   vehicleMake: string;
//   vehicleModel: string;
//   year: number;
//   licensePlate: string;
// }
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsUUID,
  Min,
  Max,
} from 'class-validator';

export class DriverOnboardingDto {
  // ---------- Step 1 ----------
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: '+2348012345678' })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '12 Adeola Street' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 'Lagos' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'Lagos' })
  @IsString()
  @IsNotEmpty()
  state: string;

  // ---------- Step 2 ----------
  @ApiProperty({
    description: 'ID of the selected VehicleTypeConfig',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsUUID()
  vehicleTypeConfigId: string;

  @ApiProperty({ example: 'Toyota' })
  @IsString()
  @IsNotEmpty()
  vehicleMake: string;

  @ApiProperty({ example: 'Corolla' })
  @IsString()
  @IsNotEmpty()
  vehicleModel: string;

  @ApiProperty({ example: 2020, minimum: 1980, maximum: 2100 })
  @IsNumber()
  @Min(1980)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 'ABC-123-XY' })
  @IsString()
  @IsNotEmpty()
  licensePlate: string;
}