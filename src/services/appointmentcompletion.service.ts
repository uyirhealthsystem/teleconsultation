import {
  AppointmentStatus,
  ConsultationNoteStatus,
  PrescriptionDecision,
  PrescriptionStatus,
  SessionStatus,
  PaymentStatus,
} from "../generated/prisma/client.js";

import { prisma } from "./prisma.service.js";
import { ApiError } from "../utils/ApiError.js";

export type CompletionActor = {
  userId: string;
  role: string;
};

export async function completeAppointment(
  appointmentId: string,
  actor: CompletionActor,
) {
  if (!actor.userId || actor.role?.trim().toUpperCase() !== "DOCTOR") {
    throw new ApiError(403, "Only a doctor can complete an appointment");
  }

  const paymentRequired =
    process.env.PAYMENT_REQUIRED_FOR_COMPLETION === "true";

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { appointmentId },
    });

    if (!appointment) {
      throw new ApiError(404, "Appointment not found");
    }

    if (appointment.doctorId !== actor.userId) {
      throw new ApiError(
        403,
        "Only the assigned doctor can complete this appointment",
      );
    }

    if (appointment.status === AppointmentStatus.COMPLETED) {
      return appointment;
    }

    if (
      appointment.status !== AppointmentStatus.CONFIRMED &&
      appointment.status !== AppointmentStatus.IN_PROGRESS
    ) {
      throw new ApiError(
        409,
        "Only confirmed or in-progress appointments can be completed",
      );
    }

    const session = await tx.consultationSession.findUnique({
      where: { appointmentId },
    });

    if (!session || session.status !== SessionStatus.ENDED) {
      throw new ApiError(
        409,
        "End the consultation session before completing the appointment",
      );
    }

    const note = await tx.consultationNote.findUnique({
      where: { appointmentId },
    });

    if (!note || note.status !== ConsultationNoteStatus.FINALIZED) {
      throw new ApiError(
        409,
        "Finalize the consultation note before completing the appointment",
      );
    }

    if (
      appointment.prescriptionDecision === PrescriptionDecision.PENDING
    ) {
      throw new ApiError(
        409,
        "Record the prescription decision before completing the appointment",
      );
    }

    const prescription = await tx.prescription.findUnique({
      where: { appointmentId },
    });

    if (
      appointment.prescriptionDecision === PrescriptionDecision.PRESCRIBED &&
      (!prescription || prescription.status !== PrescriptionStatus.ISSUED)
    ) {
      throw new ApiError(
        409,
        "An issued prescription is required to complete this appointment",
      );
    }

    if (
      appointment.prescriptionDecision === PrescriptionDecision.NOT_REQUIRED &&
      prescription
    ) {
      throw new ApiError(
        409,
        "Prescription exists but the decision is NOT_REQUIRED",
      );
    }

    if (paymentRequired) {
      const paidPayment = await tx.payment.findFirst({
        where: {
          appointmentId,
          status: PaymentStatus.PAID,
        },
      });

      if (!paidPayment) {
        throw new ApiError(
          409,
          "Successful payment is required before completing this appointment",
        );
      }
    }

    const result = await tx.appointment.updateMany({
      where: {
        appointmentId,
        doctorId: actor.userId,
        status: appointment.status,
      },
      data: {
        status: AppointmentStatus.COMPLETED,
      },
    });

    if (result.count === 0) {
      throw new ApiError(
        409,
        "Appointment status changed. Refresh and try again",
      );
    }

    return tx.appointment.findUniqueOrThrow({
      where: { appointmentId },
    });
  });
}