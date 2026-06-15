// send-message.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';

export class SendMessageDto {
  @ApiProperty()
  @IsString()
  message: string;

  @ApiProperty({ enum: ['TEXT', 'IMAGE', 'LOCATION'], required: false })
  @IsOptional()
  @IsEnum(['TEXT', 'IMAGE', 'LOCATION'])
  type?: string;
}