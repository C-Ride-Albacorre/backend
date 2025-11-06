import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class CreateMenuDto {
  @ApiProperty({ example: 'Grilled Chicken Salad' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Fresh greens with grilled chicken' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Main Restaurant' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'Main Restaurant' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description:
      'Menu image file (optional). If provided, it overrides imageUrl.',
  })
  file?: any;
}
