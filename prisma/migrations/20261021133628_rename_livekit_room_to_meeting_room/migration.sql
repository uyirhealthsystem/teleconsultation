/*
  Warnings:

  - You are about to drop the column `livekitRoomName` on the `ConsultationSession` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[meetingRoomId]` on the table `ConsultationSession` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `meetingRoomId` to the `ConsultationSession` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "ConsultationSession_livekitRoomName_key";

-- AlterTable
ALTER TABLE "ConsultationSession" DROP COLUMN "livekitRoomName",
ADD COLUMN     "meetingRoomId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationSession_meetingRoomId_key" ON "ConsultationSession"("meetingRoomId");
