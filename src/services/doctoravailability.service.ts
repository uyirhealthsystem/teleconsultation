
import { prisma } from "./prisma.service.js";
import { ApiError } from "../utils/ApiError.js";
import { Prisma } from "../generated/prisma/client.js";

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

// Prisma interactive transaction settings.
// Increased maxWait to avoid P2028 transaction startup timeout.
const TRANSACTION_OPTIONS = {
  maxWait: 15000,
  timeout: 30000,
};

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

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

  if (
    toMinutes(endTime) - toMinutes(startTime) <
    slotDurationMinutes
  ) {
    throw new ApiError(
      400,
      "Availability window must fit at least one appointment slot",
    );
  }
}

function normalizeDays(
  days?: number | number[],
  dayOfWeek?: number,
  fallbackDay?: number,
): number[] {
  const result =
    days !== undefined
      ? Array.isArray(days)
        ? days
        : [days]
      : dayOfWeek !== undefined
        ? [dayOfWeek]
        : fallbackDay !== undefined
          ? [fallbackDay]
          : [];

  if (result.length === 0) {
    throw new ApiError(400, "At least one availability day is required");
  }

  if (
    result.some(
      (day) =>
        !Number.isInteger(day) ||
        day < 0 ||
        day > 6,
    )
  ) {
    throw new ApiError(400, "days must contain values between 0 and 6");
  }

  if (new Set(result).size !== result.length) {
    throw new ApiError(400, "Duplicate days are not allowed");
  }

  return result;
}

/**
 * Locks doctor schedules in a consistent order.
 *
 * This prevents concurrent requests from creating overlapping
 * schedules for the same doctor.
 */
