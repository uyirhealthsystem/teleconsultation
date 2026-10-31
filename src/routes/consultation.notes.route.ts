
import { Router } from "express";

import {createNote,getNote,updateNote,finalizeNote} from "../controllers/consultation.notes.controller.js";

const router = Router();

router.post(
  "/appointments/:appointmentId/notes",
  createNote,
);

router.get(
  "/appointments/:appointmentId/notes",
  getNote,
);

router.patch(
  "/appointments/:appointmentId/notes/:noteId",
  updateNote,
);

router.post(
  "/appointments/:appointmentId/notes/:noteId/finalize",
  finalizeNote,
);

export default router;
