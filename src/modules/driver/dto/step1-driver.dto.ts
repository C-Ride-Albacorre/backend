// src/drivers/dto/step1-driver.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsPhoneNumber,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';

export class DriverStep1Dto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ example: '+2348012345678' })
  @IsPhoneNumber()
  phoneNumber: string;

  @ApiProperty({ example: 'driver@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123 Driver Street' })
  @IsString()
  address: string;

  @ApiProperty({ example: 'Lagos' })
  @IsString()
  city: string;

  @ApiProperty({ example: 'Lagos' })
  @IsString()
  state: string;

  @ApiProperty({ required: false, example: 'NG' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ required: false, example: '100001' })
  @IsOptional()
  @IsString()
  postalCode?: string;
}
