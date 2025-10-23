import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEmail,
  IsBoolean,
  IsNotEmpty,
} from 'class-validator';

export class CreateBusinessProfileDto {
  @ApiProperty({ example: 'Crestabel Inc' })
  @IsString()
  @IsNotEmpty()
  businessName: string;

  @ApiProperty({ example: 'Restaurant' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ example: '+234 700 000 0000' })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @ApiProperty({ example: 'support@crestosomething.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Abuja' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: '(WAT) UTC+08:00 - 5:00 PM' })
  @IsString()
  @IsNotEmpty()
  openingHours: string;

  @ApiPropertyOptional({
    example: 'Elegant, touch-free fine dining for guests.',
  })
  @IsString()
  @IsOptional()
  shortDescription?: string;
}
