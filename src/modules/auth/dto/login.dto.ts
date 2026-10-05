
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';


export class LoginDriverDto {
  @ApiPropertyOptional({
    description: 'User email address. Provide either email or phoneNumber.',
    example: 'john@example.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Invalid email address' })
  email?: string;

  @ApiPropertyOptional({
    description:
      'Phone number in E.164 or local format. Provide either email or phoneNumber.',
    example: '+2347058585898',
    examples: {
      e164: { value: '+2347058585898', summary: 'E.164 format' },
      local: { value: '07058585898', summary: 'Local (NG) format' },
    },
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({
    description:
      'Required only when phoneNumber is in local format. Defaults to NG.',
    example: 'NG',
    default: 'NG',
  })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiProperty({
    description: 'User password',
    example: 'StrongPassword123!',
  })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;
}

export class LoginDriverDtoWithIdentifier {
  @ApiProperty({
    description: 'Email address OR phone number (E.164 or local format)',
    example: 'john@example.com | +15551234567 | 07012345678',
    examples: {
      email: { value: 'john@example.com', summary: 'Email login' },
      phone: { value: '+2347058585898', summary: 'Phone login' },
      localPhone: { value: '07058585898', summary: 'Local phone login' },
    },
  })
  @IsString()
  identifier: string;

  @ApiPropertyOptional({
    description:
      'Required only when identifier is a phone number in local format. Defaults to NG.',
    example: 'NG',
    default: 'NG',
  })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiProperty({
    description: 'User password',
    example: 'StrongP@ssw0rd',
  })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: 'fotay44859@netoiu.com' })
  @IsEmail()
  email: string;


  @ApiProperty({ example: 'StrongP@ssw0rd' })
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
    example: 'StrongPassword123!',
  })
  @IsNotEmpty()
  @IsString()
  password: string;
}
