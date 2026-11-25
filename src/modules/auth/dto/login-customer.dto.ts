import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length, MinLength } from 'class-validator';

export class LoginCustomerDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsPhoneNumber(null) 
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ example: 'NG', required: false })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;
  
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
  hasEmail: boolean;

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