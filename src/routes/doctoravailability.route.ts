
import { Router } from "express";
import {
  createAvailability,
  getAvailability,
  updateAvailability,
  changeAvailabilityStatus,
  getAvailabilitySlots,
} from "../controllers/doctoravailability.controller.js";

const router = Router();

router.post("/doctoravailability", createAvailability);

router.get("/availability/doctors/:doctorId/slots", getAvailabilitySlots);
router.get("/:doctorId", getAvailability);

router.put("/doctoravailability/:availabilityId", updateAvailability);
router.patch("/doctoravailability/:availabilityId/status", changeAvailabilityStatus);

export default router;
