import { ApiProperty } from '@nestjs/swagger';

export class StoreResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() storeName: string;
  @ApiProperty() storeCategory: string;
  @ApiProperty() categoryId?: string;
  @ApiProperty({ type: [String] }) subcategories: string[];
  @ApiProperty() storeDescription: string;
  @ApiProperty() storeAddress: string;
  @ApiProperty() phoneNumber: string;
  @ApiProperty() dailyOrderLimit: number;
  @ApiProperty() preparationTime: number;
  @ApiProperty() storeLogo: string;
  @ApiProperty() isOpen: boolean;
  @ApiProperty({
    required: false,
    description: 'Distance in kilometers',
    example: 2.4,
  })
  distance?: number;
}
