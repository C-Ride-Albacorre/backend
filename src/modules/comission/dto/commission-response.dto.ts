import { ApiProperty } from '@nestjs/swagger';
import { CommissionStatus } from '@prisma/client';

class VendorSummaryDto {
  @ApiProperty({ example: 'a1b2c3d4-...' })
  id: string;

  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ example: 'john@example.com', nullable: true })
  email: string | null;
}

export class CommissionResponseDto {
  @ApiProperty({ example: 'clx123abc...' })
  id: string;

  @ApiProperty({ example: 'a1b2c3d4-...' })
  vendorId: string;

  @ApiProperty({ type: VendorSummaryDto, required: false })
  vendor?: VendorSummaryDto;

  @ApiProperty({ example: 'Lagos Island' })
  location: string;

  @ApiProperty({ example: 'Lagos' })
  city: string;

  @ApiProperty({ example: 14.5 })
  vendorCommission: number;

  @ApiProperty({ example: 5.0 })
  serviceCharge: number;

  @ApiProperty({ enum: CommissionStatus, example: CommissionStatus.ACTIVE })
  status: CommissionStatus;

  @ApiProperty({ example: '2026-09-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-09-01T12:00:00Z' })
  updatedAt: Date;
}