// dto/category.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsUrl,
  Min,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Restaurants' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'All types of restaurants' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/icon.png' })
  //@IsUrl()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  //@IsUrl()
  @IsOptional()
  image?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1, minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Restaurants & Cafes' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'All types of restaurants and cafes' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/icon.png' })
  @IsUrl()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @IsUrl()
  @IsOptional()
  image?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 2, minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}
