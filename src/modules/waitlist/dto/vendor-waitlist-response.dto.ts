// src/waitlist/dto/vendor-waitlist-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class VendorWaitlistResponseDto {
  @ApiProperty({ example: 'clx123abc...' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'Acme Corp' })
  businessName: string;

  @ApiProperty({ example: 'contact@acme.com' })
  workEmail: string;

  @ApiProperty({ example: 'Retail' })
  businessType: string;

  @ApiProperty({ example: '+1234567890' })
  phoneNumber: string;

  @ApiProperty({ example: '123 Main St, City, Country' })
  businessAddress: string;

  @ApiProperty({ example: '2026-09-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-09-01T12:00:00Z' })
  updatedAt: Date;
}