
import { Router } from "express";
import {
  createComplaint,
  listMyComplaints,
  getComplaint,
  cancelMyComplaint,
} from "../controllers/complaint.controller.js";

const router = Router();

router.post("/complaint/add", createComplaint);
router.get("/complaints/me", listMyComplaints);
router.get("/complaints/:complaintId", getComplaint);
router.patch("/complaints/:complaintId/cancel", cancelMyComplaint);

export default router;
