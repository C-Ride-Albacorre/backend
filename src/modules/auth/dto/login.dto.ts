import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class LoginDto {
  // @ApiProperty({ example: 'fotay44859@netoiu.com' })
  // @IsEmail()
  // email: string;

  @ApiProperty({ example: 'fotay44859@netoiu.com' })
  @IsOptional()
  @IsEmail()
  email?: string; // fallback for email-only clients

  @ApiPropertyOptional({
    description: 'Phone number of the user in international format',
    example: '+15551234567',
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string; // fallback for phone-only clients

  @ApiPropertyOptional({
    description: 'Country code for phone number parsing (e.g., NG, US)',
    example: 'NG',
  })
  @IsOptional()
  @IsString()
  countryCode?: string; // e.g., 'NG', 'US' — defaults to 'NG'

  @ApiProperty({ example: 'StrongP@ssw0rd' })
  @IsNotEmpty()
  password: string;


  @ApiPropertyOptional({
    description: 'Email or phone number of the user',
    example: 'john@example.com'
  })
  @IsOptional()
  @IsString()
  identifier?: string; // accepts either email or phone
}

export class CustomerLoginDto {
  @ApiPropertyOptional({
    description: 'Email address of the customer',
    example: 'john@example.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Must be a valid email' })
  email?: string;

  @ApiPropertyOptional({
    description: 'Phone number of the customer in international format',
    example: '+15551234567',
  })
  @IsOptional()
  @Matches(/^\+?[0-9]{7,15}$/, {
    message: 'Must be a valid phone number',
  })
  phoneNumber?: string;

  @ApiProperty({
    description: 'Password of the customer',
    example: 'StrongPassword123!',
  })
  @IsNotEmpty()
  @IsString()
  password: string;
}
