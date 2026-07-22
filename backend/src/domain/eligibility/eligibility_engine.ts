/**
 * Eligibility decision engine (design: docs/etms/11 §A.1).
 *
 * Rules-first and deterministic: hard gates must all pass, then a weighted risk
 * score maps to a band. AI output enters only as pre-validated inputs
 * (aiDocumentMismatch); the AI never decides here.
 */
export interface EligibilityWeights {
  distancePerKm: number;
  minorViolation: number;
  docMismatch: number;
  missingDoc: number;
  shortTenure: number;
  residenceReduction: number;
}

export const DEFAULT_WEIGHTS: EligibilityWeights = {
  distancePerKm: 8,
  minorViolation: 15,
  docMismatch: 25,
  missingDoc: 20,
  shortTenure: 10,
  residenceReduction: 20,
};

export interface EligibilityPolicy {
  serviceRadiusKm: number;
  greenMax: number;
  amberMax: number;
  weights?: Partial<EligibilityWeights>;
}

export interface EligibilityInput {
  // hard-gate facts
  employeeStatus: string;
  eligibleFlag: boolean;
  employeeNumberMatches: boolean;
  hasActiveTransportBlock: boolean;
  employmentEnded: boolean;
  isResidenceMember: boolean;
  homeLocationKnown: boolean;
  // soft-risk facts
  homeDistanceKm?: number | null;
  activeMinorViolations?: number;
  aiDocumentMismatch?: boolean;
  missingOrExpiredDoc?: boolean;
  shortTenure?: boolean;
}

export type Band = 'green' | 'amber' | 'red';
export type Outcome = 'approved' | 'needs_review' | 'rejected';

export interface EligibilityResult {
  band: Band;
  outcome: Outcome;
  riskScore: number;
  hardGateResults: { gate: string; passed: boolean }[];
  riskBreakdown: { factor: string; points: number }[];
  reasons: string[];
}

export function evaluateEligibility(
  input: EligibilityInput,
  policy: EligibilityPolicy,
): EligibilityResult {
  const w = { ...DEFAULT_WEIGHTS, ...(policy.weights ?? {}) };

  const gates: { gate: string; passed: boolean }[] = [
    { gate: 'employee_active', passed: input.employeeStatus === 'active' },
    { gate: 'eligible_flag', passed: input.eligibleFlag },
    { gate: 'employee_number_matches', passed: input.employeeNumberMatches },
    { gate: 'no_transport_block', passed: !input.hasActiveTransportBlock },
    { gate: 'employment_active', passed: !input.employmentEnded },
    { gate: 'pickup_basis', passed: input.isResidenceMember || input.homeLocationKnown },
  ];

  const failed = gates.filter((g) => !g.passed);
  if (failed.length > 0) {
    return {
      band: 'red',
      outcome: 'rejected',
      riskScore: 100,
      hardGateResults: gates,
      riskBreakdown: [],
      reasons: failed.map((g) => `hard_gate_failed:${g.gate}`),
    };
  }

  const breakdown: { factor: string; points: number }[] = [];
  const add = (factor: string, points: number) => {
    if (points !== 0) breakdown.push({ factor, points });
  };

  if (input.homeDistanceKm != null && input.homeDistanceKm > policy.serviceRadiusKm) {
    const overKm = Math.ceil(input.homeDistanceKm - policy.serviceRadiusKm);
    add('distance_over_radius', overKm * w.distancePerKm);
  }
  add('minor_violations', (input.activeMinorViolations ?? 0) * w.minorViolation);
  if (input.aiDocumentMismatch) add('ai_document_mismatch', w.docMismatch);
  if (input.missingOrExpiredDoc) add('missing_or_expired_doc', w.missingDoc);
  if (input.shortTenure) add('short_tenure', w.shortTenure);
  if (input.isResidenceMember) add('residence_member', -w.residenceReduction);

  const raw = breakdown.reduce((s, b) => s + b.points, 0);
  const riskScore = Math.max(0, Math.min(100, raw));

  const band: Band =
    riskScore <= policy.greenMax ? 'green' : riskScore <= policy.amberMax ? 'amber' : 'red';
  const outcome: Outcome =
    band === 'green' ? 'approved' : band === 'amber' ? 'needs_review' : 'rejected';

  return {
    band,
    outcome,
    riskScore,
    hardGateResults: gates,
    riskBreakdown: breakdown,
    reasons: band === 'green' ? ['auto_approved'] : breakdown.map((b) => b.factor),
  };
}
