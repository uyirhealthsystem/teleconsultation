
import { Router } from "express";

import { handlePaymentWebhook } from "../controllers/payment.webhook.controller.js";
import { verifyPaymentWebhook } from "../middlewares/verifyPaymentWebhook.middleware.js"

const router = Router();

router.post("/", verifyPaymentWebhook, handlePaymentWebhook);

export default router;
