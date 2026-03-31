import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsString } from 'class-validator';

export class GetNearbyStoresQueryDto {
  @ApiPropertyOptional({ description: 'User latitude', type: Number })
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional({ description: 'User longitude', type: Number })
  @IsOptional()
  @IsNumber()
  lng?: number;

  @ApiPropertyOptional({ description: 'Radius in km', type: Number })
  @IsOptional()
  @IsNumber()
  radiusKm?: number;

  @ApiPropertyOptional({
    description: 'Search by store name, address, description, or product',
    type: String,
  })
  @IsOptional()
  @IsString()
  search?: string;
}
