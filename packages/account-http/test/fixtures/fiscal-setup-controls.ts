import { EventEmitter } from 'node:events';
import { key, payload, reserve, venueId } from '../../../fiscal-allocation/test/fixtures.ts';
import { signReceipt } from '../../../fiscal-allocation/src/evidence.ts';
import { createLeaseIssuer } from '../../../registration/src/installation-proof.ts';

export const control = {
  at: '',
  onStage: undefined as ((stage: string) => void) | undefined,
  error: new Error('private token, SQL, key and path'),
  closed: [] as string[],
  enter(stage: string) {
    this.onStage?.(stage);
    if (stage === this.at) throw this.error;
  },
};
const signer = key();
export const receipt = signReceipt(payload(), signer);
export async function storeFixture() {
  control.enter('database');
  const issuer = createLeaseIssuer(signer.privateKey);
  const issue = issuer.issue; issuer.issue = input => { control.enter('lease'); return issue(input); };
  return {
    f: {
      issuer,
      pool: { async query() { control.enter('machine-registration'); return { rows: [], rowCount: 1 }; } },
    },
    options: { trust: { keys: new Map([[signer.keyId, signer.publicKey]]) } },
    async venue() {
      control.enter('venue');
      return { id: venueId, input: reserve(), installation: venueId, session: { token: 'private-cookie', csrfToken: 'private-csrf' } };
    },
    async close() { control.closed.push('database'); },
  };
}
export async function startAccountServer() {
  control.enter('account-server');
  return { server: new EventEmitter(), async close() { control.closed.push('server'); } };
}
