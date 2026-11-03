
import type { Request, Response, NextFunction } from "express";
import {
  BookingFor,
  ConsultationMode,
} from "../generated/prisma/client.js";

import type { AuthenticatedRequest } from "../middlewares/requireUser.middleware.js";

import {
  bookAppointment,
  getAvailableSlots,
  listMyAppointments,
  getAppointmentDetails,
  cancelAppointment,
  rescheduleAppointment,
  listPendingDoctorAppointments,
  confirmAppointment,
  rejectAppointment,
} from "../services/appointment.service.js";

import {
  getRequestedLanguage,
  translateResponse,
} from "../utils/translate.response";

import { ApiError } from "../utils/ApiError.js";

function getPatientAgeFromHeader(req: Request): number {
  const ageHeader = req.headers["x-patient-age"];

  if (
    typeof ageHeader !== "string" ||
    !/^\d{1,3}$/.test(ageHeader.trim())
  ) {
    throw new ApiError(
      400,
      "Valid x-patient-age header is required",
    );
  }

  const patientAge = Number(ageHeader.trim());

  if (
    !Number.isInteger(patientAge) ||
    patientAge < 0 ||
    patientAge > 130
  ) {
    throw new ApiError(
      400,
      "Patient age must be an integer between 0 and 130",
    );
  }

  return patientAge;
}

export async function getAvailableSlotsController(
  req: Request,
  res: Response,
) {
  try {
    const doctorId = req.params.doctorId as string;
    const date = req.query.date;

    if (!doctorId?.trim()) {
      res.status(400).json({
        success: false,
        message: "doctorId is required",
      });
      return;
    }

    if (typeof date !== "string") {
      res.status(400).json({
        success: false,
        message: "date query parameter is required (YYYY-MM-DD)",
      });
      return;
    }

    const slots = await getAvailableSlots(doctorId, date);
    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: "Doctor slots fetched successfully",
      data: await translateResponse(slots, language),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unable to fetch slots",
    });
  }
}

export async function getDoctorAvailableSlotsController(
  req: Request,
  res: Response,
) {
  try {
    const doctorId = req.headers["x-user-id"];
    const role = req.headers["x-user-role"];
    const date = req.query.date;

    if (typeof doctorId !== "string" || !doctorId.trim()) {
      res.status(401).json({
        success: false,
        message: "Doctor authentication required",
      });
      return;
    }

    if (
      typeof role !== "string" ||
      role.trim().toUpperCase() !== "DOCTOR"
    ) {
      res.status(403).json({
        success: false,
        message: "Only doctors can access their own availability",
      });
      return;
    }

    if (typeof date !== "string") {
      res.status(400).json({
        success: false,
        message: "date query parameter is required (YYYY-MM-DD)",
      });
      return;
    }

    const slots = await getAvailableSlots(doctorId, date);
    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: "Your slots fetched successfully",
      data: await translateResponse(slots, language),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unable to fetch your slots",
    });
  }
}

