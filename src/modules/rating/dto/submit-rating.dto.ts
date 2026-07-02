import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SubmitRatingDto {
  @ApiProperty({
    example: 5,
    minimum: 1,
    maximum: 5,
    description: 'Rating value between 1 and 5',
  })
  @IsInt()
  @Min(1)
  @Max(5)
  ratingValue: number;

  @ApiPropertyOptional({
    example: 'Driver was very professional and delivered on time.',
    description: 'Optional review comment',
  })
  @IsOptional()
  @IsString()
  comment?: string;
}