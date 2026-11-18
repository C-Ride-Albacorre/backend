// src/vacancy/dto/vacancy-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { PostStatus, WorkplaceType } from '@prisma/client';

export class VacancyResponseDto {
  @ApiProperty({ example: 'clx123abc...' })
  id: string;

  @ApiProperty({ example: 'Operations Manager' })
  positionTitle: string;

  @ApiProperty({ example: 'Lagos, Nigeria' })
  location: string;

  @ApiProperty({ enum: WorkplaceType, example: WorkplaceType.ONSITE })
  workplaceType: WorkplaceType;

  @ApiProperty({ enum: PostStatus, example: PostStatus.PUBLISHED })
  status: PostStatus;

  @ApiProperty({ example: 'A concise introduction...' })
  roleSummary: string;

  @ApiProperty({ example: 'Describe the role...' })
  jobDescription: string;

  @ApiProperty({ example: 500000, nullable: true })
  salaryMin: number | null;

  @ApiProperty({ example: 700000, nullable: true })
  salaryMax: number | null;

  @ApiProperty({ example: '2026-08-30T00:00:00Z', nullable: true })
  deadline: Date | null;

  @ApiProperty({ example: '2026-07-18T10:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-07-18T10:00:00Z' })
  updatedAt: Date;
}

// src/vacancy/dto/vacancy-stats.dto.ts
export class VacancyStatsDto {
  @ApiProperty({ example: 3 }) totalPositions: number;
  @ApiProperty({ example: 1 }) published: number;
  @ApiProperty({ example: 1 }) drafts: number;
  @ApiProperty({ example: 1 }) closed: number;
}