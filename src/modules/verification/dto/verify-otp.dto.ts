// src/verification/dto/verify-otp.dto.ts
import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({
    description: 'Email address or phone number to verify',
    example: 'user@example.com or +1234567890',
  })
  @IsString()
  identifier: string;

  @ApiProperty({
    description: 'OTP code received',
    example: '123456',
  })
  @IsString()
  @Length(6, 6)
  otp: string;
}
