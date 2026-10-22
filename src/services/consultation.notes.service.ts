
import {
  ConsentType,
  ConsultationNoteStatus,
  SessionStatus,
} from "../generated/prisma/client.js";

import { prisma } from "./prisma.service.js";
import { assertAppointmentHasSignedConsent } from "./consent.service.js";
import { ApiError } from "../utils/ApiError.js";

export type ConsultationNoteActor = {
  userId: string;
  role: string;
};

type ConsultationNoteInput = {
  symptoms?: string | null;
  diagnosis?: string | null;
  clinicalNotes?: string | null;
  advice?: string | null;
  followUpAt?: string | null;
};

const PATIENT_ROLES = new Set([
  "PATIENT",
  "CITIZEN",
  "USER",
  "CITIZEN_USER",
]);

const NOTE_FIELDS = [
  "symptoms",
  "diagnosis",
  "clinicalNotes",
  "advice",
  "followUpAt",
] as const;

function validateNoteInput(input: ConsultationNoteInput) {
  const values = [
    input.symptoms,
    input.diagnosis,
    input.clinicalNotes,
    input.advice,
  ];

  for (const value of values) {
    if (value !== undefined && value !== null && typeof value !== "string") {
      throw new ApiError(400, "Note fields must be strings or null");
    }
  }

  if (input.followUpAt !== undefined && input.followUpAt !== null) {
    if (typeof input.followUpAt !== "string") {
      throw new ApiError(400, "followUpAt must be a valid date string or null");
    }

    const date = new Date(input.followUpAt);

    if (Number.isNaN(date.getTime())) {
      throw new ApiError(400, "followUpAt must be a valid date");
    }
  }

  if (
    !NOTE_FIELDS.some((field) => input[field] !== undefined)
  ) {
    throw new ApiError(400, "Provide at least one consultation note field");
  }
}

function toNoteData(input: ConsultationNoteInput) {
  const data: {
    symptoms?: string | null;
    diagnosis?: string | null;
    clinicalNotes?: string | null;
    advice?: string | null;
    followUpAt?: Date | null;
  } = {};

  if (input.symptoms !== undefined) data.symptoms = input.symptoms;
  if (input.diagnosis !== undefined) data.diagnosis = input.diagnosis;
  if (input.clinicalNotes !== undefined) {
    data.clinicalNotes = input.clinicalNotes;
  }
  if (input.advice !== undefined) data.advice = input.advice;

  if (input.followUpAt !== undefined) {
    data.followUpAt =
      input.followUpAt === null
        ? null
        : new Date(input.followUpAt);
  }

  return data;
}

async function authorizeAppointment(
  appointmentId: string,
  actor: ConsultationNoteActor,
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
      "You are not authorized to access this consultation note",
    );
  }

  return {
    appointment,
    isDoctor,
    isPatient,
    isBooker,
  };
}

async function assertNoteWritingAllowed(
  appointmentId: string,
) {
  await assertAppointmentHasSignedConsent(
    appointmentId,
    ConsentType.TELECONSULTATION,
  );

  const session = await prisma.consultationSession.findUnique({
    where: { appointmentId },
  });

  if (!session) {
    throw new ApiError(
      409,
      "A consultation session must exist before documenting the consultation",
    );
  }

  if (
    session.status !== SessionStatus.ACTIVE &&
    session.status !== SessionStatus.ENDED
  ) {
    throw new ApiError(
      409,
      "Consultation notes can only be documented during or after an active consultation",
    );
  }

  return session;
}

async function getNoteOrThrow(
  appointmentId: string,
  noteId?: string,
) {
  const note = await prisma.consultationNote.findUnique({
    where: { appointmentId },
  });

  if (!note || (noteId && note.noteId !== noteId)) {
    throw new ApiError(404, "Consultation note not found");
  }

  return note;
}

/**
 * Create a draft note for an appointment.
 * Only the assigned doctor can create it.
 */
