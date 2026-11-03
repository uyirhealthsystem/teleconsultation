
import {
  ConsentType,
  SessionStatus,
} from "../generated/prisma/client.js";

import { prisma } from "./prisma.service.js";
import { assertAppointmentHasSignedConsent } from "./consent.service.js";
import { ApiError } from "../utils/ApiError.js";
import { generateHmsAuthToken, hms } from "./hms.service.js";

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

/**
 * Authorizes an appointment actor and validates
 * guardian consent using the patient's stored age.
 */
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

  // Always retrieve patient age from the appointment.
  const patientAge = appointment.patientAgeAtBooking;

  if (
    patientAge === null ||
    patientAge === undefined ||
    !Number.isInteger(patientAge) ||
    patientAge < 0 ||
    patientAge > 130
  ) {
    throw new ApiError(
      400,
      "Valid patient age is not recorded for this appointment",
    );
  }

  // Verify that the stored category matches the recorded age.
  const expectedCategory =
    patientAge >= 18 ? "ADULT" : "MINOR";

  if (appointment.patientCategory !== expectedCategory) {
    throw new ApiError(
      409,
      "Patient category does not match the recorded age",
    );
  }

  // Adults do not need guardian consent.
  // Minors require signed, non-revoked guardian consent.
  await assertAppointmentHasSignedConsent(
    appointmentId,
    ConsentType.MINOR_GUARDIAN,
    patientAge,
  );

  if (process.env.NODE_ENV !== "production") {
    console.log("[Session Authorization Debug]", {
      appointmentId,
      authenticatedUserId: actor.userId,
      authenticatedRole: role,
      patientAge,
      patientCategory: appointment.patientCategory,
      isDoctor,
    });
  }

  return {
    appointment,
    isDoctor,
    isPatient,
    isBooker,
    patientAge,
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
  const {
    isPatient,
    isBooker,
    appointment,
  } = await authorizeAppointment(appointmentId, actor);

  const canCheckIn =
    isPatient ||
    (
      isBooker &&
      appointment.bookingFor === "FAMILY_MEMBER"
    );

  if (!canCheckIn) {
    throw new ApiError(
      403,
      "Only the patient or authorized family booker can check in",
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

/**
 * Creates the 100ms room and persists its room ID.
 * Called after the appointment becomes eligible for provisioning.
 */
export async function provisionConsultationSessionForPaidAppointment(
  appointmentId: string,
) {
  const templateId = process.env.HMS_TEMPLATE_ID;

  if (!templateId) {
    throw new ApiError(
      500,
      "100ms template ID is not configured",
    );
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${appointmentId})::bigint
          )
        `;

        const appointment = await tx.appointment.findUnique({
          where: { appointmentId },
        });

        if (!appointment) {
          throw new ApiError(404, "Appointment not found");
        }

        if (
          !ELIGIBLE_APPOINTMENT_STATUSES.includes(
            String(appointment.status),
          )
        ) {
          throw new ApiError(
            409,
            "Appointment is not eligible for a consultation session",
          );
        }

        const existing =
          await tx.consultationSession.findUnique({
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

        const room = await hms.rooms.create({
          name: `uyir-consultation-${appointmentId}`,
          description: `Uyir Health consultation ${appointmentId}`,
          template_id: templateId,
          region: "in",
        });

        return await tx.consultationSession.create({
          data: {
            appointmentId,
            meetingRoomId: room.id,
            status: SessionStatus.WAITING,
            scheduledStartAt: appointment.scheduledAt,
          },
        });
      },
      {
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  } catch (error) {
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

    throw error;
  }
}

/**
 * Generates a 100ms join token for the authorized appointment user.
 */
export async function generateConsultationJoinToken(
  appointmentId: string,
  actor: SessionActor,
) {
  const {
    isDoctor,
    isPatient,
    isBooker,
  } = await authorizeAppointment(appointmentId, actor);

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
    session.status === SessionStatus.ENDED ||
    session.status === SessionStatus.FAILED
  ) {
    throw new ApiError(
      409,
      "This consultation session is already closed",
    );
  }

  if (!isDoctor && !isPatient && !isBooker) {
    throw new ApiError(
      403,
      "You are not authorized to join this consultation",
    );
  }

  if (!isDoctor && !session.waitingStartedAt) {
    throw new ApiError(
      409,
      "Patient must check in before joining the consultation",
    );
  }

  const role = isDoctor ? "host" : "guest";

  const token = await generateHmsAuthToken(
    session.meetingRoomId,
    actor.userId,
    role,
  );

  return {
    token,
    roomId: session.meetingRoomId,
    role,
  };
}
