// dto/current-session-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class CurrentSessionResponseDto {
  @ApiProperty({ description: 'Driver ID', example: 'driver-123' })
  driverId: string;

  @ApiProperty({
    description: 'Current session duration in seconds, or null if not active',
    example: 1200,
    nullable: true,
  })
  durationSeconds: number | null;

  @ApiProperty({
    description: 'Start time of the current session (ISO string) or null',
    example: '2026-08-28T10:00:00.000Z',
    nullable: true,
  })
  startedAt: string | null;
}