export async function bookAppointmentController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const authReq = req as AuthenticatedRequest;

    if (
      !authReq.userId ||
      !authReq.userRole ||
      !["CITIZEN", "PATIENT"].includes(
        authReq.userRole.toUpperCase(),
      )
    ) {
      throw new ApiError(403, "Only patients can book appointments");
    }

    const {
      patientId,
      bookingFor,
      doctorId,
      hospitalId,
      scheduledAt,
      durationMinutes,
      mode,
      reason,
    } = req.body;

    if (
      typeof patientId !== "string" ||
      !patientId.trim() ||
      !Object.values(BookingFor).includes(bookingFor) ||
      typeof doctorId !== "string" ||
      !doctorId.trim() ||
      typeof scheduledAt !== "string" ||
      !scheduledAt.trim() ||
      (mode !== undefined &&
        !Object.values(ConsultationMode).includes(mode)) ||
      (hospitalId !== undefined &&
        (typeof hospitalId !== "string" || !hospitalId.trim())) ||
      (durationMinutes !== undefined &&
        (typeof durationMinutes !== "number" ||
          !Number.isInteger(durationMinutes))) ||
      (reason !== undefined && typeof reason !== "string")
    ) {
      throw new ApiError(400, "Invalid appointment request");
    }

    if (
      bookingFor !== BookingFor.SELF &&
      bookingFor !== BookingFor.FAMILY_MEMBER
    ) {
      throw new ApiError(400, "Unsupported booking type");
    }

    // Patient age is read from the request header, not the request body.
    const patientAge = getPatientAgeFromHeader(req);

    // Create appointment with the actual patient's age snapshot.
    const appointment = await bookAppointment(authReq.userId, {
      patientId: patientId.trim(),
      bookingFor,
      doctorId: doctorId.trim(),
      hospitalId,
      scheduledAt,
      durationMinutes,
      mode,
      reason,
      patientAge,
    });

    const language = getRequestedLanguage(req);

    res.status(201).json({
      success: true,
      message:
        "Appointment booked successfully. Awaiting doctor confirmation.",
      data: {
        appointment: await translateResponse(appointment, language),
        appointmentStatus: appointment.status,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getMyAppointments(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.headers["x-user-id"];
    const role = req.headers["x-user-role"];

    if (typeof userId !== "string" || typeof role !== "string") {
      throw new ApiError(401, "Authentication required");
    }

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);

    const result = await listMyAppointments(
      { userId, role },
      page,
      limit,
    );

    res.status(200).json({
      success: true,
      message: "Appointments retrieved successfully",
      data: result.appointments,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}

export async function getAppointmentById(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const appointmentId = req.params.appointmentId as string;
    const userId = req.headers["x-user-id"];
    const role = req.headers["x-user-role"];

    if (typeof userId !== "string" || typeof role !== "string") {
      throw new ApiError(401, "Authentication required");
    }

    const appointment = await getAppointmentDetails(
      appointmentId,
      { userId, role },
    );

    res.status(200).json({
      success: true,
      message: "Appointment retrieved successfully",
      data: appointment,
    });
  } catch (error) {
    next(error);
  }
}

export async function cancelAppointmentController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const authReq = req as AuthenticatedRequest;
    const { reason } = req.body;

    if (
      reason !== undefined &&
      (typeof reason !== "string" || reason.length > 500)
    ) {
      throw new ApiError(
        400,
        "Cancellation reason must be at most 500 characters",
      );
    }

    const appointment = await cancelAppointment(
      authReq.params.appointmentId as string,
      {
        userId: authReq.userId,
        role: authReq.userRole,
      },
      reason,
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: "Appointment cancelled successfully",
      data: await translateResponse(appointment, language),
    });
  } catch (error) {
    next(error);
  }
}

export async function rescheduleAppointmentController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const authReq = req as AuthenticatedRequest;
    const { scheduledAt } = req.body;

    if (typeof scheduledAt !== "string" || !scheduledAt.trim()) {
      throw new ApiError(400, "scheduledAt is required");
    }

    const appointment = await rescheduleAppointment(
      authReq.params.appointmentId as string,
      {
        userId: authReq.userId,
        role: authReq.userRole,
      },
      scheduledAt,
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: "Appointment rescheduled successfully",
      data: await translateResponse(appointment, language),
    });
  } catch (error) {
    next(error);
  }
}

export async function getPendingDoctorAppointments(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.userId || !authReq.userRole) {
      throw new ApiError(401, "Authentication required");
    }

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);

    const result = await listPendingDoctorAppointments(
      {
        userId: authReq.userId,
        role: authReq.userRole,
      },
      page,
      limit,
    );

    res.status(200).json({
      success: true,
      message: "Pending appointments retrieved successfully",
      data: result.appointments,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}

export async function confirmAppointmentController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const authReq = req as AuthenticatedRequest;

    const result = await confirmAppointment(
      authReq.params.appointmentId as string,
      {
        userId: authReq.userId,
        role: authReq.userRole,
      },
    );

    res.status(200).json({
      success: true,
      message: "Appointment confirmed successfully",
      data: {
        appointment: result.appointment,
        appointmentStatus: result.appointment.status,
        session: result.session,
        roomCreated: result.roomCreated,
        serviceMessage: result.message,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function rejectAppointmentController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const authReq = req as AuthenticatedRequest;
    const { reason } = req.body;

    if (typeof reason !== "string" || !reason.trim()) {
      throw new ApiError(400, "Rejection reason is required");
    }

    const appointment = await rejectAppointment(
      authReq.params.appointmentId as string,
      {
        userId: authReq.userId,
        role: authReq.userRole,
      },
      reason,
    );

    res.status(200).json({
      success: true,
      message: "Appointment rejected successfully",
      data: appointment,
    });
  } catch (error) {
    next(error);
  }
}
