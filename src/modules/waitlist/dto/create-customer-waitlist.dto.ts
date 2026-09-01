// src/waitlist/dto/create-customer-waitlist.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateCustomerWaitlistDto {
  @ApiProperty({ example: 'Alice Johnson', description: 'Customer full name' })
  @IsNotEmpty()
  @IsString()
  fullName: string;

  @ApiProperty({ example: 'alice@example.com', description: 'Email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+1122334455', description: 'Phone number' })
  @IsNotEmpty()
  @IsString()
  phoneNumber: string;

  @ApiProperty({ example: 'New York', description: 'City of residence' })
  @IsNotEmpty()
  @IsString()
  city: string;

  @ApiProperty({ example: 'Groceries', description: 'Category of orders' })
  @IsNotEmpty()
  @IsString()
  orderCategory: string;

  @ApiProperty({ example: 'Personal shopping', description: 'Purpose of using the service' })
  @IsNotEmpty()
  @IsString()
  purpose: string;
}