import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';

export class VendorActionDto {
@ApiProperty({
    enum: ['ACCEPT', 'DECLINE'],
    description: 'Vendor action type',
    example: 'ACCEPT',
  })
  @IsEnum(['ACCEPT', 'DECLINE'])
  action: 'ACCEPT' | 'DECLINE';

  @ApiPropertyOptional({
    description: 'Reason for declining or providing context for the action',
    example: 'Out of stock',
  })
  @IsString()
  reason?: string;
}