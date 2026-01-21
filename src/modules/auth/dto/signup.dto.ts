import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({ example: 'Test User' })
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'tuser@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'StrongPassword123!' })
  @MinLength(8)
  password: string;
}
