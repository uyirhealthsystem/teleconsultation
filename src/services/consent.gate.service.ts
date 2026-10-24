
import {ConsentStatus,ConsentType} from "../generated/prisma/client.js";
import { prisma } from "./prisma.service.js";

import { ApiError } from "../utils/ApiError.js";

export async function assertAppointmentConsentReady(
  appointmentId: string,
) {
  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
    include: {
      consents: {
        where: {
          status: ConsentStatus.SIGNED,
          revokedAt: null,
          signedAt: { not: null },
        },
      },
    },
  });

  if (!appointment) {
    const error = new Error("Appointment not found") as Error & {
      statusCode: number;
    };
    error.statusCode = 404;
    throw error;
  }

  if (
    appointment.status === "CANCELLED" ||
    appointment.status === "COMPLETED"
  ) {
    throw new ApiError(
        400,
      "This appointment cannot be joined",
    );
  }

  const consents = appointment.consents;

  // Every appointment requires teleconsultation consent.
  const hasTeleconsultationConsent = consents.some(
    (consent) =>
      consent.consentType === ConsentType.TELECONSULTATION &&
      (
        consent.signerUserId === appointment.patientId ||
        consent.signerUserId === appointment.bookedByUserId
      ),
  );

  if (!hasTeleconsultationConsent) {
    throw new ApiError(400,"Teleconsultation consent is required before joining"

    );
  }

  // When someone books for another person, require evidence that
  // the patient consented themselves or that a representative/guardian
  // consent record exists. Authority must be verified separately.
  
  if (appointment.patientId !== appointment.bookedByUserId) {
    const patientConsented = consents.some(
      (consent) =>
        consent.consentType === ConsentType.TELECONSULTATION &&
        consent.signerUserId === appointment.patientId,
    );

    const representativeConsentExists = consents.some(
      (consent) =>
        (
          consent.consentType === ConsentType.MINOR_GUARDIAN ||
          consent.consentType === ConsentType.REPRESENTATIVE
        ) &&
        consent.signerUserId === appointment.bookedByUserId,
    );

    if (!patientConsented && !representativeConsentExists) {
      throw new ApiError(400,"Patient consent or appropriate representative consent is required");
    }
  }

  return appointment;
}
