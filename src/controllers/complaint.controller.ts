
import type { Request, Response, NextFunction } from "express";

import type { AuthenticatedRequest } from "../middlewares/requireUser.middleware.js";
import {
  ComplaintCategory,
} from "../generated/prisma/client.js";
import {
  lodgeComplaint,
  getMyComplaints,
  getComplaintDetails,
  cancelComplaint,
} from "../services/complaint.service.js";

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

export async function createComplaint(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const actor = getAuthenticatedActor(req);

    const {
      appointmentId,
      category,
      subject,
      description,
    } = req.body;

    if (
      typeof appointmentId !== "string" ||
      !appointmentId.trim() ||
      typeof category !== "string" ||
      !category.trim() ||
      typeof subject !== "string" ||
      !subject.trim() ||
      typeof description !== "string" ||
      !description.trim()
    ) {
      throw new ApiError(
        400,
        "appointmentId, category, subject and description are required",
      );
    }

    const complaint = await lodgeComplaint(actor, {
      appointmentId: appointmentId.trim(),
      category: category as ComplaintCategory,
      subject: subject.trim(),
      description: description.trim(),
    });

    const language = getRequestedLanguage(req);

    res.status(201).json({
      success: true,
      message: await translateResponse(
        "Complaint submitted successfully",
        language,
      ),
      data: await translateResponse(complaint, language),
    });
  } catch (error) {
    next(error);
  }
}

export async function listMyComplaints(
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

    const result = await getMyComplaints(actor, page, limit);

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Complaints retrieved successfully",
        language,
      ),
      data: await translateResponse(result.complaints, language),
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}

export async function getComplaint(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const actor = getAuthenticatedActor(req);
    const complaintId = req.params.complaintId as string;

    if (!complaintId?.trim()) {
      throw new ApiError(400, "complaintId is required");
    }

    const complaint = await getComplaintDetails(
      complaintId,
      actor,
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Complaint retrieved successfully",
        language,
      ),
      data: await translateResponse(complaint, language),
    });
  } catch (error) {
    next(error);
  }
}

export async function cancelMyComplaint(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const actor = getAuthenticatedActor(req);
    const complaintId = req.params.complaintId as string;

    if (!complaintId?.trim()) {
      throw new ApiError(400, "complaintId is required");
    }

    const complaint = await cancelComplaint(
      complaintId,
      actor,
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Complaint cancelled successfully",
        language,
      ),
      data: await translateResponse(complaint, language),
    });
  } catch (error) {
    next(error);
  }
}
