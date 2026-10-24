
import type {
  Request,
  Response,
  NextFunction,
} from "express";

import {
  createHmac,
  //createHash,
  timingSafeEqual,
} from "node:crypto";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

const TIMESTAMP_TOLERANCE_SECONDS = 300;

export function verifyPaymentWebhook(
  req: RawBodyRequest,
  res: Response,
  next: NextFunction,
): void {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;

  // Temporary diagnostic: remove after testing.
  // if (secret) {
  //   console.log(
  //     "Server secret fingerprint:",
  //     createHash("sha256")
  //       .update(secret)
  //       .digest("hex")
  //       .slice(0, 12),
  //   );
  // }

  const signature = req.header("X-Payment-Signature");
  const timestamp = req.header("X-Payment-Timestamp");

  if (!secret) {
    res.status(500).json({
      success: false,
      message: "Payment webhook is not configured",
    });
    return;
  }

  if (
    !signature ||
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !req.rawBody
  ) {
    res.status(401).json({
      success: false,
      message: "Invalid payment webhook request",
    });
    return;
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) >
      TIMESTAMP_TOLERANCE_SECONDS
  ) {
    res.status(401).json({
      success: false,
      message: "Payment webhook timestamp is invalid or expired",
    });
    return;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(req.rawBody)
    .digest();

  const receivedSignature = Buffer.from(signature, "hex");

  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    res.status(401).json({
      success: false,
      message: "Invalid payment webhook signature",
    });
    return;
  }

  next();
}
