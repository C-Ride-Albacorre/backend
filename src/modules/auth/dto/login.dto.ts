import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'samuel@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'StrongPassword123!' })
  @IsNotEmpty()
  password: string;
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
    example: 'StrongPass123!',
  })
  @IsNotEmpty()
  @IsString()
  password: string;
}
