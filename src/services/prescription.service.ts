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

/**
 * Authorize only the assigned doctor or actual patient.
 * The person who booked an appointment for somebody else
 * cannot automatically view that person's prescription.
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
    ConsentType.TELECONSULTATION,
  );

  return {
    appointment,
    isDoctor,
    isPatient,
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
 * Create and issue a complete prescription for an appointment.
 * Multiple medicines can be created in a single request.
 *
 * Requirements:
 * - The actor must be the assigned doctor.
 * - Teleconsultation consent must be signed.
 * - The consultation session must have ended.
 * - Only one prescription is allowed per appointment.
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
    throw new ApiError(400, "A valid prescription body is required");
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

  if (
    !Array.isArray(input.items) ||
    input.items.length === 0
  ) {
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
    // Handle concurrent requests attempting to create a
    // prescription for the same appointment.
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
 * Both the assigned doctor and actual patient can use this
 * endpoint. Authorization is based on the authenticated user ID
 * and their relationship to the appointment.
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

  // Doctors may inspect the prescription regardless of its
  // status, but patients may only access issued prescriptions.
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