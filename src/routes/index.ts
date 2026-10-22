import { Router } from 'express';

import appointmentRouter from './appointment.route'
import consentRouter from './consent.route'
import doctoravailabiltyRouter from './doctoravailability.route'
import consultationsessionRouter from './consultation.session.route'
import consultationnotesRouter from './consultation.notes.route'
import prescriptionRouter from './prescription.route'

const router = Router();

router.use('/',appointmentRouter)
router.use('/',consentRouter)
router.use('/',doctoravailabiltyRouter)
router.use('/',consultationsessionRouter)
router.use('/',consultationnotesRouter)
router.use('/',prescriptionRouter)

export default router;
