// submit-by-order.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class SubmitByOrderDto {
  @ApiProperty({
    example: 'clxk3r8gb0000x9abc123456',
    description: 'Order ID for which the rating is being submitted',
  })
  @IsUUID()
  orderId: string;  

@ApiProperty({
    example: 5,
    minimum: 1,
    maximum: 5,
    description: 'Rating value between 1 and 5',
  })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
