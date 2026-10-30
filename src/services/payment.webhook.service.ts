
import { Prisma } from "../generated/prisma/client.js";
import type { PaymentWebhookEventStatus } from "../generated/prisma/client.js";

import { prisma } from "./prisma.service.js";
import { ApiError } from "../utils/ApiError.js";
import {
  provisionConsultationSessionForPaidAppointment,
} from "./consultation.session.service.js";

export type PaymentWebhookPayload = {
  eventId: string;
  paymentId: string;
  referenceType: "TELECONSULTATION";
  referenceId: string;
  bookingId?: string;
  payerId: string;
  status: "PAID" | "FAILED";
  amount: number;
  currency: string;
  refundedAmount?: number;
  failureReason?: string | null;
  occurredAt: string;
};

function validatePaymentWebhookPayload(
  payload: unknown,
): PaymentWebhookPayload {
  if (!payload || typeof payload !== "object") {
    throw new ApiError(400, "Invalid payment webhook payload");
  }

  const data = payload as Record<string, unknown>;

  if (
    typeof data.eventId !== "string" ||
    !data.eventId.trim() ||
    typeof data.paymentId !== "string" ||
    !data.paymentId.trim() ||
    data.referenceType !== "TELECONSULTATION" ||
    typeof data.referenceId !== "string" ||
    !data.referenceId.trim() ||
    (data.bookingId !== undefined &&
      (typeof data.bookingId !== "string" ||
        !data.bookingId.trim() ||
        data.bookingId !== data.referenceId)) ||
    typeof data.payerId !== "string" ||
    !data.payerId.trim() ||
    !["PAID", "FAILED"].includes(String(data.status)) ||
    typeof data.amount !== "number" ||
    !Number.isFinite(data.amount) ||
    data.amount < 0 ||
    typeof data.currency !== "string" ||
    !data.currency.trim() ||
    (data.refundedAmount !== undefined &&
      (typeof data.refundedAmount !== "number" ||
        !Number.isFinite(data.refundedAmount) ||
        data.refundedAmount < 0)) ||
    (data.failureReason !== undefined &&
      data.failureReason !== null &&
      typeof data.failureReason !== "string") ||
    typeof data.occurredAt !== "string" ||
    Number.isNaN(Date.parse(data.occurredAt))
  ) {
    throw new ApiError(400, "Invalid payment webhook payload fields");
  }

  return data as PaymentWebhookPayload;
}

function getExpectedAmountPaise(): number {
  const fee = process.env.TELECONSULTATION_FEE_INR?.trim();

  if (!fee) {
    throw new ApiError(
      500,
      "Teleconsultation fee is not configured",
    );
  }

  const amount = Number(fee);

  if (
    !Number.isFinite(amount) ||
    amount < 1 ||
    Math.round(amount * 100) !== amount * 100
  ) {
    throw new ApiError(
      500,
      "Invalid teleconsultation fee configuration",
    );
  }

  return Math.round(amount * 100);
}

function toPaise(amount: number): number {
  return Math.round(amount * 100);
}

