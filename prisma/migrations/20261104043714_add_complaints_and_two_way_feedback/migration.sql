-- CreateEnum
CREATE TYPE "ComplaintCategory" AS ENUM ('DOCTOR_NO_SHOW', 'DOCTOR_DELAY', 'TECHNICAL_ISSUE', 'PAYMENT_ISSUE', 'DOCTOR_BEHAVIOUR', 'PRESCRIPTION_ISSUE', 'SERVICE_QUALITY', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FeedbackSubmittedRole" AS ENUM ('PATIENT', 'DOCTOR');

-- CreateTable
CREATE TABLE "ConsultationComplaint" (
    "complaintId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "category" "ComplaintCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationComplaint_pkey" PRIMARY KEY ("complaintId")
);

-- CreateTable
CREATE TABLE "ConsultationFeedback" (
    "feedbackId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submittedRole" "FeedbackSubmittedRole" NOT NULL,
    "overallRating" INTEGER,
    "communicationRating" INTEGER,
    "experienceRating" INTEGER,
    "cooperationRating" INTEGER,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationFeedback_pkey" PRIMARY KEY ("feedbackId")
);

-- CreateIndex
CREATE INDEX "ConsultationComplaint_submittedBy_createdAt_idx" ON "ConsultationComplaint"("submittedBy", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultationComplaint_patientId_createdAt_idx" ON "ConsultationComplaint"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultationComplaint_appointmentId_idx" ON "ConsultationComplaint"("appointmentId");

-- CreateIndex
CREATE INDEX "ConsultationComplaint_status_createdAt_idx" ON "ConsultationComplaint"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultationFeedback_submittedBy_createdAt_idx" ON "ConsultationFeedback"("submittedBy", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultationFeedback_appointmentId_submittedRole_idx" ON "ConsultationFeedback"("appointmentId", "submittedRole");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationFeedback_appointmentId_submittedBy_key" ON "ConsultationFeedback"("appointmentId", "submittedBy");

-- AddForeignKey
ALTER TABLE "ConsultationComplaint" ADD CONSTRAINT "ConsultationComplaint_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("appointmentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationFeedback" ADD CONSTRAINT "ConsultationFeedback_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("appointmentId") ON DELETE RESTRICT ON UPDATE CASCADE;
