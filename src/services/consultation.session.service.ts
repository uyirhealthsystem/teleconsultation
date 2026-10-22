
import {
  ConsentType,
  SessionStatus,
} from "../generated/prisma/client.js";

import { prisma } from "./prisma.service.js";
import { assertAppointmentHasSignedConsent } from "./consent.service.js";
import { ApiError } from "../utils/ApiError.js";

const ELIGIBLE_APPOINTMENT_STATUSES = [
  "CONFIRMED",
  "IN_PROGRESS",
];

const PATIENT_ROLES = new Set([
  "PATIENT",
  "CITIZEN",
  "USER",
  "CITIZEN_USER",
]);

export type SessionActor = {
  userId: string;
  role: string;
};

async function authorizeAppointment(
  appointmentId: string,
  actor: SessionActor,
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
    appointment.doctorId === actor.userId &&
    role === "DOCTOR";

  const isPatient =
    appointment.patientId === actor.userId &&
    PATIENT_ROLES.has(role);

  const isBooker =
    appointment.bookedByUserId === actor.userId &&
    PATIENT_ROLES.has(role);

  if (!isDoctor && !isPatient && !isBooker) {
    throw new ApiError(
      403,
      "You are not authorized for this appointment",
    );
  }

  if (
    !ELIGIBLE_APPOINTMENT_STATUSES.includes(
      String(appointment.status),
    )
  ) {
    throw new ApiError(
      409,
      "This appointment is not eligible for a consultation session",
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

async function getSessionOrThrow(sessionId: string) {
  const session = await prisma.consultationSession.findUnique({
    where: { sessionId },
  });

  if (!session) {
    throw new ApiError(404, "Consultation session not found");
  }

  return session;
}

/**
 * Creates one session per appointment.
 * Temporary placeholder until real 100ms room creation is integrated.
 */
export async function createOrGetConsultationSession(
  appointmentId: string,
  actor: SessionActor,
) {
  const { appointment } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  const existing = await prisma.consultationSession.findUnique({
    where: { appointmentId },
  });

  if (existing) {
    if (
      existing.status === SessionStatus.ENDED ||
      existing.status === SessionStatus.FAILED
    ) {
      throw new ApiError(
        409,
        "This consultation session is already closed",
      );
    }

    return existing;
  }

  // Temporary only: replace with the actual 100ms room ID.
  const meetingRoomId = `pending-${appointmentId}`;

  try {
    return await prisma.consultationSession.create({
      data: {
        appointmentId,
        meetingRoomId,
        status: SessionStatus.WAITING,
        scheduledStartAt: appointment.scheduledAt,
      },
    });
  } catch (error) {
    // Another request may have created the unique appointment session.
    const session = await prisma.consultationSession.findUnique({
      where: { appointmentId },
    });

    if (session) {
      if (
        session.status === SessionStatus.ENDED ||
        session.status === SessionStatus.FAILED
      ) {
        throw new ApiError(
          409,
          "This consultation session is already closed",
        );
      }

      return session;
    }

    throw error;
  }
}

/**
 * Retrieves the session for an appointment.
 */
export async function getConsultationSession(
  appointmentId: string,
  actor: SessionActor,
) {
  await authorizeAppointment(appointmentId, actor);

  const session = await prisma.consultationSession.findUnique({
    where: { appointmentId },
  });

  if (!session) {
    throw new ApiError(
      404,
      "Consultation session has not been created",
    );
  }

  return session;
}

/**
 * Patient check-in.
 *
 * WAITING -> WAITING_FOR_DOCTOR
 * DOCTOR_DELAYED remains DOCTOR_DELAYED when the patient checks in.
 */
export async function checkInPatient(
  appointmentId: string,
  actor: SessionActor,
) {
  const { isPatient } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isPatient) {
    throw new ApiError(
      403,
      "Only the patient can check in",
    );
  }

  const session = await prisma.consultationSession.findUnique({
    where: { appointmentId },
  });

  if (!session) {
    throw new ApiError(
      404,
      "Consultation session has not been created",
    );
  }

  if (
    session.status !== SessionStatus.WAITING &&
    session.status !== SessionStatus.DOCTOR_DELAYED &&
    session.status !== SessionStatus.WAITING_FOR_DOCTOR
  ) {
    throw new ApiError(
      409,
      "Patient check-in is not allowed in the current session status",
    );
  }

  // Repeated check-in is safe and idempotent.
  if (session.waitingStartedAt) {
    return session;
  }

  const nextStatus =
    session.status === SessionStatus.WAITING
      ? SessionStatus.WAITING_FOR_DOCTOR
      : session.status;

  const result = await prisma.consultationSession.updateMany({
    where: {
      sessionId: session.sessionId,
      status: session.status,
      waitingStartedAt: null,
    },
    data: {
      status: nextStatus,
      waitingStartedAt: new Date(),
    },
  });

  if (result.count === 0) {
    const latest = await getSessionOrThrow(session.sessionId);

    if (latest.waitingStartedAt) {
      return latest;
    }

    throw new ApiError(
      409,
      "Session changed while the patient was checking in. Please retry",
    );
  }

  return getSessionOrThrow(session.sessionId);
}

/**
 * Doctor marks that they are delayed.
 */
export async function markDoctorDelayed(
  appointmentId: string,
  actor: SessionActor,
) {
  const { isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can mark a delay",
    );
  }

  const session = await prisma.consultationSession.findUnique({
    where: { appointmentId },
  });

  if (!session) {
    throw new ApiError(
      404,
      "Consultation session has not been created",
    );
  }

  if (session.status === SessionStatus.DOCTOR_DELAYED) {
    return session;
  }

  if (
    session.status !== SessionStatus.WAITING &&
    session.status !== SessionStatus.WAITING_FOR_DOCTOR
  ) {
    throw new ApiError(
      409,
      "Doctor delay cannot be marked in the current session status",
    );
  }

  const result = await prisma.consultationSession.updateMany({
    where: {
      sessionId: session.sessionId,
      status: session.status,
    },
    data: {
      status: SessionStatus.DOCTOR_DELAYED,
      delayNotifiedAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new ApiError(
      409,
      "Session changed while marking the delay. Please retry",
    );
  }

  return getSessionOrThrow(session.sessionId);
}

/**
 * Doctor starts the consultation only after patient check-in
 * and the scheduled appointment time.
 */
export async function startConsultation(
  appointmentId: string,
  actor: SessionActor,
) {
  const { isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can start the consultation",
    );
  }

  const session = await prisma.consultationSession.findUnique({
    where: { appointmentId },
  });

  if (!session) {
    throw new ApiError(
      404,
      "Consultation session has not been created",
    );
  }

  if (!session.scheduledStartAt) {
    throw new ApiError(
      500,
      "Scheduled appointment time is missing from the session",
    );
  }

  if (new Date() < session.scheduledStartAt) {
    throw new ApiError(
      409,
      "Consultation cannot start before the scheduled appointment time",
    );
  }

  if (!session.waitingStartedAt) {
    throw new ApiError(
      409,
      "The patient must check in before the consultation starts",
    );
  }

  if (
    session.status !== SessionStatus.WAITING_FOR_DOCTOR &&
    session.status !== SessionStatus.DOCTOR_DELAYED
  ) {
    throw new ApiError(
      409,
      "Consultation cannot start in the current session status",
    );
  }

  const startedAt = new Date();

  const result = await prisma.consultationSession.updateMany({
    where: {
      sessionId: session.sessionId,
      status: session.status,
      waitingStartedAt: { not: null },
      scheduledStartAt: { lte: startedAt },
    },
    data: {
      status: SessionStatus.ACTIVE,
      startedAt,
    },
  });

  if (result.count === 0) {
    throw new ApiError(
      409,
      "Session changed while starting the consultation. Please retry",
    );
  }

  return getSessionOrThrow(session.sessionId);
}

/**
 * Doctor ends an active consultation.
 */
export async function endConsultation(
  appointmentId: string,
  actor: SessionActor,
) {
  const { isDoctor } = await authorizeAppointment(
    appointmentId,
    actor,
  );

  if (!isDoctor) {
    throw new ApiError(
      403,
      "Only the assigned doctor can end the consultation",
    );
  }

  const session = await prisma.consultationSession.findUnique({
    where: { appointmentId },
  });

  if (!session) {
    throw new ApiError(
      404,
      "Consultation session has not been created",
    );
  }

  if (session.status !== SessionStatus.ACTIVE) {
    throw new ApiError(
      409,
      "Only an active consultation can be ended",
    );
  }

  const endedAt = new Date();

  const result = await prisma.consultationSession.updateMany({
    where: {
      sessionId: session.sessionId,
      status: SessionStatus.ACTIVE,
    },
    data: {
      status: SessionStatus.ENDED,
      endedAt,
    },
  });

  if (result.count === 0) {
    throw new ApiError(
      409,
      "Session changed while ending the consultation. Please retry",
    );
  }

  return getSessionOrThrow(session.sessionId);
}
