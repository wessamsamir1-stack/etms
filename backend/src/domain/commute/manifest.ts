/**
 * Daily-commute helpers (pure). The system tracks attendance on a per-trip
 * passenger manifest — not seat reservations — and a per-stop waiting timer whose
 * duration the admin configures per tenant or per route.
 */
export type PassengerStatus =
  | 'expected' | 'on_the_way' | 'boarded' | 'no_show' | 'excused' | 'on_leave' | 'removed';

export const DEFAULT_WAIT_SECONDS = 120;

/** Route override wins, else tenant policy, else the default. */
export function effectiveWaitSeconds(
  routeWait: number | null | undefined,
  policyWait: number | null | undefined,
): number {
  if (routeWait != null) return routeWait;
  if (policyWait != null) return policyWait;
  return DEFAULT_WAIT_SECONDS;
}

export interface ManifestCounts {
  expected: number; // still to board (expected + on_the_way)
  onTheWay: number;
  boarded: number;
  noShow: number;
  excused: number;
  total: number;
  remaining: number; // expected + on_the_way — who the driver is still waiting for
}

export function manifestCounts(statuses: readonly PassengerStatus[]): ManifestCounts {
  const c = (s: PassengerStatus) => statuses.filter((x) => x === s).length;
  const onTheWay = c('on_the_way');
  const expectedOnly = c('expected');
  const boarded = c('boarded');
  const noShow = c('no_show');
  const excused = c('excused') + c('on_leave');
  return {
    expected: expectedOnly + onTheWay,
    onTheWay,
    boarded,
    noShow,
    excused,
    total: statuses.length,
    remaining: expectedOnly + onTheWay,
  };
}

export type Lang = 'ar' | 'en';

export const commuteMessages = {
  arrival: (l: Lang) =>
    l === 'ar' ? 'وصل باص الشركة إلى نقطة التجمّع.' : 'The company bus has arrived at your pickup point.',
  preArrival: (min: number, l: Lang) =>
    l === 'ar' ? `باص الشركة يصل خلال ${min} دقائق تقريبًا.` : `The company bus arrives in about ${min} minutes.`,
  noShow: (l: Lang) =>
    l === 'ar'
      ? 'غادر الباص نقطة التجمّع وتم تسجيلك كـ «لم تحضر».'
      : 'The bus has left your pickup point; you were marked as No-Show.',
  onTheWay: (name: string, l: Lang) =>
    l === 'ar' ? `${name} في طريقه إلى نقطة التجمّع.` : `${name} is on the way to the pickup point.`,
};
