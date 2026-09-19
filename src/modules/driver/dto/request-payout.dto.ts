import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

export class RequestPayoutDto {
  @ApiProperty({
    description:
      'Amount to withdraw in NGN. Must be at least ₦1,000 and not exceed the available wallet balance.',
    example: 50000,
    minimum: 1000,
    maximum: 5_000_000,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1000, { message: 'Minimum payout is ₦1,000' })
  @Max(5_000_000, { message: 'Maximum single payout is ₦5,000,000' })
  amount: number;
}