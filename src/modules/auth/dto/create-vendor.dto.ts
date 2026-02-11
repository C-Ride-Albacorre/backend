// src/vendors/dto/create-vendor.dto.ts
import {
  IsEmail,
  IsNotEmpty,
  IsPhoneNumber,
  IsString,
  MinLength,
  Matches,
  Validate,
  IsOptional,
  Length,
  IsUrl,
  IsArray,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVendorDto {
  @ApiProperty({ example: 'vendor@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+1234567890' })
  @IsNotEmpty()
  @IsPhoneNumber()
  phoneNumber: string;

  @ApiProperty({ example: 'StrongP@ssw0rd' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
  password: string;

  @ApiProperty({ example: 'John' })
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsNotEmpty()
  @IsString()
  lastName: string;
}

export class VerifyEmailDto {
  @ApiProperty({ example: 'vendor@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  otp: string;
}

export class VerifyPhoneDto {
  @ApiProperty({ example: '+1234567890' })
  @IsNotEmpty()
  @IsPhoneNumber()
  phoneNumber: string;

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  otp: string;
}

export class CompleteOnboardingDto {
  // Business Information
  @ApiProperty({ example: 'Best Burgers Inc.' })
  @IsNotEmpty()
  @IsString()
  businessName: string;

  @ApiProperty({ example: 'Restaurant' })
  @IsNotEmpty()
  @IsString()
  businessType: string;

  @ApiPropertyOptional({ example: 'TAX-123456' })
  @IsOptional()
  @IsString()
  taxId?: string;

  // Location
  @ApiProperty({ example: '123 Main St' })
  @IsNotEmpty()
  @IsString()
  address: string;

//   @ApiPropertyOptional({ example: 'Suite 100' })
//   @IsOptional()
//   @IsString()
//   addressLine2?: string;

  @ApiProperty({ example: 'Lekki' })
  @IsNotEmpty()
  @IsString()
  city: string;

  @ApiProperty({ example: 'Lagos' })
  @IsNotEmpty()
  @IsString()
  state: string;

  @ApiProperty({ example: 'Nigeria' })
  @IsNotEmpty()
  @IsString()
  country: string;

  @ApiProperty({ example: '10001' })
  @IsNotEmpty()
  @IsString()
  postalCode: string;

  // Business Contact
  @ApiPropertyOptional({ example: 'business@bestburgers.com' })
  @IsOptional()
  @IsEmail()
  businessEmail?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @IsOptional()
  @IsPhoneNumber()
  businessPhone?: string;

  @ApiPropertyOptional({ example: 'https://bestburgers.com' })
  @IsOptional()
  @IsUrl()
  website?: string;

  // Business Details
  @ApiPropertyOptional({ example: 'Best burgers in town since 1995' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: ['Burgers', 'Fast Food', 'American'] })
  @IsNotEmpty()
  @IsArray()
  categories: string[];

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'https://example.com/banner.png' })
  @IsOptional()
  @IsUrl()
  bannerUrl?: string;

  // Financial Information
  @ApiPropertyOptional({ example: 'Bank of America' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ example: '1234567890' })
  @ValidateIf((o) => o.bankName)
  @IsString()
  accountNumber?: string;

  @ApiPropertyOptional({ example: '021000021' })
  @ValidateIf((o) => o.bankName)
  @IsString()
  routingNumber?: string;
}