async function lockDoctors(
  tx: Prisma.TransactionClient,
  doctorIds: string[],
) {
  const uniqueDoctorIds = [...new Set(doctorIds)].sort();

  for (const doctorId of uniqueDoctorIds) {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${doctorId}))::text
        AS lock_result
    `;
  }
}

/**
 * Checks whether a schedule overlaps with another schedule.
 *
 * Inactive schedules are also considered conflicts.
 *
 * Example:
 * Existing: 09:00 - 13:00
 * New:      11:00 - 15:00
 * Result:   Conflict
 */
async function ensureNoOverlap(
  tx: Prisma.TransactionClient,
  input: {
    doctorId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    excludeAvailabilityId?: string;
  },
) {
  const conflict = await tx.doctorAvailability.findFirst({
    where: {
      doctorId: input.doctorId,
      dayOfWeek: input.dayOfWeek,
      startTime: {
        lt: input.endTime,
      },
      endTime: {
        gt: input.startTime,
      },
      ...(input.excludeAvailabilityId
        ? {
            availabilityId: {
              not: input.excludeAvailabilityId,
            },
          }
        : {}),
    },
  });

  if (conflict) {
    throw new ApiError(
      409,
      `Availability already exists or overlaps on day ${input.dayOfWeek} (${conflict.startTime}-${conflict.endTime})`,
    );
  }
}

async function findOverlappingAvailability(
  tx: Prisma.TransactionClient,
  input: {
    doctorId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  },
) {
  return tx.doctorAvailability.findFirst({
    where: {
      doctorId: input.doctorId,
      dayOfWeek: input.dayOfWeek,
      startTime: {
        lt: input.endTime,
      },
      endTime: {
        gt: input.startTime,
      },
    },
  });
}

// ======================================================
// CREATE DOCTOR AVAILABILITY
// ======================================================

// ======================================================
// CREATE DOCTOR AVAILABILITY
// ======================================================

export async function createDoctorAvailability(
  input: CreateAvailabilityInput,
) {
  if (!input.doctorId?.trim()) {
    throw new ApiError(400, "doctorId is required");
  }

  const days = normalizeDays(input.days, input.dayOfWeek);
  const duration = input.slotDurationMinutes ?? 30;

  // Validate every requested day before starting transaction.
  for (const dayOfWeek of days) {
    validateAvailability({
      dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      slotDurationMinutes: duration,
    });
  }

  return prisma.$transaction(
    async (tx) => {
      // Lock this doctor's schedule to prevent concurrent duplicates.
      await lockDoctors(tx, [input.doctorId]);

      const createdRecords = [];
      const skippedDays: number[] = [];

      // Check each requested day independently.
      for (const dayOfWeek of days) {
        const conflict = await findOverlappingAvailability(tx, {
          doctorId: input.doctorId,
          dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
        });

        // Skip only the conflicting day.
        if (conflict) {
          skippedDays.push(dayOfWeek);
          continue;
        }

        // Create availability for non-conflicting days.
        const record = await tx.doctorAvailability.create({
          data: {
            doctorId: input.doctorId,
            hospitalId: input.hospitalId,
            dayOfWeek,
            startTime: input.startTime,
            endTime: input.endTime,
            slotDurationMinutes: duration,
          },
        });

        createdRecords.push(record);
      }

      return {
        createdRecords,
        createdDays: createdRecords.map(
          (record) => record.dayOfWeek,
        ),
        skippedDays,
        createdCount: createdRecords.length,
        skippedCount: skippedDays.length,
      };
    },
    TRANSACTION_OPTIONS,
  );
}

// ======================================================
// GET DOCTOR AVAILABILITY
// ======================================================

export async function getDoctorAvailability(doctorId: string) {
  if (!doctorId?.trim()) {
    throw new ApiError(400, "doctorId is required");
  }

  return prisma.doctorAvailability.findMany({
    where: { doctorId },
    orderBy: [
      { dayOfWeek: "asc" },
      { startTime: "asc" },
    ],
  });
}

// ======================================================
// UPDATE DOCTOR AVAILABILITY
// ======================================================

export async function updateDoctorAvailability(
  availabilityId: string,
  input: UpdateAvailabilityInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const initial = await tx.doctorAvailability.findUnique({
        where: { availabilityId },
      });

      if (!initial) {
        throw new ApiError(404, "Doctor availability not found");
      }

      const doctorId = input.doctorId ?? initial.doctorId;

      if (!doctorId.trim()) {
        throw new ApiError(400, "doctorId is required");
      }

      // Lock old and new doctor schedules.
      await lockDoctors(tx, [initial.doctorId, doctorId]);

      // Read the record again after acquiring the locks.
      const existing = await tx.doctorAvailability.findUnique({
        where: { availabilityId },
      });

      if (!existing) {
        throw new ApiError(404, "Doctor availability not found");
      }

      const days = normalizeDays(
        input.days,
        input.dayOfWeek,
        existing.dayOfWeek,
      );

      const merged = {
        doctorId,
        hospitalId: input.hospitalId ?? existing.hospitalId,
        startTime: input.startTime ?? existing.startTime,
        endTime: input.endTime ?? existing.endTime,
        slotDurationMinutes:
          input.slotDurationMinutes ?? existing.slotDurationMinutes,
      };

      for (const dayOfWeek of days) {
        validateAvailability({
          dayOfWeek,
          startTime: merged.startTime,
          endTime: merged.endTime,
          slotDurationMinutes: merged.slotDurationMinutes,
        });
      }

      // Check every requested day before modifying records.
      for (const dayOfWeek of days) {
        await ensureNoOverlap(tx, {
          doctorId: merged.doctorId,
          dayOfWeek,
          startTime: merged.startTime,
          endTime: merged.endTime,
          excludeAvailabilityId: availabilityId,
        });
      }

      // Update the original record using the first requested day.
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

      const additionalRecords = [];

      // Create records for the remaining requested days.
      for (const dayOfWeek of days.slice(1)) {
        const record = await tx.doctorAvailability.create({
          data: {
            doctorId: merged.doctorId,
            hospitalId: merged.hospitalId,
            dayOfWeek,
            startTime: merged.startTime,
            endTime: merged.endTime,
            slotDurationMinutes: merged.slotDurationMinutes,
            isActive: existing.isActive,
          },
        });

        additionalRecords.push(record);
      }

      return [updated, ...additionalRecords];
    },
    TRANSACTION_OPTIONS,
  );
}

// ======================================================
// ACTIVATE / DEACTIVATE AVAILABILITY
// ======================================================

export async function updateDoctorAvailabilityStatus(
  availabilityId: string,
  isActive: boolean,
) {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.doctorAvailability.findUnique({
        where: { availabilityId },
      });

      if (!existing) {
        throw new ApiError(404, "Doctor availability not found");
      }

      await lockDoctors(tx, [existing.doctorId]);

      const current = await tx.doctorAvailability.findUnique({
        where: { availabilityId },
      });

      if (!current) {
        throw new ApiError(404, "Doctor availability not found");
      }

      // Prevent conflicting schedules from being activated.
      if (isActive) {
        await ensureNoOverlap(tx, {
          doctorId: current.doctorId,
          dayOfWeek: current.dayOfWeek,
          startTime: current.startTime,
          endTime: current.endTime,
          excludeAvailabilityId: availabilityId,
        });
      }

      return tx.doctorAvailability.update({
        where: { availabilityId },
        data: { isActive },
      });
    },
    TRANSACTION_OPTIONS,
  );
}
