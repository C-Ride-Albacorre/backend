// src/modules/vendor-store/dto/list-store-orders-query.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class ListStoreOrdersQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  
  @ApiPropertyOptional({
    description:
      'Filter orders by vendor code (case-insensitive). Returns all orders matching this code for this store.',
    example: '1234',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  vendorCode?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}