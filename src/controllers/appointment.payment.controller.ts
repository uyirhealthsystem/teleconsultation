
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { retryAppointmentPayment } from "../services/appointment.payment.service.js";

export const retryPaymentController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.headers["x-user-id"];
    const authorizationHeader = req.headers.authorization;

    if (typeof userId !== "string" || !userId.trim()) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const payment = await retryAppointmentPayment(
      req.params.appointmentId as string,
      userId,
      authorizationHeader,
    );

    res.status(200).json({
      success: true,
      message: "Payment intent created successfully",
      data: payment,
    });
  },
);
