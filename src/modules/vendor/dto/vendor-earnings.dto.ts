// src/vendor/dto/vendor-earnings.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { SettlementStatus } from '@prisma/client';

export class VendorEarningsFilterDto {
  @ApiPropertyOptional({
    description: 'Start of the statement period (ISO date)',
    example: '2025-09-01',
  })
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @ApiPropertyOptional({
    description: 'End of the statement period (ISO date)',
    example: '2025-09-07',
  })
  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @ApiPropertyOptional({
    description: 'Filter by a specific store',
  })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;
}

export class OrderEarningRowDto {
  @ApiProperty() orderId: string;
  @ApiProperty() reference: string;
  @ApiProperty() deliveredAt: Date;
  @ApiProperty() orderValue: number;
  @ApiProperty() commission: number;
  @ApiProperty() serviceCharge: number;
  @ApiProperty() netEarning: number;
}

export class DailyEarningsDto {
  @ApiProperty({ example: '2025-09-01' }) date: string;
  @ApiProperty({ example: 'Mon' }) day: string;
  @ApiProperty() orderCount: number;
  @ApiProperty() gross: number;
  @ApiProperty() commission: number;
  @ApiProperty() serviceCharge: number;
  @ApiProperty() vendorEarnings: number;
}

export class VendorStatementDto {
  @ApiProperty() periodStart: string;
  @ApiProperty() periodEnd: string;
  @ApiProperty() weekLabel: string;
  @ApiProperty() totalOrders: number;
  @ApiProperty() totalGross: number;
  @ApiProperty() totalCommission: number;
  @ApiProperty() totalServiceCharge: number;
  @ApiProperty() totalVendorEarnings: number;
  @ApiProperty() status: SettlementStatus | 'IN_PROGRESS';
  @ApiProperty({ type: [DailyEarningsDto] }) days: DailyEarningsDto[];
  @ApiProperty({ type: [OrderEarningRowDto] }) orders: OrderEarningRowDto[];
}

export class StatementHistoryItemDto {
  @ApiProperty() id: string;
  @ApiProperty() reference: string;
  @ApiProperty() periodStart: string;
  @ApiProperty() periodEnd: string;
  @ApiProperty() weekLabel: string;
  @ApiProperty() totalOrders: number;
  @ApiProperty() grossSales: number;
  @ApiProperty() commission: number;
  @ApiProperty() serviceCharge: number;
  @ApiProperty() netSettlement: number;
  @ApiProperty() status: SettlementStatus;
  @ApiProperty() dueDate: Date;
}