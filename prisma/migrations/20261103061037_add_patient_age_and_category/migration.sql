-- CreateEnum
CREATE TYPE "PatientCategory" AS ENUM ('ADULT', 'MINOR');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "patientAgeAtBooking" INTEGER,
ADD COLUMN     "patientCategory" "PatientCategory";
