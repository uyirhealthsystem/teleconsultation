
import { createHash } from "node:crypto";
import {ConsentStatus,ConsentType,SignatureMethod} from "../generated/prisma/client.js";
import { prisma } from "./prisma.service.js";
import type { CreateConsentInput } from "../types/consent.types.js";
import { ApiError } from "../utils/ApiError.js";



function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function createConsent(
  appointmentId: string,
  signerUserId: string,
  signerRole: string,
  input: CreateConsentInput,
) {
  if (!input.signerName.trim()) {
    throw new ApiError(400,"Signer name is required");
  }

  if (!input.consentVersion.trim() || !input.consentText.trim()) {
    throw new ApiError(400,
      "Consent version and consent text are required",
      
    );
  }

  if (!Object.values(ConsentType).includes(input.consentType)) {
    throw new ApiError(400,"Invalid consent type");
  }

  if (
    input.signatureMethod &&
    !Object.values(SignatureMethod).includes(input.signatureMethod)
  ) {
    throw new ApiError(400,"Invalid signature method");
  }

  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
  });

  if (!appointment) {
    throw new ApiError( 404,"Appointment not found");
  }

  if (appointment.status === "CANCELLED") {
    throw new ApiError(
        409,
      "Consent cannot be recorded for a cancelled appointment",
      
    );
  }

  if (
    appointment.bookedByUserId !== signerUserId &&
    appointment.patientId !== signerUserId
  ) {
    throw new ApiError(
        403,
      "You are not authorized to record consent for this appointment",
      
    );
  }

  if (
    input.consentType === ConsentType.MINOR_GUARDIAN &&
    !input.signerAuthority?.trim()
  ) {
    throw new ApiError(
        400,
      "Guardian authority must be provided for minor consent",
      
    );
  }

  if (
    input.consentType === ConsentType.REPRESENTATIVE &&
    !input.signerAuthority?.trim()
  ) {
    throw new ApiError(
        400,
      "Representative authority must be provided",
      
    );
  }

  const consentTextHash = hashText(input.consentText);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.consentRecord.findFirst({
      where: {
        appointmentId,
        consentType: input.consentType,
        signerUserId,
        status: ConsentStatus.SIGNED,
      },
    });

    if (existing) {
      throw new ApiError(409,
        "This consent has already been recorded",
        
      );
    }

    const consent = await tx.consentRecord.create({
      data: {
        appointmentId,
        consentType: input.consentType,
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
          consentType: input.consentType,
          consentVersion: input.consentVersion,
          consentTextHash,
        },
      },
    });

    return consent;
  });
}

export async function getAppointmentConsents(
  appointmentId: string,
  requesterUserId: string,
  requesterRole: string,
) {
  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId },
    include: { consents: true },
  });

  if (!appointment) {
    throw new ApiError(404,"Appointment not found");
  }

  const isParticipant =
    appointment.bookedByUserId === requesterUserId ||
    appointment.patientId === requesterUserId ||
    appointment.doctorId === requesterUserId;

  if (!isParticipant && !["ADMIN", "HOSPITAL_ADMIN"].includes(requesterRole)) {
    throw new ApiError(403,
      "You are not authorized to view these consent records",
      
    );
  }

  return appointment.consents;
}

export async function revokeConsent(
  appointmentId: string,
  consentId: string,
  signerUserId: string,
  signerRole: string,
  reason: string,
) {
  if (!reason.trim()) {
    throw new ApiError(400,"Revocation reason is required", );
  }

  return prisma.$transaction(async (tx) => {
    const consent = await tx.consentRecord.findFirst({
      where: {
        consentId,
        appointmentId,
      },
      include: {
        appointment: true,
      },
    });

    if (!consent) {
      
      throw new ApiError(404,"Consent record not found");
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


export async function assertAppointmentHasSignedConsent(
  appointmentId: string,
  requiredConsentType: ConsentType,
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
      "Consent cannot be validated for a cancelled appointment",
    );
  }

  const consent = await prisma.consentRecord.findFirst({
    where: {
      appointmentId,
      consentType: requiredConsentType,
      status: ConsentStatus.SIGNED,
    },
  });

  if (!consent) {
    throw new ApiError(
      403,
      "Required consent has not been signed",
    );
  }

  return consent;
}
