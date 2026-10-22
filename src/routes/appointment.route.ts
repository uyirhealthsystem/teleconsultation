import { Router } from "express";
import * as appointmentController from "../controllers/appointment.controller.js";
import { requireUser } from "../middlewares/requireUser.middleware.js";

const router = Router();

router.get("/availability/doctors/:doctorId", requireUser, appointmentController.getAvailableSlotsController);
router.post("/appointment", requireUser, appointmentController.bookAppointmentController);
router.get("/me", requireUser, appointmentController.getMyAppointments);

router.patch("/:appointmentId/cancel", requireUser, appointmentController.cancelAppointmentController);
router.patch("/:appointmentId/reschedule", requireUser, appointmentController.rescheduleAppointmentController);

router.get("/:appointmentId", requireUser, appointmentController.getAppointmentById);

export default router