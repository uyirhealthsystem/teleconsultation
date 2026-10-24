
import { ApiError } from "../utils/ApiError.js";

interface CreatePaymentIntentInput {
  appointmentId: string;
  payerId: string;
  authorizationHeader?: string;
  description?: string;
}

interface PaymentIntentResponse {
  id: string;
  status: string;
  checkoutUrl: string;
  amount: number;
  currency: string;
  referenceId: string;
}

interface PaymentIntentApiResponse {
  id: string;
  status: string;
  checkoutUrl: string;
  amount: number;
  currency: string;
  referenceId: string;
}

function getPaymentConfig(): {
  baseUrl: string;
  amount: number;
} {
  const baseUrl = process.env.PAYMENT_SERVICE_URL?.trim();
  const feeText = process.env.TELECONSULTATION_FEE_INR?.trim();

  if (!baseUrl || !feeText) {
    throw new ApiError(
      500,
      "Payment Service URL or consultation fee is not configured",
    );
  }

  const amount = Number(feeText);

  if (
    !Number.isFinite(amount) ||
    amount < 1 ||
    Math.round(amount * 100) !== amount * 100
  ) {
    throw new ApiError(
      500,
      "TELECONSULTATION_FEE_INR must be at least 1 INR with at most 2 decimal places",
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    amount,
  };
}

function isPaymentIntentResponse(
  value: unknown,
): value is PaymentIntentApiResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const result = value as Record<string, unknown>;

  return (
    typeof result.id === "string" &&
    result.id.length > 0 &&
    typeof result.status === "string" &&
    typeof result.checkoutUrl === "string" &&
    result.checkoutUrl.length > 0 &&
    typeof result.amount === "number" &&
    Number.isFinite(result.amount) &&
    result.currency === "INR" &&
    typeof result.referenceId === "string" &&
    result.referenceId.length > 0
  );
}

export async function createTeleconsultationPaymentIntent(
  input: CreatePaymentIntentInput,
): Promise<PaymentIntentResponse> {
  const { baseUrl, amount } = getPaymentConfig();

  if (!input.authorizationHeader?.startsWith("Bearer ")) {
    throw new ApiError(
      401,
      "A valid user access token is required to initiate payment",
    );
  }

  if (!input.appointmentId?.trim() || !input.payerId?.trim()) {
    throw new ApiError(
      400,
      "Appointment ID and payer ID are required",
    );
  }

  let response: globalThis.Response;

  try {
    response = await fetch(`${baseUrl}/api/payments/intents`, {
      method: "POST",
      headers: {
        Authorization: input.authorizationHeader,
        "Content-Type": "application/json",
        "Idempotency-Key": `teleconsult-${input.appointmentId}`,
      },
      body: JSON.stringify({
        referenceType: "TELECONSULTATION",
        referenceId: input.appointmentId,
        payerId: input.payerId,
        amount,
        currency: "INR",
        description:
          input.description ??
          "Uyir Health teleconsultation appointment",
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error: unknown) {
    // Do not log the JWT or request headers.
    console.error("Payment Service connection failed:", {
      message:
        error instanceof Error ? error.message : "Unknown connection error",
    });

    throw new ApiError(
      502,
      "Payment Service could not be reached. Please retry payment",
    );
  }

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");

    // Diagnostic logging: never log authorization tokens or secrets.
    console.error("Payment Service request failed:", {
      status: response.status,
      body: responseBody.slice(0, 2000),
    });

    if (response.status === 503) {
      throw new ApiError(
        503,
        "Payment Service is temporarily unavailable. Please retry",
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        502,
        "Payment Service rejected the user authentication",
      );
    }

    if (response.status === 409) {
      throw new ApiError(
        409,
        "Payment intent conflicts with an existing payment request",
      );
    }

    throw new ApiError(
      502,
      `Failed to create payment intent (Payment Service HTTP ${response.status})`,
    );
  }

  let result: unknown;

  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      502,
      "Payment Service returned an invalid JSON response",
    );
  }

  if (!isPaymentIntentResponse(result)) {
    console.error("Payment Service returned an unexpected response format");

    throw new ApiError(
      502,
      "Payment Service returned an incomplete or invalid payment intent",
    );
  }

  if (result.referenceId !== input.appointmentId) {
    throw new ApiError(
      502,
      "Payment Service returned a mismatched appointment reference",
    );
  }

  if (Math.round(result.amount * 100) !== Math.round(amount * 100)) {
    throw new ApiError(
      502,
      "Payment Service returned an unexpected payment amount",
    );
  }

  return {
    id: result.id,
    status: result.status,
    checkoutUrl: result.checkoutUrl,
    amount: result.amount,
    currency: result.currency,
    referenceId: result.referenceId,
  };
}
