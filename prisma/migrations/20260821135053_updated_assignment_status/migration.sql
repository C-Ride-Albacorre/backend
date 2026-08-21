/*
  Warnings:

  - The `assignmentStatus` column on the `DriverAssignment` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterEnum
ALTER TYPE "AssignmentStatus" ADD VALUE 'DECLINED';

-- AlterTable
ALTER TABLE "DriverAssignment" DROP COLUMN "assignmentStatus",
ADD COLUMN     "assignmentStatus" "AssignmentStatus" NOT NULL DEFAULT 'PENDING';
