
import type {
  Request,
  Response,
} from "express";

import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

import {
  createOrGetConsultationSession,
  getConsultationSession,
  checkInPatient,
  markDoctorDelayed,
  startConsultation,
  endConsultation,
} from "../services/consultation.session.service.js";

import type { SessionActor } from "../services/consultation.session.service.js";

import {
  getRequestedLanguage,
  translateResponse,
} from "../utils/translate.response";

function getActor(req: Request): SessionActor {
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role");

  if (!userId || !role) {
    throw new ApiError(
      401,
      "Missing authenticated user information",
    );
  }

  return { userId, role };
}

function getAppointmentId(req: Request): string {
  const appointmentId = req.params.appointmentId as string;

  if (!appointmentId) {
    throw new ApiError(400, "Appointment ID is required");
  }

  return appointmentId;
}

export const createSession = asyncHandler(
  async (req: Request, res: Response) => {
    const session = await createOrGetConsultationSession(
      getAppointmentId(req),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Consultation session retrieved or created successfully",
        language,
      ),
      data: await translateResponse(session, language),
    });
  },
);

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
