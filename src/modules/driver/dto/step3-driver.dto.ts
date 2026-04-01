// src/drivers/dto/step3-driver.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DriverStep3Dto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Driver license image',
  })
  driverLicense: any; // Will be handled as file upload

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Vehicle insurance document',
  })
  vehicleInsurance: any;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Vehicle registration document',
  })
  vehicleRegistration: any;
}

// For metadata when not using files
export class DriverStep3MetadataDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  driverLicenseUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  vehicleInsuranceUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  vehicleRegistrationUrl?: string;
}
