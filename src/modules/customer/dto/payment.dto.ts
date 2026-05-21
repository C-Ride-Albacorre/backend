// src/customer/dto/payment.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsUUID, IsString, IsEnum, IsOptional, IsObject, ValidateNested, IsNumber } from 'class-validator';

export enum MonnifyPaymentMethod {
  CARD = 'CARD',
  ACCOUNT_TRANSFER = 'ACCOUNT_TRANSFER',
  USSD = 'USSD',
  QR_CODE = 'QR_CODE',
}

export class InitializePaymentDto {
  @ApiProperty()
  @IsUUID()
  orderId: string;

  @ApiProperty({ enum: MonnifyPaymentMethod })
  @IsEnum(MonnifyPaymentMethod)
  paymentMethod: MonnifyPaymentMethod;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  callbackUrl?: string;
}

export class MonnifyPaymentResponse {
  @ApiProperty()
  requestSuccessful: boolean;

  @ApiProperty()
  responseMessage: string;

  @ApiProperty()
  responseBody: {
    transactionReference: string;
    paymentReference: string;
    checkoutUrl?: string;
    qrCodeImage?: string;
    ussdCode?: string;
    bankName?: string;
    accountNumber?: string;
    amount: number;
  };
}

export class MonnifyProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;
}

export class MonnifyWebhookDto {
  @ApiProperty()
  @IsString()
  transactionReference: string;

  @ApiProperty()
  @IsString()
  paymentReference: string;

  @ApiProperty()
  @IsNumber()
  amountPaid: number;

  @ApiProperty()
  @IsNumber()
  totalPayable: number;

  @ApiProperty()
  @IsNumber()
  settlementAmount: number;

  @ApiProperty()
  @IsString()
  paidOn: string;

  @ApiProperty()
  @IsString()
  paymentStatus: string;

  @ApiProperty()
  @IsString()
  paymentDescription: string;

  @ApiProperty()
  @IsString()
  currency: string;

  @ApiProperty()
  @IsString()
  paymentMethod: string;

  @ApiProperty({ type: MonnifyProductDto })
  @ValidateNested()
  @Type(() => MonnifyProductDto)
  product: MonnifyProductDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  cardDetails?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  accountDetails?: Record<string, any>;

  // Additional fields Monnify might send
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  eventData?: Record<string, any>;

  // Allow unknown properties gracefully
  [key: string]: any;
}

// export class MonnifyWebhookDto {
//   @ApiProperty()
//   transactionReference: string;

//   @ApiProperty()
//   paymentReference: string;

//   @ApiProperty()
//   amountPaid: number;

//   @ApiProperty()
//   totalPayable: number;

//   @ApiProperty()
//   settlementAmount: number;

//   @ApiProperty()
//   paidOn: string;

//   @ApiProperty()
//   paymentStatus: string;

//   @ApiProperty()
//   paymentDescription: string;

//   @ApiProperty()
//   currency: string;

//   @ApiProperty()
//   paymentMethod: string;

//   @ApiProperty()
//   product: {
//     type: string;
//     reference: string;
//   };

//   @ApiProperty()
//   cardDetails?: any;

//   @ApiProperty()
//   accountDetails?: any;
// }
