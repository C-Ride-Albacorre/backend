-- CreateEnum
CREATE TYPE "OnBoardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "onboardingStatus" "OnBoardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "onboardingStep" INTEGER;
