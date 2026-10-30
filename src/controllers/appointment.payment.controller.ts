
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/requireUser.middleware.js";

import { asyncHandler } from "../utils/asyncHandler.js";
import { retryAppointmentPayment } from "../services/appointment.payment.service.js";
import { ApiError } from "../utils/ApiError.js";

export const retryPaymentController = asyncHandler(
  async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    const userId = authReq.userId;
    const authorizationHeader = req.headers.authorization;

    if (!userId?.trim()) {
      throw new ApiError(401, "Authentication required");
    }

    if (
      typeof authorizationHeader !== "string" ||
      !authorizationHeader.startsWith("Bearer ")
    ) {
      throw new ApiError(401, "Valid access token is required");
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
