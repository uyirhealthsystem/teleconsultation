
import type { Request, Response } from "express";

import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

import {createConsultationNote,getConsultationNote,updateConsultationNote,finalizeConsultationNote} from "../services/consultation.notes.service.js";

import type { ConsultationNoteActor } from "../services/consultation.notes.service.js";

import {getRequestedLanguage,translateResponse} from "../utils/translate.response.js";

function getActor(req: Request): ConsultationNoteActor {
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
  name: "appointmentId" | "noteId",
): string {
  const value = req.params[name] as string;

  if (!value) {
    throw new ApiError(400, `${name} is required`);
  }

  return value;
}

export const createNote = asyncHandler(
  async (req: Request, res: Response) => {
    const note = await createConsultationNote(
      getRequiredParam(req, "appointmentId"),
      getActor(req),
      req.body,
    );

    const language = getRequestedLanguage(req);

    res.status(201).json({
      success: true,
      message: await translateResponse(
        "Consultation note draft created successfully",
        language,
      ),
      data: await translateResponse(note, language),
    });
  },
);

export const getNote = asyncHandler(
  async (req: Request, res: Response) => {
    const note = await getConsultationNote(
      getRequiredParam(req, "appointmentId"),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Consultation note retrieved successfully",
        language,
      ),
      data: await translateResponse(note, language),
    });
  },
);

export const updateNote = asyncHandler(
  async (req: Request, res: Response) => {
    const note = await updateConsultationNote(
      getRequiredParam(req, "appointmentId"),
      getRequiredParam(req, "noteId"),
      getActor(req),
      req.body,
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Consultation note draft updated successfully",
        language,
      ),
      data: await translateResponse(note, language),
    });
  },
);

export const finalizeNote = asyncHandler(
  async (req: Request, res: Response) => {
    const note = await finalizeConsultationNote(
      getRequiredParam(req, "appointmentId"),
      getRequiredParam(req, "noteId"),
      getActor(req),
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Consultation note finalized successfully",
        language,
      ),
      data: await translateResponse(note, language),
    });
  },
);
