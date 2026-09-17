import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SettlementStatus } from '@prisma/client';

export class SettlementBankDto {
  @ApiProperty({ example: 'GTBank' }) bankName: string;
  @ApiProperty({ example: '6789' }) accountLast4: string;
}

export class VendorSettlementRowDto {
  @ApiProperty({ example: 'vs1' }) id: string;
  @ApiProperty({ example: 'vs1' }) reference: string;

  @ApiProperty({ example: 'Mama Put Kitchen' }) vendorName: string;
  @ApiProperty({ example: 'Lagos Island' }) location: string;
  @ApiProperty({ example: 'Sep 2026' }) period: string;
  @ApiProperty({ example: '2026-09-07' }) dueDate: Date;

  @ApiProperty({ example: 143 }) orders: number;
  @ApiProperty({ example: 428500 }) grossSales: number;
  @ApiProperty({ example: -64275 }) commission: number;
  @ApiProperty({ example: -21425 }) serviceCharge: number;
  @ApiProperty({ example: 342800 }) netSettlement: number;

  @ApiProperty({ enum: SettlementStatus }) status: SettlementStatus;

  @ApiPropertyOptional({ type: SettlementBankDto })
  bank?: SettlementBankDto;
}

export class SettlementStatsDto {
  @ApiProperty({ example: 3 }) awaitingSettlement: number;
  @ApiProperty({ example: 2 }) processing: number;
  @ApiProperty({ example: 3 }) settledThisCycle: number;
  @ApiProperty({ example: 1673832 }) totalNetPending: number;

  // Extra roll-ups shown in your request
  @ApiProperty({ example: 2360870 }) totalNet: number;
  @ApiProperty({ example: 449705 }) totalCommission: number;
}

export class PaginatedSettlementResponseDto {
  @ApiProperty({ type: [VendorSettlementRowDto] })
  data: VendorSettlementRowDto[];

  @ApiProperty()
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };

  @ApiProperty({ type: SettlementStatsDto })
  stats: SettlementStatsDto;
}