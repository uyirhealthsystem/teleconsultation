
import {
  ConsentType,
  PrescriptionStatus,
  SessionStatus,
} from "../generated/prisma/client.js";

import { prisma } from "./prisma.service.js";
import { assertAppointmentHasSignedConsent } from "./consent.service.js";
import { ApiError } from "../utils/ApiError.js";

export type PrescriptionActor = {
  userId: string;
  role: string;
};

type PrescriptionItemInput = {
  medicineName?: string;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  quantity?: number | null;
  instructions?: string | null;
  sortOrder?: number;
};

type CreatePrescriptionInput = {
  instructions?: string | null;
  items: PrescriptionItemInput[];
};

const PATIENT_ROLES = new Set([
  "PATIENT",
  "CITIZEN",
  "USER",
  "CITIZEN_USER",
]);

const PRESCRIPTION_INCLUDE = {
  items: {
    orderBy: {
      sortOrder: "asc" as const,
    },
  },
};

function validatePatientAge(patientAge: number) {
  if (
    !Number.isInteger(patientAge) ||
    patientAge < 0 ||
    patientAge > 130
  ) {
    throw new ApiError(
      400,
      "Invalid patient age stored on appointment",
    );
  }
}

/**
 * Authorize the assigned doctor or actual patient.
 *
 * Age is read only from the appointment database record.
 * Adults do not require guardian consent.
 * Minors require an existing signed MINOR_GUARDIAN consent.
 */
async function authorizeAppointment(
  appointmentId: string,
  actor: PrescriptionActor,
) {
  if (!actor.userId || !actor.role) {
    throw new ApiError(401, "Authentication is required");
  }

  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
  });

  if (!appointment) {
    throw new ApiError(404, "Appointment not found");
  }

  const patientAge = appointment.patientAgeAtBooking;

  if (patientAge === null || patientAge === undefined) {
    throw new ApiError(
      409,
      "Patient age was not recorded for this appointment",
    );
  }

  validatePatientAge(patientAge);

  const expectedCategory = patientAge >= 18 ? "ADULT" : "MINOR";

  if (appointment.patientCategory !== expectedCategory) {
    throw new ApiError(
      409,
      "Patient category does not match the age recorded for this appointment",
    );
  }

  const role = actor.role.trim().toUpperCase();

  const isDoctor =
    role === "DOCTOR" &&
    appointment.doctorId === actor.userId;

  const isPatient =
    PATIENT_ROLES.has(role) &&
    appointment.patientId === actor.userId;

  if (!isDoctor && !isPatient) {
    throw new ApiError(
      403,
      "You are not authorized to access this prescription",
    );
  }

  await assertAppointmentHasSignedConsent(
    appointmentId,
    ConsentType.MINOR_GUARDIAN,
    patientAge,
  );

  return {
    appointment,
    isDoctor,
    isPatient,
    patientAge,
  };
}

/**
 * Validate one medicine item.
 */
function validateItemInput(input: PrescriptionItemInput) {
  if (
    !input ||
    typeof input.medicineName !== "string" ||
    !input.medicineName.trim()
  ) {
    throw new ApiError(400, "medicineName is required");
  }

  for (const field of [
    "dosage",
    "frequency",
    "duration",
    "instructions",
  ] as const) {
    const value = input[field];

    if (
      value !== undefined &&
      value !== null &&
      typeof value !== "string"
    ) {
      throw new ApiError(
        400,
        `${field} must be a string or null`,
      );
    }
  }

  if (
    input.quantity !== undefined &&
    input.quantity !== null &&
    (!Number.isInteger(input.quantity) || input.quantity <= 0)
  ) {
    throw new ApiError(
      400,
      "quantity must be a positive integer or null",
    );
  }

  if (
    input.sortOrder !== undefined &&
    (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)
  ) {
    throw new ApiError(
      400,
      "sortOrder must be a non-negative integer",
    );
  }
}

/**
 * Create and issue a prescription.
 *
 * Requirements:
 * - Assigned doctor only.
 * - Adult patients do not require guardian consent.
 * - Minor patients require signed guardian consent.
 * - Consultation session must have ended.
 * - Only one prescription per appointment.
 */
export async function createPrescription(
  appointmentId: string,
  actor: PrescriptionActor,
  input: CreatePrescriptionInput,
) {
  const { appointment, isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can create a prescription",
    );
  }

  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new ApiError(
      400,
      "A valid prescription body is required",
    );
  }

  if (
    input.instructions !== undefined &&
    input.instructions !== null &&
    typeof input.instructions !== "string"
  ) {
    throw new ApiError(
      400,
      "Prescription instructions must be a string or null",
    );
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ApiError(
      400,
      "At least one medicine is required",
    );
  }

  for (const item of input.items) {
    validateItemInput(item);
  }

  const session = await prisma.consultationSession.findUnique({
    where: { appointmentId },
  });

  if (!session || session.status !== SessionStatus.ENDED) {
    throw new ApiError(
      409,
      "The consultation session must end before creating a prescription",
    );
  }

  const existing = await prisma.prescription.findUnique({
    where: { appointmentId },
  });

  if (existing) {
    throw new ApiError(
      409,
      "A prescription already exists for this appointment",
    );
  }

  try {
    return await prisma.prescription.create({
      data: {
        appointmentId,
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        status: PrescriptionStatus.ISSUED,
        instructions: input.instructions ?? null,
        issuedAt: new Date(),

        items: {
          create: input.items.map((item, index) => ({
            medicineName: item.medicineName!.trim(),
            dosage: item.dosage ?? null,
            frequency: item.frequency ?? null,
            duration: item.duration ?? null,
            quantity: item.quantity ?? null,
            instructions: item.instructions ?? null,
            sortOrder: item.sortOrder ?? index + 1,
          })),
        },
      },
      include: PRESCRIPTION_INCLUDE,
    });
  } catch (error) {
    const existingPrescription =
      await prisma.prescription.findUnique({
        where: { appointmentId },
      });

    if (existingPrescription) {
      throw new ApiError(
        409,
        "A prescription already exists for this appointment",
      );
    }

    throw error;
  }
}

/**
 * Retrieve the prescription for a specific appointment.
 *
 * Both assigned doctor and actual patient can access it.
 */
export async function getPrescription(
  appointmentId: string,
  actor: PrescriptionActor,
) {
  const { isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  const prescription = await prisma.prescription.findUnique({
    where: { appointmentId },
    include: PRESCRIPTION_INCLUDE,
  });

  if (!prescription) {
    throw new ApiError(404, "Prescription not found");
  }

  if (
    !isDoctor &&
    prescription.status !== PrescriptionStatus.ISSUED
  ) {
    throw new ApiError(
      403,
      "This prescription has not been issued yet",
    );
  }

  return prescription;
}
