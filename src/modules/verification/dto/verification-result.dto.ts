// src/verification/dto/verification-result.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class VerificationResultDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message: string;

  @ApiProperty({ required: false })
  remainingAttempts?: number;

  @ApiProperty({ required: false })
  token?: string; // For JWT if needed
}
