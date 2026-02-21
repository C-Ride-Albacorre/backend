import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsEmailOrPhone } from '../../../common/decorators/is-email-or-phone.decorator';

export class CreateCustomerDto {
  @ApiProperty({ example: 'Test User' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'User' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: '+1234567890', required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ example: 'tuser@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  // This decorator validates that at least one of email or phone is provided
  @ValidateIf((o) => !o.email && !o.phoneNumber)
  @IsEmailOrPhone()
  emailOrPhone?: never; // This property doesn't actually exist, just for validation

  @ApiProperty({ example: 'StrongPassword123!' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password: string;

  @ApiProperty({ example: 'REF12345', required: false })
  @IsOptional()
  @IsString()
  referralCode?: string;
}
