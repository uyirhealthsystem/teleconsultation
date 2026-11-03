
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
  finalize?: boolean;
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

function validatePatientAge(patientAge: number) {
  if (
    !Number.isInteger(patientAge) ||
    patientAge < 0 ||
    patientAge > 130
  ) {
    throw new ApiError(400, "Invalid patient age stored on appointment");
  }
}

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
    input.finalize !== undefined &&
    typeof input.finalize !== "boolean"
  ) {
    throw new ApiError(400, "finalize must be a boolean");
  }

  if (!NOTE_FIELDS.some((field) => input[field] !== undefined)) {
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
  if (input.clinicalNotes !== undefined) data.clinicalNotes = input.clinicalNotes;
  if (input.advice !== undefined) data.advice = input.advice;

  if (input.followUpAt !== undefined) {
    data.followUpAt =
      input.followUpAt === null ? null : new Date(input.followUpAt);
  }

  return data;
}

function validateFinalNote(input: ConsultationNoteInput) {
  if (!input.diagnosis?.trim()) {
    throw new ApiError(400, "Diagnosis is required before finalizing the note");
  }

  if (!input.clinicalNotes?.trim()) {
    throw new ApiError(400, "Clinical notes are required before finalizing the note");
  }
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

  const patientAge = appointment.patientAgeAtBooking;

  if (patientAge === null || patientAge === undefined) {
    throw new ApiError(
      409,
      "Patient age was not recorded for this appointment. Notes access is unavailable.",
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
      "You are not authorized to access this consultation note",
    );
  }

  return {
    appointment,
    isDoctor,
    isPatient,
    patientAge,
  };
}

async function assertNoteConsentReady(
  appointmentId: string,
  patientAge: number,
) {
  validatePatientAge(patientAge);

  if (patientAge >= 18) return;

  await assertAppointmentHasSignedConsent(
    appointmentId,
    ConsentType.MINOR_GUARDIAN,
    patientAge,
  );
}

async function getSessionForNote(
  appointmentId: string,
  patientAge: number,
  requireEnded = false,
) {
  await assertNoteConsentReady(appointmentId, patientAge);

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

  if (requireEnded && session.status !== SessionStatus.ENDED) {
    throw new ApiError(
      409,
      "End the consultation session before finalizing the note",
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

export async function createConsultationNote(
  appointmentId: string,
  actor: ConsultationNoteActor,
  input: ConsultationNoteInput,
) {
  const { appointment, isDoctor, patientAge } =
    await authorizeAppointment(appointmentId, actor);

  if (!isDoctor) {
    throw new ApiError(403, "Only the assigned doctor can create consultation notes");
  }

  validateNoteInput(input);

  const shouldFinalize = input.finalize === true;

  if (shouldFinalize) validateFinalNote(input);

  await getSessionForNote(appointmentId, patientAge, shouldFinalize);

  const existing = await prisma.consultationNote.findUnique({
    where: { appointmentId },
  });

  if (existing) {
    throw new ApiError(
      409,
      "A consultation note already exists for this appointment. Update the existing draft instead.",
    );
  }

  try {
    return await prisma.consultationNote.create({
      data: {
        appointmentId,
        doctorId: appointment.doctorId,
        status: shouldFinalize
          ? ConsultationNoteStatus.FINALIZED
          : ConsultationNoteStatus.DRAFT,
        ...(shouldFinalize ? { finalizedAt: new Date() } : {}),
        ...toNoteData(input),
      },
    });
  } catch (error) {
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

export async function getConsultationNote(
  appointmentId: string,
  actor: ConsultationNoteActor,
) {
  const { isDoctor, isPatient, patientAge } =
    await authorizeAppointment(appointmentId, actor);

  await assertNoteConsentReady(appointmentId, patientAge);

  const note = await prisma.consultationNote.findUnique({
    where: { appointmentId },
  });

  if (!note) {
    throw new ApiError(404, "Consultation note not found");
  }

  if (!isDoctor && isPatient) {
    if (note.status !== ConsultationNoteStatus.FINALIZED) {
      throw new ApiError(
        403,
        "The consultation note is not yet available to the patient",
      );
    }
  }

  return note;
}

export async function updateConsultationNote(
  appointmentId: string,
  noteId: string,
  actor: ConsultationNoteActor,
  input: ConsultationNoteInput,
) {
  const { appointment, isDoctor, patientAge } =
    await authorizeAppointment(appointmentId, actor);

  if (!isDoctor) {
    throw new ApiError(403, "Only the assigned doctor can update consultation notes");
  }

  validateNoteInput(input);

  if (input.finalize === true) validateFinalNote(input);

  await getSessionForNote(
    appointmentId,
    patientAge,
    input.finalize === true,
  );

  const note = await getNoteOrThrow(appointmentId, noteId);

  if (note.doctorId !== appointment.doctorId) {
    throw new ApiError(403, "You are not authorized to update this note");
  }

  if (note.status !== ConsultationNoteStatus.DRAFT) {
    throw new ApiError(409, "Finalized consultation notes cannot be edited");
  }

  const shouldFinalize = input.finalize === true;

  const result = await prisma.consultationNote.updateMany({
    where: {
      noteId,
      appointmentId,
      doctorId: actor.userId,
      status: ConsultationNoteStatus.DRAFT,
    },
    data: {
      ...toNoteData(input),
      ...(shouldFinalize
        ? {
            status: ConsultationNoteStatus.FINALIZED,
            finalizedAt: new Date(),
          }
        : {}),
    },
  });

  if (result.count === 0) {
    throw new ApiError(409, "The note changed or was finalized. Refresh and try again");
  }

  return getNoteOrThrow(appointmentId, noteId);
}

export async function finalizeConsultationNote(
  appointmentId: string,
  noteId: string,
  actor: ConsultationNoteActor,
) {
  const { appointment, isDoctor, patientAge } =
    await authorizeAppointment(appointmentId, actor);

  if (!isDoctor) {
    throw new ApiError(403, "Only the assigned doctor can finalize consultation notes");
  }

  await getSessionForNote(appointmentId, patientAge, true);

  const note = await getNoteOrThrow(appointmentId, noteId);

  if (note.doctorId !== appointment.doctorId) {
    throw new ApiError(403, "You are not authorized to finalize this note");
  }

  if (note.status === ConsultationNoteStatus.FINALIZED) return note;

  validateFinalNote({
    diagnosis: note.diagnosis,
    clinicalNotes: note.clinicalNotes,
  });

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

    if (latest.status === ConsultationNoteStatus.FINALIZED) return latest;

    throw new ApiError(
      409,
      "The note changed while finalizing. Refresh and try again",
    );
  }

  return getNoteOrThrow(appointmentId, noteId);
}
