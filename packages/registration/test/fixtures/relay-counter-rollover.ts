export interface CounterRollover {kind: 'relay_counter_expired'; counterEndsAt: number; observedAt: number}
export async function admitFixtureMessage<T>(admit: () => Promise<T>, report: (evidence: CounterRollover) => void): Promise<T> {
  return admit();
}
