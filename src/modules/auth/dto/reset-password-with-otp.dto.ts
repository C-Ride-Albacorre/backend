// src/auth/dto/reset-password-with-otp.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, Matches } from 'class-validator';

export class ResetPasswordWithOtpDto {
  @ApiProperty({ example: '+1234567890' })
  @IsString()
  phoneNumber: string;
  //identifier: string;

  @ApiProperty({ example: '253443' })
  @IsString()
  otp: string;

  @ApiProperty({
    example: 'NewPassword123!',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  //@Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).+$/, {
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least 1 uppercase, 1 lowercase, 1 number and 1 special character',
  })
  newPassword: string;
}
