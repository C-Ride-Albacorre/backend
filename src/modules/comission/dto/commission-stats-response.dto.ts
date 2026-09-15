// src/commission/dto/commission-stats-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class CommissionStatsResponseDto {
  @ApiProperty({ example: 42, description: 'Total number of commissions' })
  totalCommissions: number;

  @ApiProperty({ example: 36, description: 'Total number of active commissions' })
  totalActive: number;

  @ApiProperty({ example: 6, description: 'Total number of inactive commissions' })
  totalInactive: number;

  @ApiProperty({ example: 14.5, description: 'Average vendor commission (%)' })
  avgVendorCommission: number;

  @ApiProperty({ example: 5.0, description: 'Average service charge (%)' })
  avgServiceCharge: number;
}