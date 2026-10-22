
import type { Request, Response , NextFunction  } from "express";
import {BookingFor,ConsultationMode,} from "../generated/prisma/client.js";
import type { AuthenticatedRequest } from "../middlewares/requireUser.middleware.js";
import {bookAppointment,getAvailableSlots,listMyAppointments,getAppointmentDetails,cancelAppointment,
  rescheduleAppointment,} from "../services/appointment.service.js";
import {getRequestedLanguage,translateResponse} from "../utils/translate.response";
import { ApiError } from "../utils/ApiError.js";


export async function getAvailableSlotsController(
  req: Request,
  res: Response,
) {
  try {
    const doctorId = req.params.doctorId as string;
    const date = req.query.date;

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
      data: await translateResponse(slots, language),
    });
  } 
  catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Unable to fetch slots",
    });
  }
}


export async function bookAppointmentController(
  req: Request,
  res: Response,
) {
  const authReq = req as AuthenticatedRequest;

  try {
    if (
      !authReq.userId ||
      !authReq.userRole ||
      !["CITIZEN", "PATIENT"].includes(authReq.userRole.toUpperCase())
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
        !Object.values(ConsultationMode).includes(mode))
    ) {
      throw new ApiError(400, "Invalid appointment request");
    }

    if (
      bookingFor !== BookingFor.SELF &&
      bookingFor !== BookingFor.FAMILY_MEMBER
    ) {
      throw new ApiError(400, "Unsupported booking type");
    }

    // The service must verify patientId against the authenticated
    // user or the Citizen service before creating the appointment.
    const appointment = await bookAppointment(authReq.userId, {
      patientId: patientId.trim(),
      bookingFor,
      doctorId: doctorId.trim(),
      hospitalId,
      scheduledAt,
      durationMinutes,
      mode,
      reason,
    });

    const language = getRequestedLanguage(req);

    res.status(201).json({
      success: true,
      message: "Appointment booked successfully",
      data: await translateResponse(appointment, language),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
      return;
    }

    const message =
      error instanceof Error
        ? error.message
        : "Unable to book appointment";

    const status = message.toLowerCase().includes("no longer available")
      ? 409
      : 400;

    res.status(status).json({
      success: false,
      message,
    });
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
    const  appointmentId  = req.params.appointmentId as string;
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
      throw new ApiError(400, "Cancellation reason must be at most 500 characters");
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
