import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

export class AuthResponseDto {
  @ApiProperty({ example: 'jwt-token-here' })
  accessToken: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
