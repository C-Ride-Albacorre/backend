// src/customer/dto/payment.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsEnum } from 'class-validator';

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

export class MonnifyWebhookDto {
  @ApiProperty()
  transactionReference: string;

  @ApiProperty()
  paymentReference: string;

  @ApiProperty()
  amountPaid: number;

  @ApiProperty()
  totalPayable: number;

  @ApiProperty()
  settlementAmount: number;

  @ApiProperty()
  paidOn: string;

  @ApiProperty()
  paymentStatus: string;

  @ApiProperty()
  paymentDescription: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  paymentMethod: string;

  @ApiProperty()
  product: {
    type: string;
    reference: string;
  };

  @ApiProperty()
  cardDetails?: any;

  @ApiProperty()
  accountDetails?: any;
}
