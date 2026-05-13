// src/customer/dto/cart.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsUUID,
  IsInt,
  Min,
  IsOptional,
  IsArray,
  IsString,
} from 'class-validator';
// import { Type } from 'class-transformer';

export class AddToCartDto {
  @ApiProperty({ enum: ['PRODUCT', 'PACKAGE', 'DOCUMENT'] })
  @IsEnum(['PRODUCT', 'PACKAGE', 'DOCUMENT'])
  itemType: 'PRODUCT' | 'PACKAGE' | 'DOCUMENT';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  packageId?: string;

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  addonIds?: string[];

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  specialInstructions?: string;
}

export class CartItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  itemType: string;

  // ✅ ADD THESE
  @ApiProperty({ required: false, nullable: true })
  productId?: string;

  @ApiProperty({ required: false, nullable: true })
  packageId?: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description?: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  totalPrice: number;

  @ApiProperty({ type: [Object], required: false })
  selectedAddons?: any[];

  @ApiProperty()
  storeName?: string;

  @ApiProperty()
  specialInstructions?: string;

  @ApiProperty()
  storeId?: string;

  @ApiProperty()
  variantId?: string;
}

export class CartSummaryDto {
  @ApiProperty()
  cartId: string;

  @ApiProperty({ type: [CartItemDto] })
  items: CartItemDto[];

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  deliveryFee: number;

  @ApiProperty()
  serviceFee: number;

  @ApiProperty()
  taxAmount: number;

  @ApiProperty()
  totalAmount: number;
}
