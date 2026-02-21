// src/verification/dto/verify-otp.dto.ts
import {
  IsString,
  Length,
  IsOptional,
  IsEnum,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { VerificationPurpose } from '../../../shared/enums';

export class VerifyOtpDto {
  @ApiProperty({
    description: 'Email address or phone number to verify',
    example: 'user@example.com or +1234567890',
  })
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @ApiProperty({
    description: 'OTP code received',
    example: '123456',
  })
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  otp: string;

  @IsOptional()
  @IsEnum(VerificationPurpose)
  purpose?: VerificationPurpose;

  @IsOptional()
  @IsString()
  metadata?: Record<string, any>; // For additional context
}
