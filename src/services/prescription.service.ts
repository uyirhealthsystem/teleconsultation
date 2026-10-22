
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

type PrescriptionDraftInput = {
  instructions?: string | null;
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

const PATIENT_ROLES = new Set([
  "PATIENT",
  "CITIZEN",
  "USER",
  "CITIZEN_USER",
]);

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

  const isBooker =
    PATIENT_ROLES.has(role) &&
    appointment.bookedByUserId === actor.userId;

  if (!isDoctor && !isPatient && !isBooker) {
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
    isBooker,
  };
}

async function assertPrescriptionSessionExists(
  appointmentId: string,
) {
  const session = await prisma.consultationSession.findUnique({
    where: { appointmentId },
  });

  if (!session) {
    throw new ApiError(
      409,
      "A consultation session must exist first",
    );
  }

  if (
    session.status !== SessionStatus.ACTIVE &&
    session.status !== SessionStatus.ENDED
  ) {
    throw new ApiError(
      409,
      "A prescription can only be drafted during or after an active consultation",
    );
  }

  return session;
}

async function getPrescriptionOrThrow(
  appointmentId: string,
) {
  const prescription = await prisma.prescription.findUnique({
    where: { appointmentId },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!prescription) {
    throw new ApiError(404, "Prescription not found");
  }

  return prescription;
}

function validateInstructions(
  input: PrescriptionDraftInput,
) {
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

  if (input.instructions === undefined) {
    throw new ApiError(
      400,
      "Provide prescription instructions",
    );
  }
}

function validateItemInput(
  input: PrescriptionItemInput,
  isCreate: boolean,
) {
  if (isCreate && !input.medicineName?.trim()) {
    throw new ApiError(400, "medicineName is required");
  }

  if (
    input.medicineName !== undefined &&
    (typeof input.medicineName !== "string" ||
      !input.medicineName.trim())
  ) {
    throw new ApiError(
      400,
      "medicineName must be a non-empty string",
    );
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

  if (
    !isCreate &&
    ![
      "medicineName",
      "dosage",
      "frequency",
      "duration",
      "quantity",
      "instructions",
      "sortOrder",
    ].some((field) => input[field as keyof PrescriptionItemInput] !== undefined)
  ) {
    throw new ApiError(
      400,
      "Provide at least one medicine field to update",
    );
  }
}

/**
 * Create a prescription draft.
 */
export async function createPrescription(
  appointmentId: string,
  actor: PrescriptionActor,
  input: PrescriptionDraftInput,
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

  if (input.instructions !== undefined) {
    validateInstructions(input);
  }

  await assertPrescriptionSessionExists(appointmentId);

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
        status: PrescriptionStatus.DRAFT,
        instructions: input.instructions ?? null,
      },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
        },
      },
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
 * Retrieve a prescription.
 * Patients and bookers can only retrieve issued prescriptions.
 */
