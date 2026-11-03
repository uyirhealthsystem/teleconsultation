
import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./requireUser.middleware.js";

export interface PatientAgeRequest extends AuthenticatedRequest {
  patientAge: number;
}

export function requirePatientAge(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const ageHeader = req.header("x-patient-age");

  if (!ageHeader || !/^\d{1,3}$/.test(ageHeader)) {
    res.status(400).json({
      success: false,
      message: "Valid patient age is required",
    });
    return;
  }

  const patientAge = Number(ageHeader);

  if (patientAge < 0 || patientAge > 130) {
    res.status(400).json({
      success: false,
      message: "Invalid patient age",
    });
    return;
  }

  (req as PatientAgeRequest).patientAge = patientAge;

  next();
}
