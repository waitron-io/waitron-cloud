import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

export const browserCheckLifetimeMs = 120_000;
export const browserCheckDifficulty = 16;

export function browserCheckTokens(key: Buffer, now = Date.now) {
  return {
    issue(purpose: string, origin: string, connection: string, lifetime: number) {
      const payload = Buffer.from(JSON.stringify([purpose, origin, connection, now() + lifetime,
        randomBytes(16).toString('base64url')])).toString('base64url');
      return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
    },
    accepts(value: string, purpose: string, origin: string, connection: string) {
      try {
        if (value.length > 1024) return false;
        const [payload, signature, extra] = value.split('.');
        if (!payload || !signature || extra !== undefined) return false;
        const received = Buffer.from(signature, 'base64url');
        const expected = createHmac('sha256', key).update(payload).digest();
        if (received.length !== expected.length || received.toString('base64url') !== signature || !timingSafeEqual(received, expected)) return false;
        const bytes = Buffer.from(payload, 'base64url');
        if (bytes.toString('base64url') !== payload) return false;
        const claims = JSON.parse(bytes.toString());
        return Array.isArray(claims) && claims.length === 5 && claims[0] === purpose && claims[1] === origin
          && claims[2] === connection && Number.isSafeInteger(claims[3]) && claims[3] > now();
      } catch {return false;}
    },
  };
}

export function solvedBrowserCheck(value: unknown, difficulty: number, accepts: (challenge: string) => boolean): value is {challenge: string; nonce: number} {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'challenge,nonce') return false;
  const {challenge, nonce} = value as Record<string, unknown>;
  return typeof challenge === 'string' && typeof nonce === 'number' && Number.isSafeInteger(nonce)
    && nonce >= 0 && nonce < 1_000_000_000 && accepts(challenge)
    && createHash('sha256').update(`${challenge}:${nonce}`).digest().readUInt32BE(0) < 2 ** (32 - difficulty);
}

export const browserCheckWorker = `onmessage=async({data})=>{try{const encoder=new TextEncoder(),until=performance.now()+20000;for(let nonce=0;nonce<1000000000&&performance.now()<until;nonce++){const hash=new DataView(await crypto.subtle.digest('SHA-256',encoder.encode(data.challenge+':'+nonce)));if(hash.getUint32(0)<2**(32-data.difficulty)){postMessage({challenge:data.challenge,nonce});return;}}postMessage({error:'exhausted'});}catch{postMessage({error:'unsupported'});}};`;
