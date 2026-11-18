-- CreateEnum
CREATE TYPE "WorkplaceType" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('PUBLISHED', 'DRAFT', 'CLOSED');

-- CreateTable
CREATE TABLE "vacancies" (
    "id" TEXT NOT NULL,
    "positionTitle" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "workplaceType" "WorkplaceType" NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "roleSummary" TEXT NOT NULL,
    "jobDescription" TEXT NOT NULL,
    "salaryMin" DOUBLE PRECISION,
    "salaryMax" DOUBLE PRECISION,
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacancies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vacancies_positionTitle_idx" ON "vacancies"("positionTitle");

-- CreateIndex
CREATE INDEX "vacancies_location_idx" ON "vacancies"("location");

-- CreateIndex
CREATE INDEX "vacancies_status_idx" ON "vacancies"("status");
