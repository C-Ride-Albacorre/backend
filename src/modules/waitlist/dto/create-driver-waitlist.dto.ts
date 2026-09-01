// src/waitlist/dto/create-driver-waitlist.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateDriverWaitlistDto {
  @ApiProperty({ example: 'Jane Smith', description: 'Driver full name' })
  @IsNotEmpty()
  @IsString()
  fullName: string;

  @ApiProperty({ example: 'jane@example.com', description: 'Email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+9876543210', description: 'Phone number' })
  @IsNotEmpty()
  @IsString()
  phoneNumber: string;

  @ApiProperty({ example: 'Los Angeles', description: 'City of residence' })
  @IsNotEmpty()
  @IsString()
  city: string;

  @ApiProperty({ example: 'Sedan', description: 'Type of vehicle' })
  @IsNotEmpty()
  @IsString()
  vehicleType: string;

  @ApiProperty({ example: 2020, description: 'Year of vehicle manufacture' })
  @IsNumber()
  @Min(1900)
  vehicleYear: number;
}