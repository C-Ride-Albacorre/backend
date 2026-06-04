// src/modules/driver/dto/update-driver-status.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { DriverStatus } from '@prisma/client';

export class UpdateDriverStatusDto {
  @ApiProperty({
    enum: DriverStatus,
    example: DriverStatus.ONLINE,
    description: 'New status of the driver',
  })
  @IsEnum(DriverStatus)
  @IsNotEmpty()
  status: DriverStatus;
}