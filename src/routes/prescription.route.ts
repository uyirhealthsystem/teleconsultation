
import { Router } from "express";

import {
  createPrescriptionController,
  getPrescriptionController,
  updatePrescriptionController,
  addPrescriptionItemController,
  updatePrescriptionItemController,
  removePrescriptionItemController,
  issuePrescriptionController,
} from "../controllers/prescription.controller.js";

const router = Router();

// Create a prescription draft for an appointment
router.post(
  "/appointments/:appointmentId/prescription",
  createPrescriptionController,
);

// Retrieve the prescription for an appointment
router.get(
  "/appointments/:appointmentId/prescriptions",
  getPrescriptionController,
);

// Update prescription-level instructions
router.patch(
  "/appointments/:appointmentId/prescription",
  updatePrescriptionController,
);

// Add a medicine to the prescription
router.post(
  "/appointments/:appointmentId/prescription/items",
  addPrescriptionItemController,
);

// Update a medicine in the prescription
router.patch(
  "/appointments/:appointmentId/prescription/items/:itemId",
  updatePrescriptionItemController,
);

// Remove a medicine from the prescription
router.delete(
  "/appointments/:appointmentId/prescription/items/:itemId",
  removePrescriptionItemController,
);

// Issue the prescription after consultation ends
router.post(
  "/appointments/:appointmentId/prescription/issue",
  issuePrescriptionController,
);

export default router;
