
import { createHash } from "node:crypto";

import {
  ConsentStatus,
  ConsentType,
  SignatureMethod,
} from "../generated/prisma/client.js";

import { prisma } from "./prisma.service.js";
import type { CreateConsentInput } from "../types/consent.types.js";
import { ApiError } from "../utils/ApiError.js";

function hashText(text: string): string {
  return createHash("sha256")
    .update(text, "utf8")
    .digest("hex");
}

async function getAppointmentWithValidatedAge(
  appointmentId: string,
) {
  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
  });

  if (!appointment) {
    throw new ApiError(404, "Appointment not found");
  }

  if (appointment.status === "CANCELLED") {
    throw new ApiError(
      409,
      "Consent cannot be processed for a cancelled appointment",
    );
  }

  const patientAge = appointment.patientAgeAtBooking;

  if (patientAge === null || patientAge === undefined) {
    throw new ApiError(
      409,
      "Patient age was not recorded for this appointment",
    );
  }

  if (
    !Number.isInteger(patientAge) ||
    patientAge < 0 ||
    patientAge > 130
  ) {
    throw new ApiError(
      409,
      "Invalid patient age stored on appointment",
    );
  }

  const expectedCategory = patientAge >= 18 ? "ADULT" : "MINOR";

  if (appointment.patientCategory !== expectedCategory) {
    throw new ApiError(
      409,
      "Patient category does not match the age recorded for this appointment",
    );
  }

  return {
    appointment,
    patientAge,
  };
}

/**
 * Create minor guardian consent.
 *
 * Current temporary policy:
 * Only the appointment booker can sign.
 * This does not independently verify legal guardian status.
 */
export async function createConsent(
  appointmentId: string,
  signerUserId: string,
  signerRole: string,
  input: CreateConsentInput,
) {
  if (!signerUserId || !signerRole) {
    throw new ApiError(401, "Authentication is required");
  }

  if (!input || typeof input !== "object") {
    throw new ApiError(400, "Valid consent details are required");
  }

  if (!input.signerName?.trim()) {
    throw new ApiError(400, "Signer name is required");
  }

  if (!input.consentVersion?.trim() || !input.consentText?.trim()) {
    throw new ApiError(
      400,
      "Consent version and consent text are required",
    );
  }

  if (!Object.values(ConsentType).includes(input.consentType)) {
    throw new ApiError(400, "Invalid consent type");
  }

  if (
    input.signatureMethod &&
    !Object.values(SignatureMethod).includes(input.signatureMethod)
  ) {
    throw new ApiError(400, "Invalid signature method");
  }

  const { appointment, patientAge } =
    await getAppointmentWithValidatedAge(appointmentId);

  if (patientAge >= 18) {
    throw new ApiError(
      400,
      "Consent is not required for adult patients",
    );
  }

  if (input.consentType !== ConsentType.MINOR_GUARDIAN) {
    throw new ApiError(
      400,
      "Only minor guardian consent is supported in the current consent flow",
    );
  }

  if (appointment.bookedByUserId !== signerUserId) {
    throw new ApiError(
      403,
      "Only the authorized appointment booker can currently provide minor guardian consent",
    );
  }

  if (signerUserId === appointment.patientId) {
    throw new ApiError(
      403,
      "A minor cannot provide their own guardian consent",
    );
  }

  if (!input.signerAuthority?.trim()) {
    throw new ApiError(
      400,
      "Guardian authority must be provided",
    );
  }

  const consentTextHash = hashText(input.consentText);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.consentRecord.findFirst({
      where: {
        appointmentId,
        consentType: ConsentType.MINOR_GUARDIAN,
        status: ConsentStatus.SIGNED,
        revokedAt: null,
      },
    });

    if (existing) {
      throw new ApiError(
        409,
        "Guardian consent has already been recorded",
      );
    }

    const consent = await tx.consentRecord.create({
      data: {
        appointmentId,
        consentType: ConsentType.MINOR_GUARDIAN,
        status: ConsentStatus.SIGNED,
        signerUserId,
        signerName: input.signerName.trim(),
        signerRelationship: input.signerRelationship?.trim(),
        signerAuthority: input.signerAuthority?.trim(),
        consentVersion: input.consentVersion.trim(),
        consentTextHash,
        signatureMethod:
          input.signatureMethod ??
          SignatureMethod.ELECTRONIC_ATTESTATION,
        signedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: signerUserId,
        actorRole: signerRole,
        action: "CONSENT_RECORDED",
        entityType: "ConsentRecord",
        entityId: consent.consentId,
        metadata: {
          appointmentId,
          consentType: ConsentType.MINOR_GUARDIAN,
          consentVersion: input.consentVersion,
          consentTextHash,
          patientAge,
        },
      },
    });

    return consent;
  });
}

