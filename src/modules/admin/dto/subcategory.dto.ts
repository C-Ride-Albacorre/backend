// dto/subcategory.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateSubcategoryDto {
  @ApiProperty({ example: 'Italian Restaurant' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Authentic Italian cuisine' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  categoryId: string;

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

export class UpdateSubcategoryDto {
  @ApiPropertyOptional({ example: 'Italian Cuisine' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Traditional Italian dishes' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

    @ApiPropertyOptional({ example: 'https://example.com/icon.png' })
  //@IsUrl()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  //@IsUrl()
  @IsOptional()
  image?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 2, minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}
