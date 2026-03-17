// dto/cart-summary.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsUUID,
  ValidateNested,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryOptionDto } from './delivery-option.dto';

export enum CartItemType {
  PRODUCT = 'PRODUCT',
  PACKAGE = 'PACKAGE',
  SERVICE = 'SERVICE',
}

export class CartItemSummaryDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  id: string;

  @ApiProperty({ enum: CartItemType, example: CartItemType.PRODUCT })
  @IsEnum(CartItemType)
  itemType: CartItemType;

  @ApiProperty({ example: 'Deluxe Pizza' })
  @IsString()
  name: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  quantity: number;

  @ApiProperty({ example: 25.99 })
  @IsNumber()
  unitPrice: number;

  @ApiProperty({ example: 51.98 })
  @IsNumber()
  totalPrice: number;

  @ApiPropertyOptional({ example: 'Extra cheese, well done' })
  @IsString()
  @IsOptional()
  specialInstructions?: string;

  @ApiPropertyOptional({
    type: [Object],
    example: [{ name: 'Extra Cheese', price: 2.99 }],
  })
  @IsOptional()
  selectedAddons?: any[];

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @IsOptional()
  image?: string;
}

export class StoreSummaryDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  storeId: string;

  @ApiProperty({ example: "Joe's Pizza" })
  @IsString()
  storeName: string;

  @ApiProperty({ type: [CartItemSummaryDto] })
  @ValidateNested({ each: true })
  @Type(() => CartItemSummaryDto)
  items: CartItemSummaryDto[];

  @ApiProperty({ example: 51.98 })
  @IsNumber()
  subtotal: number;

  @ApiProperty({ example: 5.99 })
  @IsNumber()
  deliveryFee: number;

  @ApiProperty({ example: 2.99 })
  @IsNumber()
  serviceFee: number;

  @ApiProperty({ example: 4.16 })
  @IsNumber()
  taxAmount: number;

  @ApiProperty({ example: 65.12 })
  @IsNumber()
  storeTotal: number;
}

export class CartSummaryDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  cartId: string;

  @ApiProperty({ type: [StoreSummaryDto] })
  @ValidateNested({ each: true })
  @Type(() => StoreSummaryDto)
  stores: StoreSummaryDto[];

  @ApiProperty({ type: [CartItemSummaryDto] })
  @ValidateNested({ each: true })
  @Type(() => CartItemSummaryDto)
  items: CartItemSummaryDto[];

  @ApiProperty({ example: 3 })
  @IsNumber()
  totalItems: number;

  @ApiProperty({ example: 51.98 })
  @IsNumber()
  subtotal: number;

  @ApiProperty({ example: 5.99 })
  @IsNumber()
  deliveryFee: number;

  @ApiProperty({ example: 2.99 })
  @IsNumber()
  serviceFee: number;

  @ApiProperty({ example: 4.16 })
  @IsNumber()
  taxAmount: number;

  @ApiProperty({ example: 65.12 })
  @IsNumber()
  totalAmount: number;

  @ApiPropertyOptional({ type: DeliveryOptionDto })
  @ValidateNested()
  @Type(() => DeliveryOptionDto)
  @IsOptional()
  selectedDeliveryOption?: DeliveryOptionDto;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  @IsString()
  expiresAt: string;
}
