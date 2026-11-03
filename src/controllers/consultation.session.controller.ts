
import type {
  Request,
  Response,
} from "express";

import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

import {
  getConsultationSession,
  checkInPatient,
  markDoctorDelayed,
  startConsultation,
  endConsultation,
  generateConsultationJoinToken,
} from "../services/consultation.session.service.js";

import type {
  SessionActor,
} from "../services/consultation.session.service.js";

import {
  getRequestedLanguage,
  translateResponse,
} from "../utils/translate.response.js";

/**
 * Gets the authenticated actor.
 *
 * Patient age is intentionally not accepted from request headers.
 * It is retrieved from the Appointment record inside the service.
 */
function getActor(req: Request): SessionActor {
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role");

  if (!userId || !role) {
    throw new ApiError(
      401,
      "Missing authenticated user information",
    );
  }

  return {
    userId: userId.trim(),
    role: role.trim(),
  };
}

/**
 * Gets and validates appointment ID.
 */
function getAppointmentId(req: Request): string {
  const appointmentId = req.params.appointmentId as string;

  if (!appointmentId) {
    throw new ApiError(400, "Appointment ID is required");
  }

  return appointmentId;
}

/**
 * GET appointment consultation session.
 */
export const getSession = asyncHandler(
  async (req: Request, res: Response) => {
    const session = await getConsultationSession(
      getAppointmentId(req),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Consultation session retrieved successfully",
        language,
      ),
      data: await translateResponse(session, language),
    });
  },
);

/**
 * POST patient check-in.
 */
export const patientCheckIn = asyncHandler(
  async (req: Request, res: Response) => {
    const session = await checkInPatient(
      getAppointmentId(req),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Patient checked in successfully",
        language,
      ),
      data: await translateResponse(session, language),
    });
  },
);

/**
 * POST doctor marks consultation delay.
 */
export const doctorMarkDelay = asyncHandler(
  async (req: Request, res: Response) => {
    const session = await markDoctorDelayed(
      getAppointmentId(req),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Doctor delay marked successfully",
        language,
      ),
      data: await translateResponse(session, language),
    });
  },
);

/**
 * POST doctor starts consultation.
 */
export const doctorStartConsultation = asyncHandler(
  async (req: Request, res: Response) => {
    const session = await startConsultation(
      getAppointmentId(req),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Consultation started successfully",
        language,
      ),
      data: await translateResponse(session, language),
    });
  },
);

/**
 * POST doctor ends consultation.
 */
export const doctorEndConsultation = asyncHandler(
  async (req: Request, res: Response) => {
    const session = await endConsultation(
      getAppointmentId(req),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Consultation ended successfully",
        language,
      ),
      data: await translateResponse(session, language),
    });
  },
);

/**
 * POST generate 100ms meeting join token.
 */
export const generateJoinToken = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await generateConsultationJoinToken(
      getAppointmentId(req),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Meeting token generated successfully",
        language,
      ),
      data: await translateResponse(result, language),
    });
  },
);