export async function createConsultationNote(
  appointmentId: string,
  actor: ConsultationNoteActor,
  input: ConsultationNoteInput,
) {
  const { appointment, isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can create consultation notes",
    );
  }

  validateNoteInput(input);
  await assertNoteWritingAllowed(appointmentId);

  const existing = await prisma.consultationNote.findUnique({
    where: { appointmentId },
  });

  if (existing) {
    throw new ApiError(
      409,
      "A consultation note already exists for this appointment",
    );
  }

  try {
    return await prisma.consultationNote.create({
      data: {
        appointmentId,
        doctorId: appointment.doctorId,
        status: ConsultationNoteStatus.DRAFT,
        ...toNoteData(input),
      },
    });
  } catch (error) {
    // Handle concurrent requests for the unique appointment note.
    const existingNote = await prisma.consultationNote.findUnique({
      where: { appointmentId },
    });

    if (existingNote) {
      throw new ApiError(
        409,
        "A consultation note already exists for this appointment",
      );
    }

    throw error;
  }
}

/**
 * Retrieve a consultation note.
 * Patients/bookers can see finalized notes only.
 */
export async function getConsultationNote(
  appointmentId: string,
  actor: ConsultationNoteActor,
) {
  const { isDoctor, isPatient, isBooker } =
    await authorizeAppointment(appointmentId, actor);

  const note = await prisma.consultationNote.findUnique({
    where: { appointmentId },
  });

  if (!note) {
    throw new ApiError(404, "Consultation note not found");
  }

  if (!isDoctor && (isPatient || isBooker)) {
    if (note.status !== ConsultationNoteStatus.FINALIZED) {
      throw new ApiError(
        403,
        "The consultation note is not yet available to the patient",
      );
    }
  }

  return note;
}

/**
 * Update a draft note.
 * Finalized notes cannot be edited.
 */
export async function updateConsultationNote(
  appointmentId: string,
  noteId: string,
  actor: ConsultationNoteActor,
  input: ConsultationNoteInput,
) {
  const { appointment, isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can update consultation notes",
    );
  }

  validateNoteInput(input);
  await assertNoteWritingAllowed(appointmentId);

  const note = await getNoteOrThrow(appointmentId, noteId);

  if (note.doctorId !== appointment.doctorId) {
    throw new ApiError(
      403,
      "You are not authorized to update this note",
    );
  }

  if (note.status !== ConsultationNoteStatus.DRAFT) {
    throw new ApiError(
      409,
      "Finalized consultation notes cannot be edited",
    );
  }

  const result = await prisma.consultationNote.updateMany({
    where: {
      noteId,
      appointmentId,
      doctorId: actor.userId,
      status: ConsultationNoteStatus.DRAFT,
    },
    data: toNoteData(input),
  });

  if (result.count === 0) {
    throw new ApiError(
      409,
      "The note changed or was finalized. Refresh and try again",
    );
  }

  return getNoteOrThrow(appointmentId, noteId);
}

/**
 * Finalize a draft note.
 * The consultation session must have ended.
 */
export async function finalizeConsultationNote(
  appointmentId: string,
  noteId: string,
  actor: ConsultationNoteActor,
) {
  const { appointment, isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can finalize consultation notes",
    );
  }

  await assertNoteWritingAllowed(appointmentId);

  const session = await prisma.consultationSession.findUnique({
    where: { appointmentId },
  });

  if (!session || session.status !== SessionStatus.ENDED) {
    throw new ApiError(
      409,
      "End the consultation session before finalizing the note",
    );
  }

  const note = await getNoteOrThrow(appointmentId, noteId);

  if (note.doctorId !== appointment.doctorId) {
    throw new ApiError(
      403,
      "You are not authorized to finalize this note",
    );
  }

  if (note.status === ConsultationNoteStatus.FINALIZED) {
    return note;
  }

  if (
    !note.diagnosis?.trim() ||
    !note.clinicalNotes?.trim()
  ) {
    throw new ApiError(
      400,
      "Diagnosis and clinical notes are required before finalization",
    );
  }

  const result = await prisma.consultationNote.updateMany({
    where: {
      noteId,
      appointmentId,
      doctorId: actor.userId,
      status: ConsultationNoteStatus.DRAFT,
    },
    data: {
      status: ConsultationNoteStatus.FINALIZED,
      finalizedAt: new Date(),
    },
  });

  if (result.count === 0) {
    const latest = await getNoteOrThrow(appointmentId, noteId);

    if (latest.status === ConsultationNoteStatus.FINALIZED) {
      return latest;
    }

    throw new ApiError(
      409,
      "The note changed while finalizing. Refresh and try again",
    );
  }

  return getNoteOrThrow(appointmentId, noteId);
}
