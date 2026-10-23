import {RelayBoundsError} from '../../src/relay-bounds.ts';

export interface CounterRollover {kind: 'relay_counter_expired'; counterEndsAt: number; observedAt: number}

// Only the final counter guard proves this admission rolled back after a window ended.
export async function admitFixtureMessage<T>(admit: () => Promise<T>, report: (evidence: CounterRollover) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {return await admit();} catch (error) {
      if (!(error instanceof RelayBoundsError) || error.code !== 'relay_unavailable') throw error;
      const cause = error.cause as Partial<CounterRollover> | undefined;
      const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
      if (!cause || cause.kind !== 'relay_counter_expired' || !time(cause.counterEndsAt) ||
        !time(cause.observedAt) || cause.counterEndsAt > cause.observedAt) throw error;
      report({kind: 'relay_counter_expired', counterEndsAt: cause.counterEndsAt, observedAt: cause.observedAt});
      if (attempt === 9) throw error;
    }
  }
}