export async function processPaymentWebhook(input: unknown) {
  const payload = validatePaymentWebhookPayload(input);
  const appointmentId = payload.referenceId;

  // 1. Verify appointment exists.
  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
    select: {
      appointmentId: true,
      bookedByUserId: true,
      status: true,
    },
  });

  if (!appointment) {
    throw new ApiError(404, "Referenced appointment was not found");
  }

  // 2. Verify payer.
  if (payload.payerId !== appointment.bookedByUserId) {
    throw new ApiError(
      403,
      "Payment payer does not match appointment booker",
    );
  }

  // 3. Verify currency.
  if (payload.currency.toUpperCase() !== "INR") {
    throw new ApiError(400, "Payment currency must be INR");
  }

  // 4. Verify successful payment amount.
  if (
    payload.status === "PAID" &&
    toPaise(payload.amount) !== getExpectedAmountPaise()
  ) {
    throw new ApiError(
      400,
      "Payment amount does not match consultation fee",
    );
  }

  // 5. Check whether this event was already received.
  const existingEvent = await prisma.paymentWebhookEvent.findUnique({
    where: { eventId: payload.eventId },
  });

  if (existingEvent) {
    if (
      existingEvent.paymentId !== payload.paymentId ||
      existingEvent.appointmentId !== appointmentId ||
      existingEvent.paymentStatus !== payload.status
    ) {
      throw new ApiError(
        409,
        "Payment event ID was reused with different event data",
      );
    }

    if (existingEvent.status === "PROCESSED") {
      return {
        duplicate: true,
        eventId: payload.eventId,
        status: existingEvent.status,
      };
    }
  }

  // 6. Create the event if it does not exist.
  await prisma.paymentWebhookEvent.upsert({
    where: { eventId: payload.eventId },
    create: {
      eventId: payload.eventId,
      paymentId: payload.paymentId,
      appointmentId,
      paymentStatus: payload.status,
      status: "RECEIVED",
      payload: payload as unknown as Prisma.InputJsonValue,
      attempts: 0,
    },
    update: {},
  });

  // 7. Atomically claim the event.
  // Only RECEIVED or FAILED events can be processed.
  const claim = await prisma.paymentWebhookEvent.updateMany({
    where: {
      eventId: payload.eventId,
      status: {
        in: ["RECEIVED", "FAILED"],
      },
    },
    data: {
      status: "PROCESSING",
      attempts: {
        increment: 1,
      },
      lastError: null,
    },
  });

  if (claim.count === 0) {
    const latestEvent = await prisma.paymentWebhookEvent.findUnique({
      where: { eventId: payload.eventId },
    });

    if (latestEvent?.status === "PROCESSED") {
      return {
        duplicate: true,
        eventId: payload.eventId,
        status: latestEvent.status,
      };
    }

    throw new ApiError(
      503,
      "Payment event is already being processed",
    );
  }

  try {
    // 8. Handle successful payment.
    if (payload.status === "PAID") {
      const currentAppointment = await prisma.appointment.findUnique({
        where: { appointmentId },
        select: {
          appointmentId: true,
          status: true,
        },
      });

      if (!currentAppointment) {
        throw new ApiError(
          404,
          "Referenced appointment was not found",
        );
      }

      // Appointment must already be confirmed by the doctor.
      if (currentAppointment.status !== "CONFIRMED") {
        throw new ApiError(
          409,
          `Payment cannot be processed for appointment with status ${currentAppointment.status}`,
        );
      }

      // 9. Provision 100ms consultation session.
      // This function must remain idempotent.
      const session =
        await provisionConsultationSessionForPaidAppointment(
          appointmentId,
        );

      console.log(
        "[PAYMENT WEBHOOK] Consultation session provisioned",
        {
          appointmentId,
          sessionId: session.sessionId,
          meetingRoomId: session.meetingRoomId,
        },
      );
    }

    // 10. FAILED payment events are recorded.
    // They do not cancel the appointment.
    // A later successful payment can still be processed.

    await prisma.paymentWebhookEvent.update({
      where: { eventId: payload.eventId },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
        lastError: null,
      },
    });

    console.log("[PAYMENT WEBHOOK] Event processed successfully", {
      eventId: payload.eventId,
      paymentId: payload.paymentId,
      appointmentId,
      paymentStatus: payload.status,
    });

    return {
      duplicate: false,
      eventId: payload.eventId,
      status: "PROCESSED",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown payment webhook processing error";

    await prisma.paymentWebhookEvent.update({
      where: { eventId: payload.eventId },
      data: {
        status: "FAILED",
        lastError: errorMessage,
      },
    });

    console.error("[PAYMENT WEBHOOK] Processing failed", {
      eventId: payload.eventId,
      appointmentId,
      error: errorMessage,
    });

    throw error;
  }
}
