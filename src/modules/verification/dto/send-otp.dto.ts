// src/verification/dto/send-otp.dto.ts
import { IsString, IsEmail, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum VerificationPurpose {
  REGISTRATION = 'registration',
  LOGIN = 'login',
  PASSWORD_RESET = 'password_reset',
  TWO_FACTOR = 'two_factor',
}

export class SendOtpDto {
  @ApiProperty({
    description: 'Email address or phone number to send OTP to',
    example: 'user@example.com or +1234567890',
  })
  @IsString()
  identifier: string;

  @ApiProperty({
    description: 'Purpose of the OTP',
    enum: VerificationPurpose,
    default: VerificationPurpose.REGISTRATION,
  })
  @IsOptional()
  @IsEnum(VerificationPurpose)
  purpose?: VerificationPurpose;
}
