
import type { Request, Response, NextFunction } from "express";
import {
  createDoctorAvailability,
  getDoctorAvailability,
  updateDoctorAvailability,
  updateDoctorAvailabilityStatus,
} from "../services/doctoravailability.service.js";
import { getAvailableSlots } from "../services/appointment.service.js";

export async function createAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const availability = await createDoctorAvailability(req.body);

    res.status(201).json({
      success: true,
      message: "Doctor availability created successfully",
      data: availability,
    });
  } catch (error) {
    next(error);
  }
}

export async function getAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const doctorId = req.params.doctorId as string;
    const availability = await getDoctorAvailability(doctorId);

    res.status(200).json({
      success: true,
      data: availability,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const availability = await updateDoctorAvailability(
      req.params.availabilityId as string,
      req.body,
    );

    res.status(200).json({
      success: true,
      message: "Doctor availability updated successfully",
      data: availability,
    });
  } catch (error) {
    next(error);
  }
}

export async function changeAvailabilityStatus(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      res.status(400).json({
        success: false,
        message: "isActive must be a boolean",
      });
      return;
    }

    const availability = await updateDoctorAvailabilityStatus(
      req.params.availabilityId as string,
      isActive,
    );

    res.status(200).json({
      success: true,
      message: "Doctor availability status updated successfully",
      data: availability,
    });
  } catch (error) {
    next(error);
  }
}

export async function getAvailabilitySlots(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const doctorId = req.params.doctorId as string;
    
    const date = req.query.date;

    if (typeof date !== "string") {
      res.status(400).json({
        success: false,
        message: "date query parameter is required (YYYY-MM-DD)",
      });
      return;
    }

    const slots = await getAvailableSlots(doctorId, date);

    res.status(200).json({
      success: true,
      data: slots,
    });
  } catch (error) {
    next(error);
  }
}
