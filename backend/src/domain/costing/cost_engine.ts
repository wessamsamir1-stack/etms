/**
 * Trip Cost Engine — deterministic and reproducible from a rate card + trip
 * facts (mirrors docs/etms/05-workflows.md §8 and the `trip_cost` schema).
 */
export type RateModel = 'per_km' | 'per_trip' | 'per_seat' | 'fixed_monthly';

export interface RateCard {
  model: RateModel;
  rate: number;
  minCharge?: number;
  currency: string;
}

export interface TripFacts {
  distanceKm?: number;
  seats?: number;
}

export interface CostResult {
  amount: number;
  currency: string;
  breakdown: Record<string, number | string>;
}

export function computeTripCost(card: RateCard, facts: TripFacts): CostResult {
  if (card.rate < 0) throw new Error('rate must be >= 0');

  let base: number;
  switch (card.model) {
    case 'per_km':
      base = card.rate * nonNeg(facts.distanceKm ?? 0);
      break;
    case 'per_seat':
      base = card.rate * nonNeg(facts.seats ?? 0);
      break;
    case 'per_trip':
    case 'fixed_monthly':
      base = card.rate;
      break;
  }

  const amount = round4(Math.max(base, card.minCharge ?? 0));
  return {
    amount,
    currency: card.currency,
    breakdown: {
      model: card.model,
      rate: card.rate,
      distanceKm: facts.distanceKm ?? 0,
      seats: facts.seats ?? 0,
      base: round4(base),
      minCharge: card.minCharge ?? 0,
    },
  };
}

function nonNeg(n: number): number {
  if (n < 0) throw new Error('trip facts must be >= 0');
  return n;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
