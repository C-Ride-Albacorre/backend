import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export enum LocationStatus {
  ALL = 'All',
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

export class QueryLocationDto {
  @ApiPropertyOptional({ default: 1, description: 'Page number' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, description: 'Number of items per page' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Search by name, city, or region' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: LocationStatus, default: LocationStatus.ALL, description: 'Filter by status' })
  @IsEnum(LocationStatus)
  @IsOptional()
  status?: LocationStatus = LocationStatus.ALL;
}