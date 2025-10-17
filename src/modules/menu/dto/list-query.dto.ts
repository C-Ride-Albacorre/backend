import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListQueryDto {
  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  skip?: number = 0;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  take?: number = 20;

  @ApiPropertyOptional({ example: 'Main Restaurant' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: 'breakfast' })
  @IsOptional()
  @IsString()
  search?: string;
}
