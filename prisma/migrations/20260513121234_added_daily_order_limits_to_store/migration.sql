/*
  Warnings:

  - You are about to drop the column `minimumOrder` on the `Store` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Store" DROP COLUMN "minimumOrder",
ADD COLUMN     "dailyOrderLimit" INTEGER;
