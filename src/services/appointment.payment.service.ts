
import { AppointmentStatus } from "../generated/prisma/client.js";
import { ApiError } from "../utils/ApiError.js";
import { prisma } from "./prisma.service.js";
import { createTeleconsultationPaymentIntent } from "./payment.client.service.js";

export async function retryAppointmentPayment(
  appointmentId: string,
  userId: string,
  authorizationHeader?: string,
) {
  if (!appointmentId?.trim()) {
    throw new ApiError(400, "appointmentId is required");
  }

  if (!userId?.trim()) {
    throw new ApiError(401, "Authentication required");
  }

  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
    select: {
      appointmentId: true,
      bookedByUserId: true,
      status: true,
      scheduledAt: true,
    },
  });

  if (!appointment) {
    throw new ApiError(404, "Appointment not found");
  }

  // Only the citizen who booked the appointment can pay.
  if (appointment.bookedByUserId !== userId) {
    throw new ApiError(
      403,
      "You cannot make payment for this appointment",
    );
  }

  // Payment is allowed only after doctor confirmation.
  if (appointment.status !== AppointmentStatus.CONFIRMED) {
    throw new ApiError(
      409,
      "Payment is allowed only after the doctor confirms the appointment",
    );
  }

  if (appointment.scheduledAt <= new Date()) {
    throw new ApiError(
      409,
      "Appointment time has already passed",
    );
  }

  return createTeleconsultationPaymentIntent({
    appointmentId: appointment.appointmentId,
    payerId: appointment.bookedByUserId,
    authorizationHeader,
    description: "Uyir Health teleconsultation appointment",
  });
}
