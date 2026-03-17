// dto/delivery-option.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsUUID,
  ValidateNested,
  IsPostalCode,
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
  @IsUUID()
  deliveryOptionId: string;

  @ApiProperty({
    type: DropoffLocationDto,
    description: 'Dropoff location details',
  })
  @ValidateNested()
  @Type(() => DropoffLocationDto)
  dropoffLocation: DropoffLocationDto;

  @ApiProperty({
    example: 'John Doe',
    description: 'Recipient full name',
  })
  @IsString()
  recipientName: string;

  @ApiProperty({
    example: '+1234567890',
    description: 'Recipient phone number with country code',
  })
  @IsString()
  recipientPhone: string;

  @ApiPropertyOptional({
    example: 'Leave at front door. Call upon arrival.',
    description: 'Special delivery instructions',
  })
  @IsString()
  @IsOptional()
  deliveryInstructions?: string;
}
