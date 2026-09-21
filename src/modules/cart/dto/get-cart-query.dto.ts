// get-cart-query.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GetCartQueryDto {
  @ApiPropertyOptional({
    example: '12 Admiralty Way, Lekki Phase 1, Lagos',
    description:
      'Dropoff address. When provided, the delivery fee is computed and included.',
  })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({
    description: 'Chosen VehicleTypeConfig.id from /cart/delivery-options',
  })
  @IsOptional()
  @IsString()
  deliveryOptionId?: string;
}