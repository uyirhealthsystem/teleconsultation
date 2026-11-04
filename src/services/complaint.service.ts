
import {
  ComplaintCategory,
  ComplaintStatus,
} from "../generated/prisma/client.js";
import { ApiError } from "../utils/ApiError.js";
import { prisma } from "./prisma.service.js";

type ComplaintActor = {
  userId: string;
  role: string;
};

interface LodgeComplaintInput {
  appointmentId: string;
  category: ComplaintCategory;
  subject: string;
  description: string;
}

function normalizeRole(role: string): string {
  return role.trim().toUpperCase();
}

function validateActor(actor: ComplaintActor): void {
  if (!actor.userId?.trim()) {
    throw new ApiError(401, "Authentication required");
  }

  if (!["PATIENT", "CITIZEN"].includes(normalizeRole(actor.role))) {
    throw new ApiError(403, "Only patients or citizens can lodge complaints");
  }
}

function validateComplaintInput(input: LodgeComplaintInput): void {
  if (!input.appointmentId?.trim()) {
    throw new ApiError(400, "appointmentId is required");
  }

  if (!Object.values(ComplaintCategory).includes(input.category)) {
    throw new ApiError(400, "Invalid complaint category");
  }

  if (!input.subject?.trim() || input.subject.trim().length > 150) {
    throw new ApiError(400, "Subject is required (maximum 150 characters)");
  }

  if (
    !input.description?.trim() ||
    input.description.trim().length < 10 ||
    input.description.trim().length > 3000
  ) {
    throw new ApiError(400, "Description must contain 10 to 3000 characters");
  }
}

function canAccessComplaint(
  appointment: {
    patientId: string;
    bookedByUserId: string;
    doctorId: string;
  },
  actor: ComplaintActor,
): boolean {
  const role = normalizeRole(actor.role);

  if (role === "DOCTOR") {
    return appointment.doctorId === actor.userId;
  }

  if (role === "PATIENT" || role === "CITIZEN") {
    return appointment.patientId === actor.userId ||
      appointment.bookedByUserId === actor.userId;
  }

  return false;
}

export async function lodgeComplaint(
  actor: ComplaintActor,
  input: LodgeComplaintInput,
) {
  validateActor(actor);
  validateComplaintInput(input);

  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId: input.appointmentId },
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

  if (!canAccessComplaint(appointment, actor)) {
    throw new ApiError(403, "You are not authorized to complain about this appointment");
  }

  return prisma.consultationComplaint.create({
    data: {
      appointmentId: appointment.appointmentId,
      submittedBy: actor.userId,
      patientId: appointment.patientId,
      category: input.category,
      subject: input.subject.trim(),
      description: input.description.trim(),
    },
  });
}

export async function getMyComplaints(
  actor: ComplaintActor,
  page = 1,
  limit = 20,
) {
  if (!actor.userId?.trim()) {
    throw new ApiError(401, "Authentication required");
  }

  if (!Number.isInteger(page) || !Number.isInteger(limit) ||
      page < 1 || limit < 1 || limit > 100) {
    throw new ApiError(400, "Invalid page or limit");
  }

  const where = { submittedBy: actor.userId };

  const [complaints, total] = await Promise.all([
    prisma.consultationComplaint.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.consultationComplaint.count({ where }),
  ]);

  return {
    complaints,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getComplaintDetails(
  complaintId: string,
  actor: ComplaintActor,
) {
  if (!actor.userId?.trim()) {
    throw new ApiError(401, "Authentication required");
  }

  const complaint = await prisma.consultationComplaint.findUnique({
    where: { complaintId },
    include: {
      appointment: {
        select: {
          patientId: true,
          bookedByUserId: true,
          doctorId: true,
        },
      },
    },
  });

  if (!complaint || !canAccessComplaint(complaint.appointment, actor)) {
    throw new ApiError(404, "Complaint not found");
  }

  return complaint;
}

export async function cancelComplaint(
  complaintId: string,
  actor: ComplaintActor,
) {
  if (!actor.userId?.trim()) {
    throw new ApiError(401, "Authentication required");
  }

  const complaint = await prisma.consultationComplaint.findFirst({
    where: {
      complaintId,
      submittedBy: actor.userId,
    },
  });
  console.log("complllllllllll",complaint)

  if (!complaint) {
    throw new ApiError(404, "Complaint not found");
  }

  if (complaint.status !== ComplaintStatus.OPEN) {
    throw new ApiError(409, "Only open complaints can be cancelled");
  }

  const result = await prisma.consultationComplaint.updateMany({
    where: {
      complaintId,
      submittedBy: actor.userId,
      status: ComplaintStatus.OPEN,
      updatedAt: complaint.updatedAt,
    },
    data: {
      status: ComplaintStatus.CLOSED,
    },
  });

  if (result.count !== 1) {
    throw new ApiError(409, "Complaint was updated. Please refresh and try again");
  }

  return prisma.consultationComplaint.findUniqueOrThrow({
    where: { complaintId },
  });
}