/**
 * Retrieve appointment consent records.
 */
export async function getAppointmentConsents(
  appointmentId: string,
  requesterUserId: string,
  requesterRole: string,
) {
  if (!requesterUserId || !requesterRole) {
    throw new ApiError(401, "Authentication is required");
  }

  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
    include: { consents: true },
  });

  if (!appointment) {
    throw new ApiError(404, "Appointment not found");
  }

  const role = requesterRole.trim().toUpperCase();

  const isParticipant =
    appointment.bookedByUserId === requesterUserId ||
    appointment.patientId === requesterUserId ||
    appointment.doctorId === requesterUserId;

  const isAdmin = ["ADMIN", "HOSPITAL_ADMIN"].includes(role);

  if (!isParticipant && !isAdmin) {
    throw new ApiError(
      403,
      "You are not authorized to view these consent records",
    );
  }

  return appointment.consents;
}

/**
 * Revoke consent.
 * Only the original signer can revoke their signed consent.
 */
export async function revokeConsent(
  appointmentId: string,
  consentId: string,
  signerUserId: string,
  signerRole: string,
  reason: string,
) {
  if (!signerUserId || !signerRole) {
    throw new ApiError(401, "Authentication is required");
  }

  if (!reason?.trim()) {
    throw new ApiError(400, "Revocation reason is required");
  }

  return prisma.$transaction(async (tx) => {
    const consent = await tx.consentRecord.findFirst({
      where: {
        consentId,
        appointmentId,
      },
    });

    if (!consent) {
      throw new ApiError(404, "Consent record not found");
    }

    if (consent.signerUserId !== signerUserId) {
      throw new ApiError(
        403,
        "Only the original signer can revoke this consent",
      );
    }

    if (consent.status !== ConsentStatus.SIGNED) {
      throw new ApiError(
        409,
        "Only signed consent can be revoked",
      );
    }

    const updated = await tx.consentRecord.update({
      where: { consentId },
      data: {
        status: ConsentStatus.REVOKED,
        revokedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: signerUserId,
        actorRole: signerRole,
        action: "CONSENT_REVOKED",
        entityType: "ConsentRecord",
        entityId: consentId,
        metadata: {
          appointmentId,
          reason: reason.trim(),
        },
      },
    });

    return updated;
  });
}

/**
 * Verify existing signed consent.
 * This function never creates consent records.
 *
 * The optional patientAge argument is retained temporarily
 * for compatibility with existing callers, but never trusted.
 */
export async function assertAppointmentHasSignedConsent(
  appointmentId: string,
  requiredConsentType: ConsentType,
  patientAge?: number,
) {
  const { appointment, patientAge: storedAge } =
    await getAppointmentWithValidatedAge(appointmentId);

  if (
    patientAge !== undefined &&
    patientAge !== storedAge
  ) {
    throw new ApiError(
      409,
      "Provided patient age does not match the appointment record",
    );
  }

  if (storedAge >= 18) {
    return null;
  }

  if (requiredConsentType !== ConsentType.MINOR_GUARDIAN) {
    throw new ApiError(
      400,
      "Only minor guardian consent is supported",
    );
  }

  const consent = await prisma.consentRecord.findFirst({
    where: {
      appointmentId,
      consentType: ConsentType.MINOR_GUARDIAN,
      status: ConsentStatus.SIGNED,
      revokedAt: null,
      signedAt: { not: null },
      signerUserId: {
        equals: appointment.bookedByUserId,
        not: appointment.patientId,
      },
    },
  });

  if (!consent) {
    throw new ApiError(
      403,
      "Guardian consent is required for minor patients",
    );
  }

  return consent;
}
