import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginCustomerDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsString()
  @MinLength(6)
  password: string;

  constructor(partial: Partial<LoginCustomerDto>) {
    Object.assign(this, partial);
  }
}

// auth-response.dto.ts
export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    role: string;
  };
}

// refresh-token.dto.ts
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}