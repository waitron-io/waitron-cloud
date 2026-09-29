import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {PairingStore,type PairingCodeKeys,transaction,verifyPairingProof} from '@waitron-cloud/registration';
import {readAccountBody} from './request.ts';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export async function pairingResponse(c:Context,options:{pool:Pool;pairingCodeKeys:PairingCodeKeys|null;origin:string;ip:string;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response> {
  const {pool,origin,ip,consume}=options;const store=new PairingStore(pool,options.pairingCodeKeys);const machine=c.req.path.startsWith('/api/pairing/');
  const action=c.req.path.slice((machine?'/api/pairing/':'/api/account/pairing/').length);
  if(!(machine?['start','status','complete']:['businesses','inspect','approve']).includes(action))throw new AccountHttpError(404,'not_found');
  if(c.req.method!==(action==='businesses'?'GET':'POST'))throw new AccountHttpError(405,'method_not_allowed');
  if(machine) {
    if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
    await consume([{scope:`pairing-${action}-ip`,subject:ip,limit:action==='start'?10:60,windowSeconds:action==='start'?900:60}]);
    const body=await readAccountBody(c.req.raw,['payload','signature']);
    const claims=verifyPairingProof(body.payload!,body.signature!,origin,action);
    await consume([{scope:`pairing-${action}-key`,subject:claims.publicKey,limit:action==='start'?10:60,windowSeconds:action==='start'?900:60}]);
    return c.json(await (action==='start'?store.start(claims):action==='status'?store.status(claims):store.complete(claims)));
  }
  if(c.req.method==='POST'&&c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
  const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'';const csrf=c.req.header('x-csrf-token')??'';
  const session=await transaction(pool,client=>resolveSession(client,token,{touch:false,...(action==='businesses'?{}:{csrfToken:csrf})}));
  await consume([{scope:'pairing-browser-account',subject:session.accountId,limit:30,windowSeconds:60}]);
  if(action==='businesses')return c.json({businesses:await store.businesses(token)});
  const body=await readAccountBody(c.req.raw,action==='approve'?['requestId','code','organisationId','legalBusinessId']:['requestId','code']);
  return c.json(await (action==='inspect'?store.inspect(body.requestId!,body.code!,token,csrf):store.approve(body.requestId!,body.code!,body.organisationId!,body.legalBusinessId!,token,csrf)));
}
