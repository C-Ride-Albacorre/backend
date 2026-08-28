// dto/driver-hours-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class DriverHoursResponseDto {
  @ApiProperty({ description: 'Driver ID', example: 'driver-123' })
  driverId: string;

  @ApiProperty({ description: 'Date (ISO date string)', example: '2026-08-28' })
  date: string;

  @ApiProperty({ description: 'Total active hours (ONLINE or BUSY)', example: 7.5 })
  hours: number;

  @ApiProperty({ description: 'Total active seconds', example: 27000 })
  seconds: number;
}