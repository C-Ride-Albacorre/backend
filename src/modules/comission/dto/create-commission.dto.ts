// src/commission/dto/create-commission.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsString, IsUUID, Max, Min } from 'class-validator';
import { CommissionStatus } from '@prisma/client';

export class CreateCommissionDto {
  @ApiProperty({ example: 'a1b2c3d4-...', description: 'Vendor user ID (User with role VENDOR)' })
  @IsUUID()
  @IsNotEmpty()
  vendorId: string;

  @ApiProperty({ example: 'Lagos Island', description: 'Location of the commission' })
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiProperty({ example: 'Lagos', description: 'City of the commission' })
  @IsNotEmpty()
  @IsString()
  city: string;

  @ApiProperty({ example: 14.5, description: 'Vendor commission percentage (0–100)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  vendorCommission: number;

  @ApiProperty({ example: 5.0, description: 'Service charge percentage (0–100)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  serviceCharge: number;

  @ApiProperty({ enum: CommissionStatus, example: CommissionStatus.ACTIVE, required: false })
  @IsEnum(CommissionStatus)
  status?: CommissionStatus;
}