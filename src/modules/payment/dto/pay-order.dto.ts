// pay-order.dto.ts
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaymentMethodDto } from '../../../shared/enums';
import { ApiProperty } from '@nestjs/swagger';

export class PayOrderDto {
  @ApiProperty({
  description: 'Payment method to use for the transaction',
  enum: PaymentMethodDto,
  example: PaymentMethodDto.WALLET,
})
  @IsEnum(PaymentMethodDto)
  paymentMethod: PaymentMethodDto;

  // // Only required when paymentMethod === MONNIFY.
  // @IsOptional()
  // @IsString()
  // redirectUrl?: string;
}