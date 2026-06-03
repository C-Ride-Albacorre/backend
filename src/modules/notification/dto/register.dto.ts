import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({
    example: 'fcm_token_xyz',
  })
    @IsString()

  token: string;

  @ApiPropertyOptional({
    example: 'android',
  })
  @IsOptional()
  @IsString()
  deviceType?: string;
}