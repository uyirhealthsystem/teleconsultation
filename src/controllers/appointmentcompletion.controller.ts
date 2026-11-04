
import { completeAppointment } from "../services/appointmentcompletion.service.js";

import type { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getRequestedLanguage,
  translateResponse,
} from "../utils/translate.response";

import { ApiError } from "../utils/ApiError.js";





export const completeAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const userId = req.header("x-user-id");
    const role = req.header("x-user-role");

    if (!appointmentId?.trim()) {
      throw new ApiError(400, "appointmentId is required");
    }

    if (!userId || !role) {
      throw new ApiError(401, "Missing authenticated user information");
    }

    const appointment = await completeAppointment(
      appointmentId,
      { userId, role },
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Appointment completed successfully",
        language,
      ),
      data: appointment,
    });
  },
);