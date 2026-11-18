// src/vacancy/dto/create-vacancy.dto.ts
import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { PostStatus, SalaryPeriod, WorkplaceType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsDateString } from 'class-validator';

export class CreateVacancyDto {
  @ApiProperty({ example: 'Operations Manager' })
  @IsNotEmpty()
  @IsString()
  positionTitle: string;

  @ApiProperty({ example: 'Lagos, Nigeria' })
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiProperty({ enum: WorkplaceType, example: WorkplaceType.ONSITE })
  @IsEnum(WorkplaceType)
  workplaceType: WorkplaceType;

  @ApiProperty({ enum: PostStatus, example: PostStatus.DRAFT, required: false })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;

  @ApiProperty({ example: 'A concise introduction displayed beneath the position title' })
  @IsNotEmpty()
  @IsString()
  roleSummary: string;

  @ApiProperty({ example: 'Describe the role, responsibilities and impact...' })
  @IsNotEmpty()
  @IsString()
  jobDescription: string;

  @ApiProperty({ example: 'Strong communication skils...' })
  @IsNotEmpty()
  @IsString()
  jobRequirement: string;

  @ApiProperty({ example: 500000, required: false })
  @IsOptional()
  @IsNumber()
  salaryMin?: number;

  @ApiProperty({ example: 700000, required: false })
  @IsOptional()
  @IsNumber()
  salaryMax?: number;

  
  @ApiProperty({ enum: SalaryPeriod, example: SalaryPeriod.MONTHLY})
  @Optional()
  @IsEnum(SalaryPeriod)
  salaryPeriod?: SalaryPeriod;

  @ApiProperty({ example: '2026-08-30T00:00:00Z', required: false })
  @IsOptional()
  @IsDateString()
  deadline?: string;
}