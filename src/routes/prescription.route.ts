import { Router } from "express";

import {
  createPrescriptionController,
  getPrescriptionController,
} from "../controllers/prescription.controller.js";

const router = Router();

/**
 * Create and issue a prescription for an appointment.
 * Only the assigned doctor can perform this operation.
 */
router.post(
  "/appointments/:appointmentId/prescription",
  createPrescriptionController,
);

/**
 * Retrieve a prescription for a specific appointment.
 * The assigned doctor or actual patient may access it.
 */
router.get(
  "/appointments/:appointmentId/prescription/me",
  getPrescriptionController,
);

export default router;