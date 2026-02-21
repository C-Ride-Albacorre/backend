import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResendOtpDto {
  @ApiProperty({
    description: 'User identifier (email or phone)',
    example: 'user@example.com | +2345968979706',
  })
  @IsString()
  @IsNotEmpty()
  identifier: string;
}
