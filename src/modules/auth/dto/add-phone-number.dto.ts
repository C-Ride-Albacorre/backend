import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
} from 'class-validator';

export class AddPhoneDto {
  @ApiProperty({ example: 'NG', required: false })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @ApiProperty({
    example: '+2348012345678',
    description: 'User phone number in international format (E.164)',
  })
  @IsNotEmpty()
  //@IsString()
  //@IsPhoneNumber(null) // automatically validates country format
  @IsOptional()
  @IsPhoneNumber(null)
  phoneNumber?: string;

  @ApiProperty({
    description: 'Verification Token',
    example: 'abTheherbf^YhHDhddjdOkdkfhffdnfmffmaj^jklnnn',
  })
  @IsOptional()
  @IsString()
  verificationToken?: string;
}
