/**
 * AI assist for eligibility (design §A.2). The model READS and EXTRACTS only —
 * it never decides. Findings are fed as pre-validated inputs to the rules engine.
 * Bound per tenant to a dedicated, region-pinned model (isolation + data
 * residency); prompt-injection-safe (documents are untrusted, extraction only).
 */
export interface AiDocumentFindings {
  /** Extracted profile fields disagree with the system record (e.g. name/ID). */
  documentMismatch: boolean;
  /** A required supporting document is missing or expired. */
  missingOrExpiredDoc: boolean;
  /** 0..1 — low confidence must keep a case out of the GREEN auto-approve band. */
  confidence: number;
  modelVersion: string;
}

export interface EligibilityAiPort {
  analyzeProfile(ctx: { tenantId: string; employeeId: string }): Promise<AiDocumentFindings>;
}

/** Default when no model is configured: contributes nothing (rules-only). */
export class NullEligibilityAi implements EligibilityAiPort {
  async analyzeProfile(): Promise<AiDocumentFindings> {
    return { documentMismatch: false, missingOrExpiredDoc: false, confidence: 1, modelVersion: 'null' };
  }
}
