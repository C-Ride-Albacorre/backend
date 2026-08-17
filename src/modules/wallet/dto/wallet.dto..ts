import { IsEnum, IsNumber, Min } from "class-validator";

// wallet.dto.ts
export class FundWalletDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsEnum(['CARD', 'ACCOUNT_TRANSFER', 'USSD'])
  paymentMethod: string;
}