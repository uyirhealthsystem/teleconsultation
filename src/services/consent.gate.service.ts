
import { ConsentType } from "../generated/prisma/client.js";

import { prisma } from "./prisma.service.js";
import { assertAppointmentHasSignedConsent } from "./consent.service.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Check whether an appointment is ready for consultation.
 *
 * Adult:
 * No guardian consent required.
 *
 * Minor:
 * Existing signed guardian consent is mandatory.
 *
 * Patient age is read from the appointment database record.
 */
export async function assertAppointmentConsentReady(
  appointmentId: string,
) {
  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
  });

  if (!appointment) {
    throw new ApiError(404, "Appointment not found");
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

  const patientAge = appointment.patientAgeAtBooking;

  if (patientAge === null || patientAge === undefined) {
    throw new ApiError(
      409,
      "Patient age was not recorded for this appointment",
    );
  }

  if (
    !Number.isInteger(patientAge) ||
    patientAge < 0 ||
    patientAge > 130
  ) {
    throw new ApiError(
      409,
      "Invalid patient age stored on appointment",
    );
  }

  const expectedCategory = patientAge >= 18 ? "ADULT" : "MINOR";

  if (appointment.patientCategory !== expectedCategory) {
    throw new ApiError(
      409,
      "Patient category does not match the age recorded for this appointment",
    );
  }

  await assertAppointmentHasSignedConsent(
    appointmentId,
    ConsentType.MINOR_GUARDIAN,
  );

  return appointment;
}
