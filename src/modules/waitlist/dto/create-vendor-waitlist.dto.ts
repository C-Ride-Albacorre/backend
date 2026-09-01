// src/waitlist/dto/create-vendor-waitlist.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateVendorWaitlistDto {
  @ApiProperty({ example: 'John Doe', description: 'Contact person name' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'Acme Corp', description: 'Business legal name' })
  @IsNotEmpty()
  @IsString()
  businessName: string;

  @ApiProperty({ example: 'contact@acme.com', description: 'Work email address' })
  @IsEmail()
  workEmail: string;

  @ApiProperty({ example: 'Retail', description: 'Type of business' })
  @IsNotEmpty()
  @IsString()
  businessType: string;

  @ApiProperty({ example: '+1234567890', description: 'Phone number' })
  @IsNotEmpty()
  @IsString()
  phoneNumber: string;

  @ApiProperty({ example: '123 Main St, City, Country', description: 'Business address' })
  @IsNotEmpty()
  @IsString()
  businessAddress: string;
}