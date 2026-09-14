// src/waitlist/dto/waitlist-stats-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class WaitlistStatsResponseDto {
  @ApiProperty({ example: 120, description: 'Total number of vendors on the waitlist' })
  totalVendors: number;

  @ApiProperty({ example: 85, description: 'Total number of drivers on the waitlist' })
  totalDrivers: number;

  @ApiProperty({ example: 340, description: 'Total number of customers on the waitlist' })
  totalCustomers: number;

  @ApiProperty({ example: 545, description: 'Total number of all waitlist entries' })
  total: number;
}