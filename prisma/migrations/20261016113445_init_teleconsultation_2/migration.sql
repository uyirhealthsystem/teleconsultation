/*
  Warnings:

  - Added the required column `bookedByUserId` to the `Appointment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Notification` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BookingFor" AS ENUM ('SELF', 'FAMILY_MEMBER', 'OTHER_PERSON');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TELECONSULTATION', 'MINOR_GUARDIAN', 'REPRESENTATIVE');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'SIGNED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('ELECTRONIC_ATTESTATION', 'DIGITAL_CERTIFICATE');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('PATIENT', 'GUARDIAN', 'FAMILY_MEMBER', 'INTERPRETER', 'CAREGIVER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SessionStatus" ADD VALUE 'WAITING_FOR_DOCTOR';
ALTER TYPE "SessionStatus" ADD VALUE 'DOCTOR_DELAYED';

-- DropIndex
DROP INDEX "PrescriptionItem_prescriptionId_idx";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "bookedByUserId" TEXT NOT NULL,
ADD COLUMN     "bookingFor" "BookingFor" NOT NULL DEFAULT 'SELF';

-- AlterTable
ALTER TABLE "ConsultationNote" ADD COLUMN     "advice" TEXT;

-- AlterTable
ALTER TABLE "ConsultationSession" ADD COLUMN     "delayNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "scheduledStartAt" TIMESTAMP(3),
ADD COLUMN     "waitingStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DoctorAvailability" ADD COLUMN     "hospitalId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "signatureHash" TEXT,
ADD COLUMN     "signatureMethod" "SignatureMethod",
ADD COLUMN     "signatureObjectKey" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "signedByDoctorId" TEXT;

-- AlterTable
ALTER TABLE "PrescriptionItem" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "consentId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "consentType" "ConsentType" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "signerUserId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerRelationship" TEXT,
    "signerAuthority" TEXT,
    "consentVersion" TEXT NOT NULL,
    "consentTextHash" TEXT NOT NULL,
    "signatureMethod" "SignatureMethod" NOT NULL DEFAULT 'ELECTRONIC_ATTESTATION',
    "signatureObjectKey" TEXT,
    "signatureHash" TEXT,
    "signedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("consentId")
);

-- CreateTable
CREATE TABLE "ConsultationParticipant" (
    "participantId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "userId" TEXT,
    "patientId" TEXT,
    "displayName" TEXT NOT NULL,
    "role" "ParticipantRole" NOT NULL,
    "invitedByUserId" TEXT,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationParticipant_pkey" PRIMARY KEY ("participantId")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_appointmentId_status_idx" ON "ConsentRecord"("appointmentId", "status");

-- CreateIndex
CREATE INDEX "ConsentRecord_signerUserId_createdAt_idx" ON "ConsentRecord"("signerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultationParticipant_appointmentId_role_idx" ON "ConsultationParticipant"("appointmentId", "role");

-- CreateIndex
CREATE INDEX "ConsultationParticipant_userId_idx" ON "ConsultationParticipant"("userId");

-- CreateIndex
CREATE INDEX "ConsultationParticipant_patientId_idx" ON "ConsultationParticipant"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_bookedByUserId_scheduledAt_idx" ON "Appointment"("bookedByUserId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Appointment_hospitalId_scheduledAt_idx" ON "Appointment"("hospitalId", "scheduledAt");

-- CreateIndex
CREATE INDEX "ConsultationNote_doctorId_createdAt_idx" ON "ConsultationNote"("doctorId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultationSession_status_scheduledStartAt_idx" ON "ConsultationSession"("status", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "DoctorAvailability_hospitalId_dayOfWeek_idx" ON "DoctorAvailability"("hospitalId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Notification_status_scheduledAt_idx" ON "Notification"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Prescription_patientId_createdAt_idx" ON "Prescription"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "Prescription_doctorId_createdAt_idx" ON "Prescription"("doctorId", "createdAt");

-- CreateIndex
CREATE INDEX "Prescription_status_issuedAt_idx" ON "Prescription"("status", "issuedAt");

-- CreateIndex
CREATE INDEX "PrescriptionItem_prescriptionId_sortOrder_idx" ON "PrescriptionItem"("prescriptionId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("appointmentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationParticipant" ADD CONSTRAINT "ConsultationParticipant_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("appointmentId") ON DELETE RESTRICT ON UPDATE CASCADE;
