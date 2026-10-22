
import type { Request, Response } from "express";

import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

import {
  createPrescription,
  getPrescription,
  updatePrescription,
  addPrescriptionItem,
  updatePrescriptionItem,
  removePrescriptionItem,
  issuePrescription,
} from "../services/prescription.service.js";

import type { PrescriptionActor } from "../services/prescription.service.js";

import {
  getRequestedLanguage,
  translateResponse,
} from "../utils/translate.response";

function getActor(req: Request): PrescriptionActor {
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

function getRequiredParam(
  req: Request,
  name: "appointmentId" | "itemId",
): string {
  const value = req.params[name] as string;

  if (!value) {
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
        "Prescription draft created successfully",
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

export const updatePrescriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const prescription = await updatePrescription(
      getRequiredParam(req, "appointmentId"),
      getActor(req),
      req.body,
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Prescription draft updated successfully",
        language,
      ),
      data: prescription,
    });
  },
);

export const addPrescriptionItemController = asyncHandler(
  async (req: Request, res: Response) => {
    const prescription = await addPrescriptionItem(
      getRequiredParam(req, "appointmentId"),
      getActor(req),
      req.body,
    );

    const language = getRequestedLanguage(req);

    res.status(201).json({
      success: true,
      message: await translateResponse(
        "Medicine added to prescription successfully",
        language,
      ),
      data: prescription,
    });
  },
);

export const updatePrescriptionItemController = asyncHandler(
  async (req: Request, res: Response) => {
    const prescription = await updatePrescriptionItem(
      getRequiredParam(req, "appointmentId"),
      getRequiredParam(req, "itemId"),
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
      data: prescription,
    });
  },
);

export const removePrescriptionItemController = asyncHandler(
  async (req: Request, res: Response) => {
    const prescription = await removePrescriptionItem(
      getRequiredParam(req, "appointmentId"),
      getRequiredParam(req, "itemId"),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Medicine removed from prescription successfully",
        language,
      ),
      data: prescription,
    });
  },
);

export const issuePrescriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const prescription = await issuePrescription(
      getRequiredParam(req, "appointmentId"),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Prescription issued successfully",
        language,
      ),
      data: prescription,
    });
  },
);
