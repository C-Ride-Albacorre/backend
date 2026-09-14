import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateLocationDto {
  @ApiProperty({ example: 'Lagos Island', description: 'Name of the delivery location' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Lagos', description: 'City of the location' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'Lagos State', description: 'State or Region' })
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiPropertyOptional({ example: 'Nigeria', description: 'Country of operation', default: 'Nigeria' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: 5, description: 'Number of zones in this location' })
  @IsInt()
  @IsOptional()
  zones?: number;

  @ApiPropertyOptional({ example: true, description: 'Enable or disable delivery operations here', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}