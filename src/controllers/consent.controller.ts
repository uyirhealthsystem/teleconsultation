
import type { Request, Response, NextFunction } from "express";

import * as consentService from "../services/consent.service.js";

import {getRequestedLanguage,translateResponse} from "../utils/translate.response.js";

function getUser(req: Request) {
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

export async function createConsentController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { userId, role } = getUser(req);

    const consent = await consentService.createConsent(
      req.params.appointmentId as string,
      userId,
      role,
      req.body,
    );

    const language = getRequestedLanguage(req);

    res.status(201).json({
      success: true,
      message: await translateResponse(
        "Consent recorded successfully",
        language,
      ),
      data: await translateResponse(consent, language),
    });
  } catch (error) {
    next(error);
  }
}

export async function getConsentsController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { userId, role } = getUser(req);

    const consents = await consentService.getAppointmentConsents(
      req.params.appointmentId as string,
      userId,
      role,
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Consents retrieved successfully",
        language,
      ),
      data: await translateResponse(consents, language),
    });
  } catch (error) {
    next(error);
  }
}

export async function revokeConsentController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { userId, role } = getUser(req);

    const consent = await consentService.revokeConsent(
      req.params.appointmentId as string,
      req.params.consentId as string,
      userId,
      role,
      req.body.reason,
    );

    const language = getRequestedLanguage(req);

    res.status(200).json({
      success: true,
      message: await translateResponse(
        "Consent revoked successfully",
        language,
      ),
      data: await translateResponse(consent, language),
    });
  } catch (error) {
    next(error);
  }
}
