
import type { Request, Response, NextFunction } from "express";

import type { AuthenticatedRequest } from "../middlewares/requireUser.middleware.js";

import {
  submitFeedback,
  getAppointmentFeedback,
  getMyFeedback,
} from "../services/feedback.service.js";

import {
  getRequestedLanguage,
  translateResponse,
} from "../utils/translate.response.js";

import { ApiError } from "../utils/ApiError.js";

function getAuthenticatedActor(req: Request) {
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role");

  if (!userId || !role) {
    const error = new Error(
      "Missing authenticated user headers",
    ) as Error & { statusCode: number };

    error.statusCode = 401;
    throw error;
  }

  return { userId, role };
}

export async function createFeedback(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const actor = getAuthenticatedActor(req);
    const appointmentId = req.params.appointmentId as string;

    if (!appointmentId?.trim()) {
      throw new ApiError(400, "appointmentId is required");
    }

    const {
      overallRating,
      communicationRating,
      experienceRating,
      cooperationRating,
      comments,
    } = req.body;

    if (
      comments !== undefined &&
      typeof comments !== "string"
    ) {
      throw new ApiError(400, "comments must be a string");
    }

    const feedback = await submitFeedback(
      appointmentId,
      actor,
      {
        overallRating,
        communicationRating,
        experienceRating,
        cooperationRating,
        comments,
      },
    );

    const language = getRequestedLanguage(req);

    res.status(201).json({
      success: true,
      message: await translateResponse(
        "Feedback submitted successfully",
        language,
      ),
      data: await translateResponse(feedback, language),
    });
  } catch (error) {
    next(error);
  }
}

export async function getFeedbackByAppointment(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const actor = getAuthenticatedActor(req);
    const appointmentId = req.params.appointmentId as string;

    if (!appointmentId?.trim()) {
      throw new ApiError(400, "appointmentId is required");
    }

    const feedback = await getAppointmentFeedback(
      appointmentId,
      actor,
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Appointment feedback retrieved successfully",
        language,
      ),
      data: await translateResponse(feedback, language),
    });
  } catch (error) {
    next(error);
  }
}

export async function listMyFeedback(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const actor = getAuthenticatedActor(req);

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new ApiError(400, "Invalid pagination parameters");
    }

    const result = await getMyFeedback(actor, page, limit);

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Your feedback retrieved successfully",
        language,
      ),
      data: await translateResponse(result.feedback, language),
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}
