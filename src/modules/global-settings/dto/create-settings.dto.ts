import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateGlobalSettingsDto {
  @ApiProperty({ example: 'Africa/Lagos (WAT)', description: 'System timezone' })
  @IsString()
  @IsNotEmpty()
  timezone: string;

  @ApiProperty({ example: 'Nigerian Naira (₦)', description: 'Default currency' })
  @IsString()
  @IsNotEmpty()
  currency: string;

  @ApiProperty({ example: 'English', description: 'Default system language' })
  @IsString()
  @IsNotEmpty()
  defaultLanguage: string;

  @ApiProperty({ example: 'DD/MM/YYYY', description: 'Date format preference' })
  @IsString()
  @IsNotEmpty()
  dateFormat: string;

  @ApiProperty({ example: 7.5, description: 'Tax rate percentage' })
  @IsNumber()
  taxRate: number;

  @ApiProperty({ example: 'support@c-ride.co', description: 'Support contact email' })
  @IsEmail()
  supportEmail: string;

  @ApiProperty({ example: '+234 800 000 0000', description: 'Support contact phone number' })
  @IsString()
  @IsNotEmpty()
  supportPhone: string;

  @ApiProperty({ example: '08:00 AM', description: 'Business opening time' })
  @IsString()
  @IsNotEmpty()
  openingTime: string;

  @ApiProperty({ example: '10:00 PM', description: 'Business closing time' })
  @IsString()
  @IsNotEmpty()
  closingTime: string;
}