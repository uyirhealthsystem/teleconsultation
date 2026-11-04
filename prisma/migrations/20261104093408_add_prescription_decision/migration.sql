-- CreateEnum
CREATE TYPE "PrescriptionDecision" AS ENUM ('PENDING', 'PRESCRIBED', 'NOT_REQUIRED');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "prescriptionDecision" "PrescriptionDecision" NOT NULL DEFAULT 'PENDING';
