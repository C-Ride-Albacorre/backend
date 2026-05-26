// dto/delivery-option.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsUUID,
  ValidateNested,
  IsPostalCode,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DropoffLocationDto {
  @ApiProperty({ example: '123 Main Street', description: 'Street address' })
  @IsString()
  address: string;

  @ApiProperty({ example: 'New York', description: 'City' })
  @IsString()
  city: string;

  @ApiProperty({ example: 'NY', description: 'State/Province' })
  @IsString()
  state: string;

  @ApiProperty({ example: 'USA', description: 'Country' })
  @IsString()
  country: string;

  @ApiProperty({ example: '10001', description: 'Postal/ZIP code' })
  @IsString()
  @IsPostalCode('any')
  postalCode: string;

  @ApiPropertyOptional({
    example: 'Apt 4B',
    description: 'Additional address details',
  })
  @IsString()
  @IsOptional()
  additionalDetails?: string;

  @ApiPropertyOptional({ example: 40.7128, description: 'Latitude coordinate' })
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional({
    example: -74.006,
    description: 'Longitude coordinate',
  })
  @IsOptional()
  longitude?: number;
}

export class DeliveryOptionDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Selected delivery option ID',
  })
  @IsOptional()
  @IsUUID()
  deliveryOptionId?: string;

  @ApiProperty({
    example: 'Product',
    description: 'Name of delivery option',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    example: 'Product',
    description: 'Delivery option fee',
  })
  @IsInt()
  @IsOptional()
  baseFee?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  estimatedDays?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  description?: string;

  @ApiProperty({
    type: DropoffLocationDto,
    description: 'Dropoff location details',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DropoffLocationDto)
  dropoffLocation?: DropoffLocationDto;

  @ApiProperty({
    example: 'John Doe',
    description: 'Recipient full name',
  })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @ApiProperty({
    example: '+1234567890',
    description: 'Recipient phone number with country code',
  })
  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @ApiPropertyOptional({
    example: 'Leave at front door. Call upon arrival.',
    description: 'Special delivery instructions',
  })
  @IsString()
  @IsOptional()
  deliveryInstructions?: string;
}
