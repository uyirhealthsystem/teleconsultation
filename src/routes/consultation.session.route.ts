
import { Router } from "express";

import {
  createSession,
  getSession,
  patientCheckIn,
  doctorMarkDelay,
  doctorStartConsultation,
  doctorEndConsultation,
} from "../controllers/consultation.session.controller.js";

const router = Router();

router.post(
  "/appointments/:appointmentId/session",
  createSession,
);

router.get(
  "/appointments/:appointmentId/sessions",
  getSession,
);

router.post(
  "/appointments/:appointmentId/session/check-in",
  patientCheckIn,
);

router.post(
  "/appointments/:appointmentId/session/delay",
  doctorMarkDelay,
);

router.post(
  "/appointments/:appointmentId/session/start",
  doctorStartConsultation,
);

router.post(
  "/appointments/:appointmentId/session/end",
  doctorEndConsultation,
);

export default router;

