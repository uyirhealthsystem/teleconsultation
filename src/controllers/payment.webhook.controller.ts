
import type { Request, Response } from "express";

import { asyncHandler } from "../utils/asyncHandler.js";
import { processPaymentWebhook } from "../services/payment.webhook.service.js";

export const handlePaymentWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await processPaymentWebhook(req.body);

    res.status(200).json({
      success: true,
      message: "Payment webhook processed successfully",
      data: result,
    });
  },
);
