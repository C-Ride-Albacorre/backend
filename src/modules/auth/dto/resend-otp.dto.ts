import { ApiProperty } from '@nestjs/swagger';

export class ResendOtpDto {
  @ApiProperty({
    description: 'User identifier (email or phone)',
    example: 'user@example.com | +2345968979706',
  })
  identifier: string;
}
