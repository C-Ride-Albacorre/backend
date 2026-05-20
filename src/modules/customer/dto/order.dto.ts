// src/customer/dto/order.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsPhoneNumber,
  IsOptional,
  ValidateNested,
  IsNumber,
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

export class PickupLocationDto {
  @ApiProperty()
  @IsString()
  address: string;

  @ApiProperty()
  @IsNumber()
  latitude: number;

  @ApiProperty()
  @IsNumber()
  longitude: number;
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

  // @ApiProperty()
  // @IsString()
  // pickupLocation?: string;

  @ApiProperty({ type: PickupLocationDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PickupLocationDto)
  pickupLocation?: PickupLocationDto;

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
  pickupLocation: PickupLocationDto;

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
