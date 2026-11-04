
import type { Request, Response } from "express";

import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

import {
  createPrescription,
  getPrescription,
  updatePrescriptionDecision,
  updatePrescriptionItem,
  deletePrescriptionItem,
} from "../services/prescription.service.js";

import type {
  PrescriptionActor,
} from "../services/prescription.service.js";

import {
  getRequestedLanguage,
  translateResponse,
} from "../utils/translate.response.js";

function getActor(req: Request): PrescriptionActor {
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role");

  if (!userId || !role) {
    throw new ApiError(401, "Missing authenticated user information");
  }

  return { userId, role };
}

function getRequiredMedicineParam(req: Request): string {
  const value = req.params.prescriptionItemId as string;

  if (!value || !value.trim()) {
    throw new ApiError(400, "prescriptionItemId is required");
  }

  return value;
}

function getRequiredParam(
  req: Request,
  name: "appointmentId",
): string {
  const value = req.params[name] as string;

  if (!value || !value.trim()) {
    throw new ApiError(400, `${name} is required`);
  }

  return value;
}

export const createPrescriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const prescription = await createPrescription(
      getRequiredParam(req, "appointmentId"),
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

export const getPrescriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const prescription = await getPrescription(
      getRequiredParam(req, "appointmentId"),
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

export const updatePrescriptionDecisionController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointment = await updatePrescriptionDecision(
      getRequiredParam(req, "appointmentId"),
      getActor(req),
      req.body?.decision,
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Prescription decision recorded successfully",
        language,
      ),
      data: appointment,
    });
  },
);

export const updatePrescriptionItemController = asyncHandler(
  async (req: Request, res: Response) => {
    const medicine = await updatePrescriptionItem(
      getRequiredParam(req, "appointmentId"),
      getRequiredMedicineParam(req),
      getActor(req),
      req.body,
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Prescription medicine updated successfully",
        language,
      ),
      data: medicine,
    });
  },
);

export const deletePrescriptionItemController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await deletePrescriptionItem(
      getRequiredParam(req, "appointmentId"),
      getRequiredMedicineParam(req),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Prescription medicine deleted successfully",
        language,
      ),
      data: result,
    });
  },
);