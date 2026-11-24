// pay-order.dto.ts
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaymentMethodDto } from '../../../shared/enums';

export class PayOrderDto {
  @IsEnum(PaymentMethodDto)
  paymentMethod: PaymentMethodDto;

  // Only required when paymentMethod === MONNIFY.
  @IsOptional()
  @IsString()
  redirectUrl?: string;
}