import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AddPhoneDto {
  @ApiProperty({
    example: '+2348012345678',
    description: 'User phone number in international format (E.164)',
  })
  @IsNotEmpty()
  @IsString()
  //@IsPhoneNumber(null) // automatically validates country format
  phoneNumber: string;
}
