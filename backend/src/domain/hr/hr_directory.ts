/**
 * HR directory integration (design docs/etms/11 §A.4.1). The decision engine
 * depends on this port, never on a specific HR product, so SAP SuccessFactors
 * (source of truth) and any future system are pluggable adapters.
 */
export interface HrRecord {
  /** HR system person id → matches employee.external_hr_id */
  externalRef: string;
  transportBlock: boolean;
  employmentEnded: boolean;
  lastModified?: string;
}

export interface HrDirectoryPort {
  /** Delta since `since` (or a full pull when omitted). */
  fetchChanges(since?: Date): Promise<HrRecord[]>;
}

/** Test/dev source: returns a fixed set of records. */
export class StaticHrDirectory implements HrDirectoryPort {
  constructor(private readonly records: HrRecord[]) {}
  async fetchChanges(): Promise<HrRecord[]> {
    return this.records;
  }
}

/**
 * SAP SuccessFactors adapter (scheduled OData pull). Left as a documented stub:
 * wiring the real call needs tenant credentials (SuccessFactors OData v2:
 * `/odata/v2/EmpJob` + a custom "transport block" field / `EmpEmployment`
 * termination). Returns [] until configured so the sync job is a safe no-op.
 */
export class SuccessFactorsDirectory implements HrDirectoryPort {
  constructor(private readonly cfg: { baseUrl?: string; apiKey?: string; companyId?: string } = {}) {}
  async fetchChanges(_since?: Date): Promise<HrRecord[]> {
    if (!this.cfg.baseUrl || !this.cfg.apiKey) return [];
    // TODO: query SuccessFactors OData with a lastModified delta filter and map
    // the response to HrRecord[]. Kept out of this build (no live tenant creds).
    return [];
  }
}
