import { ApiProperty } from '@nestjs/swagger';

export class ApiResponseDto<T> {
  @ApiProperty({ example: 'success' })
  status: string;

  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: '2025-10-15T22:12:33.512Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/v1/auth/signup' })
  path: string;

  @ApiProperty({ description: 'Response payload', nullable: true })
  data: T;
}
