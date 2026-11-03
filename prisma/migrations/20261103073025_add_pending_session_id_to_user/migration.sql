-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pending_session_id" TEXT;

-- CreateIndex
CREATE INDEX "User_pending_session_id_idx" ON "User"("pending_session_id");
