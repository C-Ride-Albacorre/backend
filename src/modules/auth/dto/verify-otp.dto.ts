// src/auth/dto/verify-otp.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({
    description: 'Email or phone number used in forgot-password request',
    example: 'user@example.com or +2348123456789',
  })
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @ApiProperty({
    description: 'One-time password received via email or SMS',
    example: '253443',
  })
  @IsString()
  @IsNotEmpty()
  otp: string;
}