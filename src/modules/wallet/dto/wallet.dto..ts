import { PaymentMethod } from "@prisma/client";
import { IsEnum, IsNumber, Min } from "class-validator";

// wallet.dto.ts
export class FundWalletDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}