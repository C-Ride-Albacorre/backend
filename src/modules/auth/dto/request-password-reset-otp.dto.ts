import { ApiProperty } from '@nestjs/swagger';
import { IsPhoneNumber } from 'class-validator';

export class RequestPasswordResetOtpDto {
  @ApiProperty({ example: '+1234567890' })
  @IsPhoneNumber()
  phoneNumber: string;
}
