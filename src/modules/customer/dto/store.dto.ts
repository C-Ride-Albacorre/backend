// src/customer/dto/store.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class StoreWithDetailsDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  storeName: string;

  @ApiProperty()
  storeCategory: string;

  @ApiProperty({ type: [String] })
  subcategories: string[];

  @ApiProperty()
  storeDescription?: string;

  @ApiProperty()
  storeAddress: string;

  @ApiProperty()
  phoneNumber: string;

  @ApiProperty()
  minimumOrder: number;

  @ApiProperty()
  preparationTime: number;

  @ApiProperty()
  storeLogo?: string;

  @ApiProperty()
  rating?: number;

  @ApiProperty()
  totalReviews?: number;

  @ApiProperty()
  isOpen: boolean;

  @ApiProperty()
  distance?: number; // Distance from customer location
}
