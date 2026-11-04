
import { Router } from "express";

import {createFeedback,getFeedbackByAppointment,listMyFeedback} from "../controllers/feedback.controller.js";

const router = Router();

router.post("/appointments/:appointmentId/feedback/add",createFeedback);

router.get("/appointments/:appointmentId/feedback",getFeedbackByAppointment,);

router.get("/feedback/me", listMyFeedback);

export default router;
