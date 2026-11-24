// src/modules/admin/analytics/dto/heat-view-response.dto.ts

import { ApiProperty } from '@nestjs/swagger';

class HeatViewSummaryDto {
  @ApiProperty({ example: 847 })
  totalDataPoints: number;

  @ApiProperty({ example: 12 })
  activeCustomers: number;

  @ApiProperty({ example: 'Victoria Island' })
  peakZone: string;

  @ApiProperty({ example: true })
  deliveryDriversExcluded: boolean;

  @ApiProperty({ example: 'Order count' })
  metricDrivingIntensity: string;
}

class HeatmapPointDto {
  @ApiProperty({ example: 6.4281 })
  lat: number;

  @ApiProperty({ example: 3.4219 })
  lng: number;

  @ApiProperty({ example: 150 })
  weight: number;
}

class ActiveCustomerDotDto {
  @ApiProperty({ example: 'cust_1' })
  id: string;

  @ApiProperty({ example: 6.4285 })
  lat: number;

  @ApiProperty({ example: 3.4220 })
  lng: number;
}

export class HeatViewResponseDto {
  @ApiProperty({ example: '2026-11-20T10:55:14.000Z' })
  generatedAt: string;

  @ApiProperty({ example: 60 })
  timeWindowMinutes: number;

  @ApiProperty({ type: HeatViewSummaryDto })
  summary: HeatViewSummaryDto;

  @ApiProperty({ type: [HeatmapPointDto] })
  heatmapData: HeatmapPointDto[];

  @ApiProperty({ type: [ActiveCustomerDotDto] })
  activeCustomerDots: ActiveCustomerDotDto[];
}