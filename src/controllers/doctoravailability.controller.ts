
import type { Request, Response, NextFunction } from "express";

import {
  createDoctorAvailability,
  getDoctorAvailability,
  updateDoctorAvailability,
  updateDoctorAvailabilityStatus,
} from "../services/doctoravailability.service.js";

import { getAvailableSlots } from "../services/appointment.service.js";

// CREATE DOCTOR AVAILABILITY
export async function createAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const {
      doctorId,
      days,
      dayOfWeek,
      startTime,
      endTime,
      slotDurationMinutes,
      hospitalId,
    } = req.body;

    if (!doctorId || typeof doctorId !== "string" || !doctorId.trim()) {
      res.status(400).json({
        success: false,
        message: "doctorId is required",
      });
      return;
    }

    // Support both days and dayOfWeek
    // Accept single number or array
    const rawDays = days !== undefined ? days : dayOfWeek;

    const selectedDays =
      rawDays === undefined
        ? []
        : Array.isArray(rawDays)
          ? rawDays
          : [rawDays];

    if (
      selectedDays.length === 0 ||
      selectedDays.some(
        (day: unknown) =>
          typeof day !== "number" ||
          !Number.isInteger(day) ||
          day < 0 ||
          day > 6,
      )
    ) {
      res.status(400).json({
        success: false,
        message: "days must contain integer values between 0 and 6",
      });
      return;
    }

    if (new Set(selectedDays).size !== selectedDays.length) {
      res.status(400).json({
        success: false,
        message: "Duplicate days are not allowed",
      });
      return;
    }

    if (
      typeof startTime !== "string" ||
      typeof endTime !== "string"
    ) {
      res.status(400).json({
        success: false,
        message: "startTime and endTime are required",
      });
      return;
    }

    const availability = await createDoctorAvailability({
      doctorId,
      hospitalId,
      days: selectedDays,
      startTime,
      endTime,
      slotDurationMinutes,
    });

    res.status(201).json({
      success: true,
      message: "Doctor availability created successfully",
      data: availability,
    });
  } catch (error) {
    next(error);
  }
}

// GET DOCTOR AVAILABILITY
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

// UPDATE DOCTOR AVAILABILITY
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

// ACTIVATE / DEACTIVATE AVAILABILITY
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

// GET AVAILABLE APPOINTMENT SLOTS
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
