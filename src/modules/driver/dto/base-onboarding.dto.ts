// src/common/dto/base-onboarding.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max } from 'class-validator';

export enum OnBoardingStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  VENDOR = 'VENDOR',
  DRIVER = 'DRIVER',
  ADMIN = 'ADMIN',
}

export class BaseOnboardingDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  step?: number;
}

// Generic interface for onboarding state
export interface IOnboardingState {
  onboardingStatus: OnBoardingStatus;
  onboardingStep: number;
  accountStatus: string;
  userRole: UserRole;
  nextStep?: number;
  completedSteps: number[];
  redirectUrl?: string;
}
