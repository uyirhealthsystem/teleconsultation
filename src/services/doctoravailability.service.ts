
import { prisma } from "./prisma.service.js";
import { ApiError } from "../utils/ApiError.js";

interface CreateAvailabilityInput {
  doctorId: string;
  hospitalId?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes?: number;
}

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateAvailability(input: CreateAvailabilityInput) {
  const {
    dayOfWeek,
    startTime,
    endTime,
    slotDurationMinutes = 30,
  } = input;

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new ApiError(400, "dayOfWeek must be between 0 and 6");
  }

  if (!timePattern.test(startTime) || !timePattern.test(endTime)) {
    throw new ApiError(400, "Times must use HH:mm format");
  }

  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };

  if (toMinutes(endTime) <= toMinutes(startTime)) {
    throw new ApiError(400, "endTime must be after startTime");
  }

  if (
    !Number.isInteger(slotDurationMinutes) ||
    slotDurationMinutes < 10 ||
    slotDurationMinutes > 120
  ) {
    throw new ApiError(
      400,
      "slotDurationMinutes must be between 10 and 120",
    );
  }
}

export async function createDoctorAvailability(
  input: CreateAvailabilityInput,
) {
  if (!input.doctorId?.trim()) {
    throw new ApiError(400, "doctorId is required");
  }

  validateAvailability(input);

  const start = input.startTime.split(":").map(Number);
  const end = input.endTime.split(":").map(Number);
  const startMinutes = start[0] * 60 + start[1];
  const endMinutes = end[0] * 60 + end[1];
  const duration = input.slotDurationMinutes ?? 30;

  if ((endMinutes - startMinutes) < duration) {
    throw new ApiError(
      400,
      "Availability window must fit at least one appointment slot",
    );
  }

  return prisma.doctorAvailability.create({
    data: {
      doctorId: input.doctorId,
      hospitalId: input.hospitalId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      slotDurationMinutes: duration,
    },
  });
}

export async function getDoctorAvailability(doctorId: string) {
  return prisma.doctorAvailability.findMany({
    where: { doctorId },
    orderBy: [
      { dayOfWeek: "asc" },
      { startTime: "asc" },
    ],
  });
}

export async function updateDoctorAvailability(
  availabilityId: string,
  input: Partial<CreateAvailabilityInput>,
) {
  const existing = await prisma.doctorAvailability.findUnique({
    where: { availabilityId },
  });

  if (!existing) {
    throw new ApiError(404, "Doctor availability not found");
  }

  const merged: CreateAvailabilityInput = {
    doctorId: input.doctorId ?? existing.doctorId,
    hospitalId: input.hospitalId ?? existing.hospitalId ?? undefined,
    dayOfWeek: input.dayOfWeek ?? existing.dayOfWeek,
    startTime: input.startTime ?? existing.startTime,
    endTime: input.endTime ?? existing.endTime,
    slotDurationMinutes:
      input.slotDurationMinutes ?? existing.slotDurationMinutes,
  };

  validateAvailability(merged);

  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };

  if (
    toMinutes(merged.endTime) - toMinutes(merged.startTime) <
    merged.slotDurationMinutes!
  ) {
    throw new ApiError(
      400,
      "Availability window must fit at least one appointment slot",
    );
  }

  return prisma.doctorAvailability.update({
    where: { availabilityId },
    data: {
      doctorId: merged.doctorId,
      hospitalId: merged.hospitalId,
      dayOfWeek: merged.dayOfWeek,
      startTime: merged.startTime,
      endTime: merged.endTime,
      slotDurationMinutes: merged.slotDurationMinutes,
    },
  });
}

export async function updateDoctorAvailabilityStatus(
  availabilityId: string,
  isActive: boolean,
) {
  const existing = await prisma.doctorAvailability.findUnique({
    where: { availabilityId },
  });

  if (!existing) {
    throw new ApiError(404, "Doctor availability not found");
  }

  return prisma.doctorAvailability.update({
    where: { availabilityId },
    data: { isActive },
  });
}
