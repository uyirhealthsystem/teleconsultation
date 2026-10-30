
import {
  AppointmentStatus,
  BookingFor,
  ConsultationMode,
  Prisma,
} from "../generated/prisma/client.js";
import { ApiError } from "../utils/ApiError.js";
import { prisma } from "./prisma.service.js";

const blockingStatuses: AppointmentStatus[] = [
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
];

const cancellableStatuses: AppointmentStatus[] = [
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
];

const INDIA_TIME_ZONE = "Asia/Kolkata";
const MAX_APPOINTMENT_DURATION_MINUTES = 120;
const MIN_APPOINTMENT_DURATION_MINUTES = 10;
const MINUTES_IN_MS = 60_000;

const MAX_LOOKBACK_MS =
  MAX_APPOINTMENT_DURATION_MINUTES * MINUTES_IN_MS;

type AppointmentActor = {
  userId: string;
  role: string;
};

type AppointmentChangeActor = AppointmentActor;

interface BookAppointmentInput {
  // Retained for compatibility with the existing controller.
  // For SELF bookings, the authenticated user ID is authoritative.
  patientId: string;
  bookingFor: BookingFor;
  doctorId: string;
  hospitalId?: string;
  scheduledAt: string;
  durationMinutes?: number;
  mode?: ConsultationMode;
  reason?: string;
}

type AppointmentWindow = {
  startAt: string;
  endAt: string;
  available: boolean;
};

function badRequest(message: string): ApiError {
  return new ApiError(400, message);
}

function getIndiaDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:30`);
}

function overlaps(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  return startA < endB && startB < endA;
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function getDayOfWeekFromDate(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function getIndiaParts(date: Date): {
  localDate: string;
  localTime: string;
  dayOfWeek: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;

  const year = part("year");
  const month = part("month");
  const day = part("day");
  const hour = part("hour");
  const minute = part("minute");
  const weekday = part("weekday");

  if (!year || !month || !day || !hour || !minute || !weekday) {
    throw new ApiError(
      500,
      "Unable to determine India local date and time",
    );
  }

  const weekdayNumber: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const dayOfWeek = weekdayNumber[weekday];

  if (dayOfWeek === undefined) {
    throw new ApiError(500, "Unable to determine appointment weekday");
  }

  return {
    localDate: `${year}-${month}-${day}`,
    localTime: `${hour}:${minute}`,
    dayOfWeek,
  };
}

function validateFutureDateTime(value: string): Date {
  if (
    typeof value !== "string" ||
    !value.includes("T") ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(value)
  ) {
    throw badRequest(
      "scheduledAt must be a valid ISO date-time with timezone",
    );
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw badRequest(
      "scheduledAt must be a valid ISO date-time with timezone",
    );
  }

  if (date <= new Date()) {
    throw badRequest("Appointment must be scheduled in the future");
  }

  return date;
}

function normalizeRole(role: string): string {
  return role.trim().toUpperCase();
}

function canViewAppointments(actor: AppointmentActor): boolean {
  return ["CITIZEN", "PATIENT", "DOCTOR"].includes(
    normalizeRole(actor.role),
  );
}

function canManageAppointment(
  appointment: {
    bookedByUserId: string;
    patientId: string;
    doctorId: string;
  },
  actor: AppointmentChangeActor,
): boolean {
  const role = normalizeRole(actor.role);

  if (role === "DOCTOR") {
    return appointment.doctorId === actor.userId;
  }

  if (role === "CITIZEN" || role === "PATIENT") {
    return (
      appointment.bookedByUserId === actor.userId ||
      appointment.patientId === actor.userId
    );
  }

  return false;
}

function validateActor(actor: AppointmentActor): void {
  if (!actor.userId?.trim()) {
    throw new ApiError(401, "Authentication required");
  }

  if (!canViewAppointments(actor)) {
    throw new ApiError(403, "Not allowed to access appointments");
  }
}

function validateDuration(durationMinutes: number): void {
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < MIN_APPOINTMENT_DURATION_MINUTES ||
    durationMinutes > MAX_APPOINTMENT_DURATION_MINUTES
  ) {
    throw badRequest(
      `durationMinutes must be between ${MIN_APPOINTMENT_DURATION_MINUTES} and ${MAX_APPOINTMENT_DURATION_MINUTES}`,
    );
  }
}

function getWindowMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function isWithinAvailability(
  startMinutes: number,
  durationMinutes: number,
  windows: Array<{
    startTime: string;
    endTime: string;
    slotDurationMinutes: number;
  }>,
): boolean {
  const endMinutes = startMinutes + durationMinutes;

  return windows.some((window) => {
    const windowStart = getWindowMinutes(window.startTime);
    const windowEnd = getWindowMinutes(window.endTime);
    const slotDuration = window.slotDurationMinutes;

    if (
      windowStart === null ||
      windowEnd === null ||
      windowEnd <= windowStart ||
      !Number.isInteger(slotDuration) ||
      slotDuration <= 0
    ) {
      return false;
    }

    return (
      startMinutes >= windowStart &&
      endMinutes <= windowEnd &&
      (startMinutes - windowStart) % slotDuration === 0
    );
  });
}

async function acquireDoctorBookingLock(
  tx: Prisma.TransactionClient,
  doctorId: string,
): Promise<void> {
  await tx.$queryRaw`
    WITH lock_result AS (
      SELECT pg_advisory_xact_lock(hashtext(${doctorId}))
    )
    SELECT 1 AS locked
    FROM lock_result
  `;
}

async function findOverlappingAppointments(
  tx: Prisma.TransactionClient,
  doctorId: string,
  start: Date,
  end: Date,
  excludeAppointmentId?: string,
) {
  return tx.appointment.findMany({
    where: {
      doctorId,
      status: { in: blockingStatuses },
      scheduledAt: {
        gte: new Date(start.getTime() - MAX_LOOKBACK_MS),
        lt: end,
      },
      ...(excludeAppointmentId
        ? { appointmentId: { not: excludeAppointmentId } }
        : {}),
    },
    select: {
      appointmentId: true,
      scheduledAt: true,
      durationMinutes: true,
    },
  });
}

export async function getAvailableSlots(
  doctorId: string,
  date: string,
): Promise<AppointmentWindow[]> {
  if (!doctorId?.trim()) {
    throw badRequest("doctorId is required");
  }

  if (!isValidCalendarDate(date)) {
    throw badRequest("Date must be a valid date in YYYY-MM-DD format");
  }

  const dayOfWeek = getDayOfWeekFromDate(date);

  const availability = await prisma.doctorAvailability.findMany({
    where: {
      doctorId,
      dayOfWeek,
      isActive: true,
    },
    orderBy: {
      startTime: "asc",
    },
  });

  if (availability.length === 0) {
    return [];
  }

  const dayStart = getIndiaDateTime(date, "00:00");
  const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      doctorId,
      status: { in: blockingStatuses },
      scheduledAt: {
        gte: new Date(dayStart.getTime() - MAX_LOOKBACK_MS),
        lt: nextDay,
      },
    },
    select: {
      scheduledAt: true,
      durationMinutes: true,
    },
  });

  const now = new Date();
  const slots: AppointmentWindow[] = [];

  for (const window of availability) {
    const windowStart = getWindowMinutes(window.startTime);
    const windowEnd = getWindowMinutes(window.endTime);
    const slotDuration = window.slotDurationMinutes;

    if (
      windowStart === null ||
      windowEnd === null ||
      windowEnd <= windowStart ||
      !Number.isInteger(slotDuration) ||
      slotDuration <= 0
    ) {
      continue;
    }

    for (
      let minute = windowStart;
      minute + slotDuration <= windowEnd;
      minute += slotDuration
    ) {
      const startTime =
        `${String(Math.floor(minute / 60)).padStart(2, "0")}:` +
        `${String(minute % 60).padStart(2, "0")}`;

      const endMinute = minute + slotDuration;
      const endTime =
        `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:` +
        `${String(endMinute % 60).padStart(2, "0")}`;

      const startAt = getIndiaDateTime(date, startTime);
      const endAt = getIndiaDateTime(date, endTime);

      const booked = appointments.some((appointment) => {
        const existingStart = appointment.scheduledAt;
        const existingEnd = new Date(
          existingStart.getTime() +
            appointment.durationMinutes * MINUTES_IN_MS,
        );

        return overlaps(startAt, endAt, existingStart, existingEnd);
      });

      slots.push({
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        available: startAt > now && !booked,
      });
    }
  }

  return slots;
}


export async function bookAppointment(
  bookedByUserId: string,
  input: BookAppointmentInput,
) {
  if (!bookedByUserId?.trim()) {
    throw new ApiError(401, "Authentication required");
  }

  if (!input || typeof input !== "object") {
    throw badRequest("Appointment details are required");
  }

  const {
    patientId,
    bookingFor,
    doctorId,
    hospitalId,
    scheduledAt,
    durationMinutes = 30,
    mode = ConsultationMode.VIDEO,
    reason,
  } = input;

  const authenticatedUserId = bookedByUserId.trim();

  if (!doctorId?.trim()) {
    throw badRequest("doctorId is required");
  }

  if (!patientId?.trim()) {
    throw badRequest("patientId is required");
  }

  if (!Object.values(BookingFor).includes(bookingFor)) {
    throw badRequest("Invalid bookingFor value");
  }

  if (!Object.values(ConsultationMode).includes(mode)) {
    throw badRequest("Invalid consultation mode");
  }

  // Resolve patient identity.
  let effectivePatientId: string;

  if (bookingFor === BookingFor.SELF) {
    // SELF booking: authenticated user is always the patient.
    effectivePatientId = authenticatedUserId;

    if (patientId.trim() !== authenticatedUserId) {
      throw new ApiError(
        403,
        "For SELF bookings, patientId must match the authenticated user",
      );
    }
  } else if (bookingFor === BookingFor.FAMILY_MEMBER) {
    // TEMPORARY DEMO SUPPORT.
    // Citizen-service relationship verification will be added later.
    if (patientId.trim() === authenticatedUserId) {
      throw badRequest(
        "For FAMILY_MEMBER bookings, provide the family member's patientId",
      );
    }

    effectivePatientId = patientId.trim();
  } else if (bookingFor === BookingFor.OTHER_PERSON) {
    throw new ApiError(
      403,
      "Booking for another person is not supported",
    );
  } else {
    throw badRequest("Invalid booking type");
  }

  const start = validateFutureDateTime(scheduledAt);
  validateDuration(durationMinutes);

  if (reason !== undefined && typeof reason !== "string") {
    throw badRequest("reason must be a string");
  }

  const end = new Date(
    start.getTime() + durationMinutes * MINUTES_IN_MS,
  );

  return prisma.$transaction(
    async (tx) => {
      await acquireDoctorBookingLock(tx, doctorId);

      const { localTime, dayOfWeek } = getIndiaParts(start);
      const startMinutes = getWindowMinutes(localTime);

      if (startMinutes === null) {
        throw badRequest("Unable to determine appointment start time");
      }

      const availability = await tx.doctorAvailability.findMany({
        where: {
          doctorId,
          dayOfWeek,
          isActive: true,
        },
      });

      if (
        !isWithinAvailability(
          startMinutes,
          durationMinutes,
          availability,
        )
      ) {
        throw new ApiError(
          409,
          "Requested time is outside the doctor's available slots",
        );
      }

      const existingAppointments = await findOverlappingAppointments(
        tx,
        doctorId,
        start,
        end,
      );

      const conflict = existingAppointments.some((appointment) => {
        const existingEnd = new Date(
          appointment.scheduledAt.getTime() +
            appointment.durationMinutes * MINUTES_IN_MS,
        );

        return overlaps(
          start,
          end,
          appointment.scheduledAt,
          existingEnd,
        );
      });

      if (conflict) {
        throw new ApiError(
          409,
          "This appointment slot is no longer available",
        );
      }

      return tx.appointment.create({
        data: {
          bookedByUserId: authenticatedUserId,
          patientId: effectivePatientId,
          doctorId: doctorId.trim(),
          hospitalId,
          bookingFor,
          scheduledAt: start,
          durationMinutes,
          mode,
          reason: reason?.trim() || null,
          status: AppointmentStatus.PENDING,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}



export async function listMyAppointments(
  actor: AppointmentActor,
  page = 1,
  limit = 20,
) {
  validateActor(actor);

  if (
    !Number.isInteger(page) ||
    !Number.isInteger(limit) ||
    page < 1 ||
    limit < 1 ||
    limit > 100
  ) {
    throw badRequest("Invalid page or limit");
  }

  const role = normalizeRole(actor.role);

  let where: Prisma.AppointmentWhereInput;

  if (role === "DOCTOR") {
    where = {
      doctorId: actor.userId,
    };
  } else if (role === "PATIENT" || role === "CITIZEN") {
    where = {
      OR: [
        { bookedByUserId: actor.userId },
        { patientId: actor.userId },
      ],
    };
  } else {
    throw new ApiError(403, "You are not allowed to view appointments");
  }

  // Fetch appointments without opening a database transaction.
  const appointments = await prisma.appointment.findMany({
    where,
    orderBy: {
      scheduledAt: "desc",
    },
    skip: (page - 1) * limit,
    take: limit,
  });

  const total = await prisma.appointment.count({
    where,
  });

  return {
    appointments,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}



export async function getAppointmentDetails(
  appointmentId: string,
  actor: AppointmentActor,
) {
  validateActor(actor);

  if (!appointmentId?.trim()) {
    throw badRequest("appointmentId is required");
  }

  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
  });

  if (!appointment) {
    throw new ApiError(404, "Appointment not found");
  }

  if (!canManageAppointment(appointment, actor)) {
    throw new ApiError(404, "Appointment not found");
  }

  return appointment;
}

export async function cancelAppointment(
  appointmentId: string,
  actor: AppointmentChangeActor,
  reason?: string,
) {
  validateActor(actor);

  if (!appointmentId?.trim()) {
    throw badRequest("appointmentId is required");
  }

  const role = normalizeRole(actor.role);

  if (!["CITIZEN", "PATIENT", "DOCTOR"].includes(role)) {
    throw new ApiError(403, "Not allowed to cancel appointments");
  }

  if (reason !== undefined && typeof reason !== "string") {
    throw badRequest("reason must be a string");
  }

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { appointmentId },
    });

    if (!appointment || !canManageAppointment(appointment, actor)) {
      throw new ApiError(404, "Appointment not found");
    }

    if (!cancellableStatuses.includes(appointment.status)) {
      throw new ApiError(
        409,
        "Only unpaid, pending or confirmed appointments can be cancelled",
      );
    }

    if (appointment.scheduledAt <= new Date()) {
      throw new ApiError(409, "Past appointments cannot be cancelled");
    }

    const result = await tx.appointment.updateMany({
      where: {
        appointmentId,
        status: appointment.status,
        updatedAt: appointment.updatedAt,
      },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: reason?.trim() || null,
      },
    });

    if (result.count !== 1) {
      throw new ApiError(
        409,
        "Appointment was updated by another request. Please refresh and try again",
      );
    }

    return tx.appointment.findUniqueOrThrow({
      where: { appointmentId },
    });
  });
}

export async function rescheduleAppointment(
  appointmentId: string,
  actor: AppointmentChangeActor,
  scheduledAt: string,
) {
  validateActor(actor);

  if (!appointmentId?.trim()) {
    throw badRequest("appointmentId is required");
  }

  const role = normalizeRole(actor.role);

  if (!["CITIZEN", "PATIENT", "DOCTOR"].includes(role)) {
    throw new ApiError(403, "Not allowed to reschedule appointments");
  }

  const newStart = validateFutureDateTime(scheduledAt);

  return prisma.$transaction(
    async (tx) => {
      const current = await tx.appointment.findUnique({
        where: { appointmentId },
      });

      if (!current || !canManageAppointment(current, actor)) {
        throw new ApiError(404, "Appointment not found");
      }

      if (!cancellableStatuses.includes(current.status)) {
        throw new ApiError(
          409,
          "Only unpaid, pending or confirmed appointments can be rescheduled",
        );
      }

      if (current.scheduledAt <= new Date()) {
        throw new ApiError(409, "Past appointments cannot be rescheduled");
      }

      if (newStart.getTime() === current.scheduledAt.getTime()) {
        throw badRequest(
          "The new time must be different from the current appointment time",
        );
      }

      const newEnd = new Date(
        newStart.getTime() +
          current.durationMinutes * MINUTES_IN_MS,
      );

      await acquireDoctorBookingLock(tx, current.doctorId);

      const latest = await tx.appointment.findUnique({
        where: { appointmentId },
      });

      if (
        !latest ||
        latest.status !== current.status ||
        latest.updatedAt.getTime() !== current.updatedAt.getTime() ||
        !canManageAppointment(latest, actor)
      ) {
        throw new ApiError(
          409,
          "Appointment was updated by another request. Please refresh and try again",
        );
      }

      const { localTime, dayOfWeek } = getIndiaParts(newStart);
      const startMinutes = getWindowMinutes(localTime);

      if (startMinutes === null) {
        throw badRequest("Unable to determine appointment start time");
      }

      const availability = await tx.doctorAvailability.findMany({
        where: {
          doctorId: current.doctorId,
          dayOfWeek,
          isActive: true,
        },
      });

      if (
        !isWithinAvailability(
          startMinutes,
          current.durationMinutes,
          availability,
        )
      ) {
        throw new ApiError(
          409,
          "Requested time is outside the doctor's available slots",
        );
      }

      const existingAppointments = await findOverlappingAppointments(
        tx,
        current.doctorId,
        newStart,
        newEnd,
        appointmentId,
      );

      const conflict = existingAppointments.some((appointment) => {
        const existingEnd = new Date(
          appointment.scheduledAt.getTime() +
            appointment.durationMinutes * MINUTES_IN_MS,
        );

        return overlaps(
          newStart,
          newEnd,
          appointment.scheduledAt,
          existingEnd,
        );
      });

      if (conflict) {
        throw new ApiError(
          409,
          "This appointment slot is no longer available",
        );
      }

      const result = await tx.appointment.updateMany({
        where: {
          appointmentId,
          status: latest.status,
          updatedAt: latest.updatedAt,
        },
        data: {
          scheduledAt: newStart,
        },
      });

      if (result.count !== 1) {
        throw new ApiError(
          409,
          "Appointment was updated by another request. Please refresh and try again",
        );
      }

      return tx.appointment.findUniqueOrThrow({
        where: { appointmentId },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}


export async function listPendingDoctorAppointments(
  actor: AppointmentActor,
  page = 1,
  limit = 20,
) {
  validateActor(actor);

  if (normalizeRole(actor.role) !== "DOCTOR") {
    throw new ApiError(403, "Only doctors can view pending appointments");
  }

  if (
    !Number.isInteger(page) ||
    !Number.isInteger(limit) ||
    page < 1 ||
    limit < 1 ||
    limit > 100
  ) {
    throw badRequest("Invalid page or limit");
  }

  const where: Prisma.AppointmentWhereInput = {
    doctorId: actor.userId,
    status: AppointmentStatus.PENDING,
  };

  const [appointments, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.appointment.count({ where }),
  ]);

  return {
    appointments,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function confirmAppointment(
  appointmentId: string,
  actor: AppointmentActor,
) {
  validateActor(actor);

  if (normalizeRole(actor.role) !== "DOCTOR") {
    throw new ApiError(403, "Only doctors can confirm appointments");
  }

  if (!appointmentId?.trim()) {
    throw badRequest("appointmentId is required");
  }

  const result = await prisma.appointment.updateMany({
    where: {
      appointmentId,
      doctorId: actor.userId,
      status: AppointmentStatus.PENDING,
    },
    data: {
      status: AppointmentStatus.CONFIRMED,
    },
  });

  if (result.count !== 1) {
    const appointment = await prisma.appointment.findUnique({
      where: { appointmentId },
    });

    if (!appointment || appointment.doctorId !== actor.userId) {
      throw new ApiError(404, "Appointment not found");
    }

    throw new ApiError(
      409,
      "Appointment cannot be confirmed in its current status",
    );
  }

  return prisma.appointment.findUniqueOrThrow({
    where: { appointmentId },
  });
}

export async function rejectAppointment(
  appointmentId: string,
  actor: AppointmentActor,
  reason: string,
) {
  validateActor(actor);

  if (normalizeRole(actor.role) !== "DOCTOR") {
    throw new ApiError(403, "Only doctors can reject appointments");
  }

  if (!appointmentId?.trim()) {
    throw badRequest("appointmentId is required");
  }

  if (!reason?.trim() || reason.trim().length > 500) {
    throw badRequest("Rejection reason is required (maximum 500 characters)");
  }

  const result = await prisma.appointment.updateMany({
    where: {
      appointmentId,
      doctorId: actor.userId,
      status: AppointmentStatus.PENDING,
    },
    data: {
      status: AppointmentStatus.REJECTED,
      cancellationReason: reason.trim(),
    },
  });

  if (result.count !== 1) {
    const appointment = await prisma.appointment.findUnique({
      where: { appointmentId },
    });

    if (!appointment || appointment.doctorId !== actor.userId) {
      throw new ApiError(404, "Appointment not found");
    }

    throw new ApiError(
      409,
      "Appointment cannot be rejected in its current status",
    );
  }

  return prisma.appointment.findUniqueOrThrow({
    where: { appointmentId },
  });
}
