import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export function solveBrowserCheck({challenge, difficulty}: {challenge: string; difficulty: number}) {
  assert.equal(typeof challenge, 'string');
  assert.ok(Number.isInteger(difficulty) && difficulty >= 8 && difficulty <= 22);
  for (let nonce = 0; nonce < 1_000_000_000; nonce++) {
    const hash = createHash('sha256').update(`${challenge}:${nonce}`).digest().readUInt32BE(0);
    if (hash < 2 ** (32 - difficulty)) return {'x-waitron-browser-proof': JSON.stringify({challenge, nonce})};
  }
  throw new Error('Browser check exhausted');
}
