
import { Router } from "express";
import {
  createConsentController,
  getConsentsController,
  revokeConsentController,
} from "../controllers/consent.controller.js";

const router = Router();

router.post(
  "/appointments/:appointmentId/consent",
  createConsentController,
);

router.get(
  "/appointments/:appointmentId/consent",
  getConsentsController,
);

router.post(
  "/appointments/:appointmentId/consent/:consentId/revoke",
  revokeConsentController,
);

export default router;



