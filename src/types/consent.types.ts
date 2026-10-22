
import type {ConsentType,SignatureMethod} from "../generated/prisma/client.js";

export interface CreateConsentInput {
  consentType: ConsentType;
  signerName: string;
  signerRelationship?: string;
  signerAuthority?: string;
  consentVersion: string;
  consentText: string;
  signatureMethod?: SignatureMethod;
}

export interface RevokeConsentInput {
  reason: string;
}
