import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Pool} from 'pg';
import {RelayGrantStore} from '../src/relay-grants.ts';
import {RelayWorker} from '../src/relay-worker.ts';
import {RelayMessages} from '../src/relay-messages.ts';
import {createLeaseIssuer} from '../src/installation-proof.ts';
import {generateKeyPairSync} from 'node:crypto';

// An ignored mode would defer invalid configuration until a database or SMTP operation.
for(const name of ['grants','messages','worker'] as const)test(`venue relay ${name} rejects an invalid permission mode before work`,()=>{
 const pool={} as Pool,mode='production-venue-levels';
 const api={RelayGrantStore,RelayMessages,RelayWorker} as any;
 const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 assert.throws(()=>name==='grants'?new api.RelayGrantStore(pool,undefined,mode):name==='worker'?new api.RelayWorker(pool,undefined,mode):new api.RelayMessages(pool,issuer,'http://localhost',{mode:'local-proof'},undefined,mode),/invalid_plan_mode/);
});
