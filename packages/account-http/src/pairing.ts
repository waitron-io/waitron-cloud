import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {PairingError,PairingStore,RelayError,SetupPairingStore,setupEmailConsentBody,type PairingCodeKeys,type RelayAdmissionConfig,type SetupPairingContext,transaction,verifyMachine,verifyPairingProof,verifyPairingV4Proof,verifyPairingV5Proof} from '@waitron-cloud/registration';
import {readAccountBody} from './request.ts';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {AccountHttpConfig} from './config.ts';
import type {RateRule} from './rate-limit.ts';
type Setup = AccountHttpConfig['setupPairing'];

function setupContext(input: unknown): SetupPairingContext {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountHttpError(400, 'invalid_input');
  const {requestId, state, codeChallenge} = input as Partial<SetupPairingContext>;
  if (Object.keys(input).length !== 3 || typeof requestId !== 'string' || typeof state !== 'string'
    || typeof codeChallenge !== 'string') throw new AccountHttpError(400, 'invalid_input');
  return {requestId, state, codeChallenge};
}

export function setupPairingSignIn(pool: Pool, setup: Setup, value: unknown) {
  if (value === undefined) return;
  if (!setup) throw new AccountHttpError(400, 'invalid_input');
  return new SetupPairingStore(pool).signIn(setupContext(value), setup);
}

export async function pairingResponse(c:Context,options:{pool:Pool;pairingCodeKeys:PairingCodeKeys|null;origin:string;ip:string;consume:(rules:RateRule[])=>Promise<void>;setupPairing:Setup;country:string;relayGrants?:RelayAdmissionConfig['grants']}):Promise<Response> {
  const {pool,origin,ip,consume}=options;const store=new PairingStore(pool,options.pairingCodeKeys);const machine=c.req.path.startsWith('/api/pairing/');
  const action=c.req.path.slice((machine?'/api/pairing/':'/api/account/pairing/').length);
  const setup = options.setupPairing;
  const actions = machine ? ['start','status','complete'] : ['businesses','inspect','approve'];
  if (setup) actions.push(...(machine ? ['redeem'] : ['authorize', 'cancel']));
  if (setup && machine) actions.push('email-grant');
  if (!actions.includes(action)) throw new AccountHttpError(404, 'not_found');
  if(c.req.method!==(action==='businesses'?'GET':'POST'))throw new AccountHttpError(405,'method_not_allowed');
  if(machine) {
    if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
    await consume([{scope:`pairing-${action}-ip`,subject:ip,limit:action==='start'?10:60,windowSeconds:action==='start'?900:60}]);
    const body=await readAccountBody(c.req.raw,['payload','signature']);
    const consumeKey = (publicKey: string) => consume([{scope:`pairing-${action}-key`,subject:publicKey,limit:action==='start'?10:60,windowSeconds:action==='start'?900:60}]);
    if (setup && action === 'email-grant') {
      const proof = {payload: body.payload!, signature: body.signature!};
      const claims = verifyMachine(proof, setup.publicKey, origin, 'configuration');
      await consumeKey(setup.publicKey);
      if (!options.relayGrants) throw new AccountHttpError(403, 'relay_disabled');
      let choice;
      try { choice = JSON.parse(claims.body); }
      catch { throw new AccountHttpError(400, 'invalid_input'); }
      if (typeof choice?.requestId !== 'string'
        || claims.body !== setupEmailConsentBody(choice.requestId, options.relayGrants.consentVersion))
        throw new AccountHttpError(400, 'invalid_input');
      try {
        const grant = await new SetupPairingStore(pool).emailGrant(choice.requestId, claims.installationId, setup, proof, options.relayGrants);
        return c.json({emailRelay: {version: 1, grant}});
      } catch (error) {
        if (error instanceof RelayError) {
          if (error.code === 'grant_conflict') throw new AccountHttpError(409, error.code);
          if (error.code === 'relay_disabled' || error.code === 'grant_unavailable') throw new AccountHttpError(403, error.code);
          if (error.code === 'invalid_input') throw new AccountHttpError(400, error.code);
        }
        throw error;
      }
    }
    if (setup) {
      for (const [version, verify] of [[4, verifyPairingV4Proof], [5, verifyPairingV5Proof]] as const) {
        let claims;
        try { claims = {...verify(body.payload!, body.signature!, origin, action), version}; }
        catch (error) {
          if (error instanceof PairingError && error.code === 'invalid_proof') continue;
          throw error;
        }
        await consumeKey(claims.publicKey);
        if (claims.publicKey !== setup.publicKey || (claims.action === 'start' && claims.args[0] !== setup.redirectUri))
          throw new PairingError('invalid_proof');
        const attempts = new SetupPairingStore(pool);
        if (claims.action === 'start') return c.json(await attempts.start(claims));
        if (claims.action === 'redeem') return c.json(await attempts.redeem(claims, setup, options.country));
        if (claims.action === 'status') return c.json(await attempts.status(claims));
        try { return c.json(await attempts.complete(claims, setup, options.country)); }
        catch (error) {
          if (error instanceof PairingError && error.code === 'binding_conflict') throw new AccountHttpError(409, error.code);
          throw error;
        }
      }
    }
    const claims=verifyPairingProof(body.payload!,body.signature!,origin,action);
    await consumeKey(claims.publicKey);
    return c.json(await (action==='start'?store.start(claims):action==='status'?store.status(claims):store.complete(claims)));
  }
  if(c.req.method==='POST'&&c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
  if (setup && action === 'cancel') {
    await consume([{scope: 'pairing-cancel-ip', subject: ip, limit: 60, windowSeconds: 60}]);
    const body = await readAccountBody(c.req.raw, ['requestId','state']);
    return c.json(await new SetupPairingStore(pool).cancel(body.requestId!, body.state!, setup));
  }
  const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'';const csrf=c.req.header('x-csrf-token')??'';
  const session=await transaction(pool,client=>resolveSession(client,token,{touch:false,...(action==='businesses'?{}:{csrfToken:csrf})}));
  await consume([{scope:'pairing-browser-account',subject:session.accountId,limit:30,windowSeconds:60}]);
  if (setup && action === 'authorize') {
    const body = await readAccountBody(c.req.raw, ['requestId','state','codeChallenge']);
    return c.json(await new SetupPairingStore(pool).authorize(setupContext(body), setup, token, csrf));
  }
  if(action==='businesses')return c.json({businesses:await store.businesses(token)});
  const body=await readAccountBody(c.req.raw,action==='approve'?['requestId','code','organisationId','legalBusinessId']:['requestId','code']);
  return c.json(await (action==='inspect'?store.inspect(body.requestId!,body.code!,token,csrf):store.approve(body.requestId!,body.code!,body.organisationId!,body.legalBusinessId!,token,csrf)));
}
