// src/auth/dto/google-mobile-login.dto.ts
import { IsString, IsOptional, IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../shared/enums';

export class GoogleMobileLoginDto {
  @ApiProperty({
    description: 'Google ID token from GoogleSignin.signIn()',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6...',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiProperty({
    description: 'Role to log in / register as',
    enum: [UserRole.CUSTOMER, UserRole.VENDOR],
    example: 'CUSTOMER',
  })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiProperty({
    description: 'Guest cart session to migrate on login (optional)',
    required: false,
    example: '69b0ec5c-542f-49fb-b3a8-bdc5e4d1f8ac',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;
}