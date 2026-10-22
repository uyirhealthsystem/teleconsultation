
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

router.get("/:doctorId/slots", getAvailabilitySlots);
router.get("/:doctorId", getAvailability);

router.put("/:availabilityId", updateAvailability);
router.patch("/:availabilityId/status", changeAvailabilityStatus);

export default router;
