import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 'error' })
  status: string;

  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: '2025-10-15T22:14:21.088Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/v1/auth/login' })
  path: string;

  @ApiProperty({ example: 'Invalid credentials' })
  message: string;
}
