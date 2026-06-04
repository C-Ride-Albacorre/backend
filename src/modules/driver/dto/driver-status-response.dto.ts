// src/modules/driver/dto/driver-status-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { DriverStatus } from '@prisma/client';

export class DriverStatusResponseDto {
  @ApiProperty({ example: 'driver-uuid-123' })
  driverId: string;

  @ApiProperty({ enum: DriverStatus, example: 'ONLINE' })
  status: DriverStatus;

  @ApiProperty({ example: 'Driver status updated successfully' })
  message: string;
}