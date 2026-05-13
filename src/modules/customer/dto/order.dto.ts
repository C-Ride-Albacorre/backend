// src/customer/dto/order.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsPhoneNumber,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DropoffLocationDto {
  @ApiProperty()
  @IsString()
  address: string;

  @ApiProperty()
  @IsString()
  city: string;

  @ApiProperty()
  @IsString()
  state: string;

  @ApiProperty()
  @IsString()
  country: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  postalCode?: string;
}

export class CreateOrderDto {
  @ApiProperty()
  @IsUUID()
  cartId: string;

  @ApiProperty()
  @IsOptional()
  @IsUUID()
  deliveryOptionId?: string;

  @ApiProperty({ type: DropoffLocationDto })
  @ValidateNested()
  @Type(() => DropoffLocationDto)
  dropoffLocation: DropoffLocationDto;

  @ApiProperty()
  @IsString()
  pickupLocation?: string;

  @ApiProperty()
  @IsString()
  recipientName: string;

  @ApiProperty()
  @IsString()
  recipientPhone: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  deliveryInstructions?: string;
}

export class OrderSummaryDto {
  @ApiProperty()
  orderId: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty({ type: [Object] })
  items: any[];

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

  @ApiProperty()
  dropoffLocation: DropoffLocationDto;

  @ApiProperty()
  recipientName: string;

  @ApiProperty()
  recipientPhone: string;

  @ApiProperty()
  paymentStatus: string;

  @ApiProperty()
  orderStatus: string;

  @ApiProperty()
  createdAt: Date;
}
