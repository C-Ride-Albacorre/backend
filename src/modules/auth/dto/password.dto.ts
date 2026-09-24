// src/auth/dto/password.dto.ts
import {
  IsString,
  IsEmail,
  IsPhoneNumber,
  MinLength,
  Matches,
  ValidateIf,
  IsNotEmpty,
  IsOptional,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';


export class ForgotPasswordDto {
 
  @ApiProperty({
    description: 'Identifier for password reset (email or phone number)',
    example: 'user@example.com | +1234567890',
  })
  @IsNotEmpty()
  identifier: string;   // can be email or phone number


  @ApiPropertyOptional({
    description: 'Client type (web or mobile)',
    example: 'web | mobile',
  })
  @IsOptional()
  @IsIn(['web', 'mobile'])
  client?: 'web' | 'mobile';   // default to 'web'
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Reset token received via email/SMS' })
  @IsString()
  token: string;

  @ApiProperty({
    description: 'New password',
    example: 'NewPassword123!',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    {
      message:
        'Password must contain at least 1 uppercase, 1 lowercase, 1 number and 1 special character',
    },
  )
  newPassword: string;
}

export class VerifyResetTokenDto {
  @ApiProperty({ description: 'Reset token to verify' })
  @IsString()
  token: string;
}
