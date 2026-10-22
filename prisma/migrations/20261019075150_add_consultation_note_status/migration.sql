-- CreateEnum
CREATE TYPE "ConsultationNoteStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- AlterTable
ALTER TABLE "ConsultationNote" ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ConsultationNoteStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateIndex
CREATE INDEX "ConsultationNote_status_updatedAt_idx" ON "ConsultationNote"("status", "updatedAt");
