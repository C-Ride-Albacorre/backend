import { Type } from 'class-transformer';
import { IsOptional, IsNumber, IsInt, Min, Max, IsString } from 'class-validator';

export class GetStoresQueryDto {
  @IsOptional()
  @Type(() => Number) // 🔥 transforms string → number
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50) // prevent crazy radius
  radiusKm?: number; //= 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number; // = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number; //= 20;

  @IsOptional()
  @IsString()
  search?: string;
}