export async function getPrescription(
  appointmentId: string,
  actor: PrescriptionActor,
) {
  const { isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  const prescription = await getPrescriptionOrThrow(appointmentId);

//   if (
//     prescription.doctorId !== actor.userId &&
//     !isDoctor
//   ) {
//     throw new ApiError(
//       403,
//       "You are not authorized to access this prescription",
//     );
//   }

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

/**
 * Update draft-level instructions.
 */
export async function updatePrescription(
  appointmentId: string,
  actor: PrescriptionActor,
  input: PrescriptionDraftInput,
) {
  const { isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can update a prescription",
    );
  }

  validateInstructions(input);

  const prescription = await getPrescriptionOrThrow(appointmentId);

  if (prescription.status !== PrescriptionStatus.DRAFT) {
    throw new ApiError(
      409,
      "Only draft prescriptions can be updated",
    );
  }

  const result = await prisma.prescription.updateMany({
    where: {
      prescriptionId: prescription.prescriptionId,
      doctorId: actor.userId,
      status: PrescriptionStatus.DRAFT,
    },
    data: {
      instructions: input.instructions,
    },
  });

  if (result.count === 0) {
    throw new ApiError(
      409,
      "The prescription is no longer editable",
    );
  }

  return getPrescriptionOrThrow(appointmentId);
}

/**
 * Add a medicine item to a draft prescription.
 */
export async function addPrescriptionItem(
  appointmentId: string,
  actor: PrescriptionActor,
  input: PrescriptionItemInput,
) {
  const { isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can add medicines",
    );
  }

  validateItemInput(input, true);

  const prescription = await getPrescriptionOrThrow(appointmentId);

  if (prescription.status !== PrescriptionStatus.DRAFT) {
    throw new ApiError(
      409,
      "Medicines can only be added to a draft prescription",
    );
  }

  await prisma.prescriptionItem.create({
    data: {
      prescriptionId: prescription.prescriptionId,
      medicineName: input.medicineName!.trim(),
      dosage: input.dosage ?? null,
      frequency: input.frequency ?? null,
      duration: input.duration ?? null,
      quantity: input.quantity ?? null,
      instructions: input.instructions ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  });

  return getPrescriptionOrThrow(appointmentId);
}

/**
 * Update a medicine item on a draft prescription.
 */
export async function updatePrescriptionItem(
  appointmentId: string,
  itemId: string,
  actor: PrescriptionActor,
  input: PrescriptionItemInput,
) {
  const { isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can update medicines",
    );
  }

  validateItemInput(input, false);

  const prescription = await getPrescriptionOrThrow(appointmentId);

  if (prescription.status !== PrescriptionStatus.DRAFT) {
    throw new ApiError(
      409,
      "Medicines on an issued prescription cannot be edited",
    );
  }

  const item = prescription.items.find(
    (entry) => entry.prescriptionItemId === itemId,
  );

  if (!item) {
    throw new ApiError(404, "Prescription item not found");
  }

  const data: {
    medicineName?: string;
    dosage?: string | null;
    frequency?: string | null;
    duration?: string | null;
    quantity?: number | null;
    instructions?: string | null;
    sortOrder?: number;
  } = {};

  if (input.medicineName !== undefined) {
    data.medicineName = input.medicineName.trim();
  }
  if (input.dosage !== undefined) data.dosage = input.dosage;
  if (input.frequency !== undefined) data.frequency = input.frequency;
  if (input.duration !== undefined) data.duration = input.duration;
  if (input.quantity !== undefined) data.quantity = input.quantity;
  if (input.instructions !== undefined) {
    data.instructions = input.instructions;
  }
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

  const result = await prisma.prescriptionItem.updateMany({
    where: {
      prescriptionItemId: itemId,
      prescriptionId: prescription.prescriptionId,
      prescription: {
        is: {
          status: PrescriptionStatus.DRAFT,
          doctorId: actor.userId,
        },
      },
    },
    data,
  });

  if (result.count === 0) {
    throw new ApiError(
      409,
      "The prescription is no longer editable",
    );
  }

  return getPrescriptionOrThrow(appointmentId);
}

/**
 * Remove a medicine item from a draft prescription.
 */
export async function removePrescriptionItem(
  appointmentId: string,
  itemId: string,
  actor: PrescriptionActor,
) {
  const { isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can remove medicines",
    );
  }

  const prescription = await getPrescriptionOrThrow(appointmentId);

  if (prescription.status !== PrescriptionStatus.DRAFT) {
    throw new ApiError(
      409,
      "Medicines cannot be removed from an issued prescription",
    );
  }

  const result = await prisma.prescriptionItem.deleteMany({
    where: {
      prescriptionItemId: itemId,
      prescriptionId: prescription.prescriptionId,
      prescription: {
        is: {
          status: PrescriptionStatus.DRAFT,
          doctorId: actor.userId,
        },
      },
    },
  });

  if (result.count === 0) {
    throw new ApiError(404, "Prescription item not found");
  }

  return getPrescriptionOrThrow(appointmentId);
}

/**
 * Issue a draft prescription after the consultation has ended.
 */
export async function issuePrescription(
  appointmentId: string,
  actor: PrescriptionActor,
) {
  const { isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can issue a prescription",
    );
  }

  const session = await prisma.consultationSession.findUnique({
    where: { appointmentId },
  });

  if (!session || session.status !== SessionStatus.ENDED) {
    throw new ApiError(
      409,
      "The consultation session must end before issuing a prescription",
    );
  }

  const prescription = await getPrescriptionOrThrow(appointmentId);

  if (prescription.status === PrescriptionStatus.ISSUED) {
    return prescription;
  }

  if (prescription.status !== PrescriptionStatus.DRAFT) {
    throw new ApiError(
      409,
      "This prescription cannot be issued",
    );
  }

  if (prescription.items.length === 0) {
    throw new ApiError(
      400,
      "Add at least one medicine before issuing the prescription",
    );
  }

  const result = await prisma.prescription.updateMany({
    where: {
      prescriptionId: prescription.prescriptionId,
      appointmentId,
      doctorId: actor.userId,
      status: PrescriptionStatus.DRAFT,
    },
    data: {
      status: PrescriptionStatus.ISSUED,
      issuedAt: new Date(),
    },
  });

  if (result.count === 0) {
    const latest = await getPrescriptionOrThrow(appointmentId);

    if (latest.status === PrescriptionStatus.ISSUED) {
      return latest;
    }

    throw new ApiError(
      409,
      "The prescription changed while being issued. Please retry",
    );
  }

  return getPrescriptionOrThrow(appointmentId);
}
