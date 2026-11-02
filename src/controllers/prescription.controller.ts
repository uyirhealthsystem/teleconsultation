import type { Request, Response } from "express";

import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

import {
  createPrescription,
  getPrescription,
} from "../services/prescription.service.js";

import type {
  PrescriptionActor,
} from "../services/prescription.service.js";

import {
  getRequestedLanguage,
  translateResponse,
} from "../utils/translate.response";

/**
 * Read the authenticated user information.
 */
function getActor(req: Request): PrescriptionActor {
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role");

  if (!userId || !role) {
    throw new ApiError(
      401,
      "Missing authenticated user information",
    );
  }

  return {
    userId,
    role,
  };
}

/**
 * Read and validate appointmentId from route parameters.
 */
function getRequiredParam(
  req: Request,
  name: "appointmentId",
): string {
  const value = req.params[name] as string;

  if (!value || !value.trim()) {
    throw new ApiError(
      400,
      `${name} is required`,
    );
  }

  return value;
}

/**
 * POST /appointments/:appointmentId/prescription
 *
 * Create and immediately issue a complete prescription
 * containing multiple medicine items.
 */
export const createPrescriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = getRequiredParam(
      req,
      "appointmentId",
    );

    const prescription = await createPrescription(
      appointmentId,
      getActor(req),
      req.body,
    );

    const language = getRequestedLanguage(req);

    res.status(201).json({
      success: true,
      message: await translateResponse(
        "Prescription created and issued successfully",
        language,
      ),
      data: prescription,
    });
  },
);

/**
 * GET /appointments/:appointmentId/prescription
 *
 * Retrieve the prescription for a specific appointment.
 * The service authorizes the doctor or actual patient.
 */
export const getPrescriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = getRequiredParam(
      req,
      "appointmentId",
    );

    const prescription = await getPrescription(
      appointmentId,
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Prescription retrieved successfully",
        language,
      ),
      data: prescription,
    });
  },
);