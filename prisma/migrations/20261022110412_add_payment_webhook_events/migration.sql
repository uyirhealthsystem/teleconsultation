-- CreateEnum
CREATE TYPE "PaymentWebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "eventId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "paymentStatus" TEXT NOT NULL,
    "status" "PaymentWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_paymentId_paymentStatus_idx" ON "PaymentWebhookEvent"("paymentId", "paymentStatus");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_status_createdAt_idx" ON "PaymentWebhookEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_appointmentId_idx" ON "PaymentWebhookEvent"("appointmentId");

-- RenameIndex
ALTER INDEX "ConsultationSession_livekitRoomName_key" RENAME TO "ConsultationSession_meetingRoomId_key";
