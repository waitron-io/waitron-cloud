import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Pool} from 'pg';
import {RelayGrantStore} from '../src/relay-grants.ts';
import {RelayWorker} from '../src/relay-worker.ts';
import {RelayMessages} from '../src/relay-messages.ts';
import {createLeaseIssuer} from '../src/installation-proof.ts';
import {generateKeyPairSync,randomBytes} from 'node:crypto';

// An ignored mode would defer invalid configuration until a database or SMTP operation.
for(const name of ['grants','messages','worker'] as const)test(`venue relay ${name} rejects an invalid permission mode before work`,()=>{
 const pool={} as Pool,mode='production-venue-levels';
 const keys={activeKeyId:'local',keys:{local:randomBytes(32).toString('hex')}};
 const grants={mode:'local-proof',consentVersion:'local-v1',policy:{version:'local-v1',units:1,periodSeconds:3600,epoch:'2026-01-01T00:00:00.000Z',excess:'refuse',debit:'retain'},verifyOrigin:async()=>{throw Error('no provider work');}};
 const config={mode:'local-proof',grants,payloadKeys:keys,replayKeys:keys,bounds:{version:'local-v1',epoch:'2026-01-01T00:00:00.000Z',windowSeconds:3600,recipientLimit:1,grantLimit:1,queuedPayloadBytes:100000,maxCounterRows:100,recipientKeys:keys}};
 const api={RelayGrantStore,RelayMessages,RelayWorker} as any;
 const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 assert.throws(()=>name==='grants'?new api.RelayGrantStore(pool,undefined,mode):name==='worker'?new api.RelayWorker(pool,undefined,mode):new api.RelayMessages(pool,issuer,'http://localhost',config,undefined,mode),/invalid_plan_mode/);
});
test('venue relay message mode validation precedes malformed relay configuration',()=>{
 const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 assert.throws(()=>new RelayMessages({} as Pool,issuer,'http://localhost',{mode:'local-proof'} as any,undefined,'production-venue-levels' as any),/invalid_plan_mode/);
});
