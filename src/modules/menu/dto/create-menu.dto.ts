import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class CreateMenuDto {
  @ApiProperty({ example: 'Grilled Chicken Salad' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Fresh greens with grilled chicken' })
  @IsOptional()
  @IsString()
  description?: string;

//   @ApiPropertyOptional({ example: 12.99 })
//   @IsOptional()
//   @IsNumber()
//   price?: number;

  @ApiPropertyOptional({ example: 'Lunch' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'Main Restaurant' })
  @IsOptional()
  @IsString()
  location?: string;


}
