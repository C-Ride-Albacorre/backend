// src/waitlist/dto/driver-waitlist-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class DriverWaitlistResponseDto {
  @ApiProperty({ example: 'clx123abc...', description: 'Unique driver waitlist ID' })
  id: string;

  @ApiProperty({ example: 'Jane Smith', description: 'Driver full name' })
  fullName: string;

  @ApiProperty({ example: 'jane@example.com', description: 'Driver email address' })
  email: string;

  @ApiProperty({ example: '+9876543210', description: 'Driver phone number' })
  phoneNumber: string;

  @ApiProperty({ example: 'Los Angeles', description: 'City of residence' })
  city: string;

  @ApiProperty({ example: 'Sedan', description: 'Type of vehicle' })
  vehicleType: string;

  @ApiProperty({ example: 2020, description: 'Year of vehicle manufacture' })
  vehicleYear: number;

  @ApiProperty({ example: '2026-09-01T12:00:00Z', description: 'Record creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-09-01T12:00:00Z', description: 'Record last-updated timestamp' })
  updatedAt: Date;
}