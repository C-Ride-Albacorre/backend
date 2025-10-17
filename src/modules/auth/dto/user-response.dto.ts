import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ example: 'abc123' })
  id: string;

  @ApiProperty({ example: 'Samuel Ime' })
  name: string;

  @ApiProperty({ example: 'samuel@example.com' })
  email: string;
}
