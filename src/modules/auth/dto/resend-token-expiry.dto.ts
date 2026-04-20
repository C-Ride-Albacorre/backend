import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ResendVerificationTokenDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email or phone number of the user',
  })
  @IsString()
  identifier: string;
}
