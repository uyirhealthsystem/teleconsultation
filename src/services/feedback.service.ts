
import {
  FeedbackSubmittedRole,
  AppointmentStatus,
  Prisma,
} from "../generated/prisma/client.js";

import { ApiError } from "../utils/ApiError.js";
import { prisma } from "./prisma.service.js";

type Actor = {
  userId: string;
  role: string;
};

export type SubmitFeedbackInput = {
  overallRating?: number;
  communicationRating?: number;
  experienceRating?: number;
  cooperationRating?: number;
  comments?: string;
};

function validateActor(actor: Actor) {
  if (!actor.userId?.trim() || !actor.role?.trim()) {
    throw new ApiError(401, "Authentication required");
  }

  const role = actor.role.toUpperCase();

  if (!["CITIZEN", "PATIENT", "DOCTOR"].includes(role)) {
    throw new ApiError(403, "You are not allowed to submit feedback");
  }

  return role;
}

function getSubmittedRole(role: string): FeedbackSubmittedRole {
  return role === "DOCTOR"
    ? FeedbackSubmittedRole.DOCTOR
    : FeedbackSubmittedRole.PATIENT;
}

function validateRating(value: number | undefined, field: string) {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || value < 1 || value > 5)
  ) {
    throw new ApiError(400, `${field} must be an integer between 1 and 5`);
  }
}

function validateFeedbackInput(input: SubmitFeedbackInput) {
  validateRating(input.overallRating, "overallRating");
  validateRating(input.communicationRating, "communicationRating");
  validateRating(input.experienceRating, "experienceRating");
  validateRating(input.cooperationRating, "cooperationRating");

  if (
    input.comments !== undefined &&
    (typeof input.comments !== "string" || input.comments.length > 2000)
  ) {
    throw new ApiError(400, "Comments must be at most 2000 characters");
  }

  const hasRating =
    input.overallRating !== undefined ||
    input.communicationRating !== undefined ||
    input.experienceRating !== undefined ||
    input.cooperationRating !== undefined;

  const hasComments = Boolean(input.comments?.trim());

  if (!hasRating && !hasComments) {
    throw new ApiError(
      400,
      "Provide at least one rating or a comment",
    );
  }
}

async function getAuthorizedAppointment(
  appointmentId: string,
  actor: Actor,
) {
  const role = validateActor(actor);

  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
    select: {
      appointmentId: true,
      patientId: true,
      bookedByUserId: true,
      doctorId: true,
      status: true,
    },
  });

  if (!appointment) {
    throw new ApiError(404, "Appointment not found");
  }

  const isDoctor =
    role === "DOCTOR" && appointment.doctorId === actor.userId;

  const isPatientSide =
    ["CITIZEN", "PATIENT"].includes(role) &&
    (appointment.patientId === actor.userId ||
      appointment.bookedByUserId === actor.userId);

  if (!isDoctor && !isPatientSide) {
    throw new ApiError(
      403,
      "You are not authorized to access this appointment",
    );
  }

  return {
    appointment,
    submittedRole: getSubmittedRole(role),
  };
}

export async function submitFeedback(
  appointmentId: string,
  actor: Actor,
  input: SubmitFeedbackInput,
) {
  const { appointment, submittedRole } =
    await getAuthorizedAppointment(appointmentId, actor);

  if (appointment.status !== AppointmentStatus.COMPLETED) {
    throw new ApiError(
      400,
      "Feedback can only be submitted after appointment completion",
    );
  }

  validateFeedbackInput(input);

  try {
    return await prisma.consultationFeedback.create({
      data: {
        appointmentId,
        submittedBy: actor.userId,
        submittedRole,
        overallRating: input.overallRating,
        communicationRating: input.communicationRating,
        experienceRating: input.experienceRating,
        cooperationRating: input.cooperationRating,
        comments: input.comments?.trim() || null,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ApiError(
        409,
        "You have already submitted feedback for this appointment",
      );
    }

    throw error;
  }
}

export async function getAppointmentFeedback(
  appointmentId: string,
  actor: Actor,
) {
  const { appointment } = await getAuthorizedAppointment(
    appointmentId,
    actor,
  );

  return prisma.consultationFeedback.findMany({
    where: { appointmentId: appointment.appointmentId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getMyFeedback(
  actor: Actor,
  page = 1,
  limit = 20,
) {
  validateActor(actor);

  const skip = (page - 1) * limit;

  const [feedback, total] = await prisma.$transaction([
    prisma.consultationFeedback.findMany({
      where: { submittedBy: actor.userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.consultationFeedback.count({
      where: { submittedBy: actor.userId },
    }),
  ]);

  return {
    feedback,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
