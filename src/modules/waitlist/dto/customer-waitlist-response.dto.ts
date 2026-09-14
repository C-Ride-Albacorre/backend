// src/waitlist/dto/customer-waitlist-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class CustomerWaitlistResponseDto {
  @ApiProperty({ example: 'clx123abc...', description: 'Unique customer waitlist ID' })
  id: string;

  @ApiProperty({ example: 'Alice Johnson', description: 'Customer full name' })
  fullName: string;

  @ApiProperty({ example: 'alice@example.com', description: 'Customer email address' })
  email: string;

  @ApiProperty({ example: '+1122334455', description: 'Customer phone number' })
  phoneNumber: string;

  @ApiProperty({ example: 'New York', description: 'City of residence' })
  city: string;

  @ApiProperty({ example: 'Groceries', description: 'Category of orders the customer is interested in' })
  orderCategory: string;

  @ApiProperty({ example: 'Personal shopping', description: 'Purpose of using the service' })
  purpose: string;

  @ApiProperty({ example: '2026-09-01T12:00:00Z', description: 'Record creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-09-01T12:00:00Z', description: 'Record last-updated timestamp' })
  updatedAt: Date;
}