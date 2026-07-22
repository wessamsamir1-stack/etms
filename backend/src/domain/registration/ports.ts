/**
 * Pluggable adapters for self-registration. Both ship as stubs so the flow runs
 * end-to-end today; swap in a real SMS/email gateway and a face-match service
 * later without touching the routes.
 */

/** Delivers the OTP to the person over SMS or email. */
export interface OtpDeliveryPort {
  send(channel: 'sms' | 'email', to: string, code: string): Promise<void>;
}

/**
 * Dev/stub delivery: records the last code per recipient instead of sending.
 * Never use in production — real delivery is a gateway adapter.
 */
export class StubOtpDelivery implements OtpDeliveryPort {
  private readonly sent = new Map<string, string>();
  async send(channel: 'sms' | 'email', to: string, code: string): Promise<void> {
    this.sent.set(to, code);
  }
  lastCodeFor(to: string): string | undefined {
    return this.sent.get(to);
  }
}

export interface FaceMatchResult {
  score: number | null; // 0..1, or null when not scored
  decision: 'match' | 'no_match' | 'manual';
}

/** Optional face verification against the roster's reference photo. */
export interface FaceMatchPort {
  match(referencePhotoRef: string | null, submittedPhotoRef: string): Promise<FaceMatchResult>;
}

/** Default: always route to human review (no automated face match wired). */
export class ManualReviewFaceMatch implements FaceMatchPort {
  async match(): Promise<FaceMatchResult> {
    return { score: null, decision: 'manual' };
  }
}
