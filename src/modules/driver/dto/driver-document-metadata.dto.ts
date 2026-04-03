import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum DriverDocumentType {
  DRIVER_LICENSE = 'DRIVER_LICENSE',
  VEHICLE_INSURANCE = 'VEHICLE_INSURANCE',
  VEHICLE_REGISTRATION = 'VEHICLE_REGISTRATION',
}

export class DriverDocumentMetadataDto {
  @ApiProperty({
    enum: DriverDocumentType,
    example: DriverDocumentType.DRIVER_LICENSE,
    description: 'Type of driver document',
  })
  @IsEnum(DriverDocumentType)
  documentType: DriverDocumentType;

  @ApiProperty({
    example: 'Driver license issued in Lagos',
    required: false,
    description: 'Optional description of the document',
  })
  @IsOptional()
  @IsString()
  description?: string;
}