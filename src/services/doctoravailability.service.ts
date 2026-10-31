
import { prisma } from "./prisma.service.js";
import { ApiError } from "../utils/ApiError.js";

interface CreateAvailabilityInput {
  doctorId: string;
  hospitalId?: string;
  days?: number | number[];
  dayOfWeek?: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes?: number;
}

interface UpdateAvailabilityInput {
  doctorId?: string;
  hospitalId?: string;
  days?: number | number[];
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  slotDurationMinutes?: number;
}

interface AvailabilityValidationInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes?: number;
}

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateAvailability(input: AvailabilityValidationInput) {
  const {
    dayOfWeek,
    startTime,
    endTime,
    slotDurationMinutes = 30,
  } = input;

  if (
    !Number.isInteger(dayOfWeek) ||
    dayOfWeek < 0 ||
    dayOfWeek > 6
  ) {
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

// CREATE DOCTOR AVAILABILITY (SINGLE OR MULTIPLE DAYS)
export async function createDoctorAvailability(
  input: CreateAvailabilityInput,
) {
  if (!input.doctorId?.trim()) {
    throw new ApiError(400, "doctorId is required");
  }

  const days =
    input.days === undefined
      ? input.dayOfWeek !== undefined
        ? [input.dayOfWeek]
        : []
      : Array.isArray(input.days)
        ? input.days
        : [input.days];

  if (days.length === 0) {
    throw new ApiError(400, "At least one availability day is required");
  }

  if (
    days.some(
      (day) =>
        !Number.isInteger(day) ||
        day < 0 ||
        day > 6,
    )
  ) {
    throw new ApiError(
      400,
      "days must contain values between 0 and 6",
    );
  }

  if (new Set(days).size !== days.length) {
    throw new ApiError(400, "Duplicate days are not allowed");
  }

  const duration = input.slotDurationMinutes ?? 30;

  validateAvailability({
    dayOfWeek: days[0],
    startTime: input.startTime,
    endTime: input.endTime,
    slotDurationMinutes: duration,
  });

  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };

  const startMinutes = toMinutes(input.startTime);
  const endMinutes = toMinutes(input.endTime);

  if (endMinutes - startMinutes < duration) {
    throw new ApiError(
      400,
      "Availability window must fit at least one appointment slot",
    );
  }

  // Create individual records and return their availabilityIds.
  return prisma.$transaction(
    days.map((dayOfWeek) =>
      prisma.doctorAvailability.create({
        data: {
          doctorId: input.doctorId,
          hospitalId: input.hospitalId,
          dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
          slotDurationMinutes: duration,
        },
      }),
    ),
  );
}

// GET DOCTOR AVAILABILITY
export async function getDoctorAvailability(doctorId: string) {
  return prisma.doctorAvailability.findMany({
    where: { doctorId },
    orderBy: [
      { dayOfWeek: "asc" },
      { startTime: "asc" },
    ],
  });
}

// UPDATE SINGLE DOCTOR AVAILABILITY
// UPDATE SINGLE OR MULTIPLE DOCTOR AVAILABILITY DAYS
export async function updateDoctorAvailability(
  availabilityId: string,
  input: UpdateAvailabilityInput,
) {
  const existing = await prisma.doctorAvailability.findUnique({
    where: { availabilityId },
  });

  if (!existing) {
    throw new ApiError(404, "Doctor availability not found");
  }

  const days =
    input.days !== undefined
      ? Array.isArray(input.days)
        ? input.days
        : [input.days]
      : input.dayOfWeek !== undefined
        ? [input.dayOfWeek]
        : [existing.dayOfWeek];

  if (days.length === 0) {
    throw new ApiError(400, "At least one availability day is required");
  }

  if (
    days.some(
      (day) =>
        !Number.isInteger(day) ||
        day < 0 ||
        day > 6,
    )
  ) {
    throw new ApiError(400, "days must contain values between 0 and 6");
  }

  if (new Set(days).size !== days.length) {
    throw new ApiError(400, "Duplicate days are not allowed");
  }

  const merged = {
    doctorId: input.doctorId ?? existing.doctorId,
    hospitalId: input.hospitalId ?? existing.hospitalId ?? undefined,
    startTime: input.startTime ?? existing.startTime,
    endTime: input.endTime ?? existing.endTime,
    slotDurationMinutes:
      input.slotDurationMinutes ?? existing.slotDurationMinutes,
  };

  if (!merged.doctorId.trim()) {
    throw new ApiError(400, "doctorId is required");
  }

  validateAvailability({
    dayOfWeek: days[0],
    startTime: merged.startTime,
    endTime: merged.endTime,
    slotDurationMinutes: merged.slotDurationMinutes,
  });

  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };

  if (
    toMinutes(merged.endTime) - toMinutes(merged.startTime) <
    merged.slotDurationMinutes
  ) {
    throw new ApiError(
      400,
      "Availability window must fit at least one appointment slot",
    );
  }

  return prisma.$transaction(async (tx) => {
    // Update the original availability record using the first day.
    const updated = await tx.doctorAvailability.update({
      where: { availabilityId },
      data: {
        doctorId: merged.doctorId,
        hospitalId: merged.hospitalId,
        dayOfWeek: days[0],
        startTime: merged.startTime,
        endTime: merged.endTime,
        slotDurationMinutes: merged.slotDurationMinutes,
      },
    });

    // Create additional records for the remaining days.
    const additionalRecords = await Promise.all(
      days.slice(1).map((dayOfWeek) =>
        tx.doctorAvailability.create({
          data: {
            doctorId: merged.doctorId,
            hospitalId: merged.hospitalId,
            dayOfWeek,
            startTime: merged.startTime,
            endTime: merged.endTime,
            slotDurationMinutes: merged.slotDurationMinutes,
          },
        }),
      ),
    );

    return [updated, ...additionalRecords];
  });
}

// ACTIVATE / DEACTIVATE AVAILABILITY
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
