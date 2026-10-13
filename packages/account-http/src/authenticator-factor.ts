import type {Context} from 'hono';
import type {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {IdentityError,resolveSession} from '@waitron-cloud/identity';
import {AuthenticatorFactorStore,PasswordLoginStore,FactorError,FactorManagementError,transaction,type FactorProof} from '@waitron-cloud/registration';
import {AccountHttpError} from './errors.ts';
import {readSessionCookie,writeSessionCookies} from './cookies.ts';
import {readBoundedJsonObject} from './request.ts';
import type {FactorPolicy} from './config.ts';
import type {RateRule} from './rate-limit.ts';

type Options = {pool:Pool;login:PasswordLoginStore;store:AuthenticatorFactorStore;policy:FactorPolicy|null;
  origin:string;secure:boolean;ip:string;consume:(rules:RateRule[])=>Promise<void>};
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function exact(body:Record<string,unknown>,fields:string[],optional:string[]=[]):void {
  if(fields.some(field=>!Object.hasOwn(body,field))||Object.keys(body).some(field=>!fields.includes(field)&&!optional.includes(field)))throw new AccountHttpError(400,'invalid_input');
}
function token(value:unknown):string {
  if(typeof value!=='string'||!TOKEN.test(value))throw new AccountHttpError(400,'invalid_input');return value;
}
function password(value:unknown):string {
  if(typeof value!=='string'||!value||Buffer.byteLength(value)>1024)throw new AccountHttpError(400,'invalid_input');return value;
}
function code(value:unknown):string {
  if(typeof value!=='string'||!/^\d{6}$/.test(value))throw new AccountHttpError(400,'invalid_input');return value;
}
function proof(value:unknown):FactorProof {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AccountHttpError(400,'invalid_input');
  const parsed=value as Record<string,unknown>;exact(parsed,['kind','code']);
  if(parsed.kind==='totp')return {kind:'totp',code:code(parsed.code)};
  if(parsed.kind==='recovery'&&typeof parsed.code==='string'&&/^(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{8}){3})$/.test(parsed.code))
    return {kind:'recovery',code:parsed.code.replaceAll('-','').toUpperCase()};
  throw new AccountHttpError(400,'invalid_input');
}
function unavailable():never {throw new AccountHttpError(503,'temporarily_unavailable',1);}
export async function authenticatorResponse(c:Context,options: Options):Promise<Response> {
  const completion=c.req.path==='/api/account/login/factor';
  const action=completion?'/complete':c.req.path.slice('/api/account/authenticator'.length);
  if(!completion&&!['','/begin','/activate','/remove','/regenerate','/cancel'].includes(action))throw new AccountHttpError(404,'not_found');
  const method=action===''?'GET':'POST';
  if(c.req.method!==method)throw new AccountHttpError(405,'method_not_allowed');
  if(method==='POST'&&c.req.header('origin')!==options.origin)throw new AccountHttpError(403,'forbidden');
  const sessionToken=readSessionCookie(c,options.secure)??'',csrfToken=c.req.header('x-csrf-token')??'';
  try {
    if(action==='')return c.json(await options.store.status(sessionToken));
    const body=await readBoundedJsonObject(c.req.raw);
    if(completion) {
      exact(body,['challengeToken','proof']);const challengeToken=token(body.challengeToken),parsed=proof(body.proof);
      const p=options.policy;if(!p)unavailable();
      // IP rejection precedes derived account/challenge counters, so a blocked source cannot spend them.
      await options.consume([{scope:'factor-complete-ip',subject:options.ip,...p.completeIp}]);
      const candidate=(await options.pool.query('SELECT account_id FROM cloud_factor_login_challenges WHERE token_hash=$1',[digest(challengeToken)])).rows[0];
      await options.consume([{scope:'factor-complete-challenge',subject:challengeToken,...p.completeChallenge},
        {scope:'factor-complete-account',subject:candidate?.account_id??`unknown:${digest(challengeToken)}`,...p.completeAccount}]);
      const credentials=await options.login.complete(challengeToken,parsed);writeSessionCookies(c,options.secure,credentials);return c.json({accountId:credentials.accountId});
    }
    exact(body,action==='/cancel'?['pendingToken']:action==='/activate'?['password','pendingToken','code']:['password'],action==='/cancel'?[]:['proof']);
    const parsedPassword=action==='/cancel'?undefined:password(body.password);
    const parsedProof=Object.hasOwn(body,'proof')?proof(body.proof):undefined;
    const pendingToken=['/activate','/cancel'].includes(action)?token(body.pendingToken):undefined;
    const confirmation=action==='/activate'?code(body.code):undefined;
    const p=options.policy;
    if(!p&&action!=='/cancel')unavailable();
    // Cancellation remains possible during a configuration outage, under the existing all-IP limit.
    if(p)await options.consume([{scope:'factor-manage-ip',subject:options.ip,...p.manageIp}]);
    const session=await transaction(options.pool,client=>resolveSession(client,sessionToken,{csrfToken,touch:false}));
    if(p)await options.consume([{scope:'factor-manage-account',subject:session.accountId,...p.manageAccount}]);
    if(action==='/cancel'){await options.store.cancel(sessionToken,csrfToken,pendingToken!);return c.body(null,204);}
    const authority={token:sessionToken,csrfToken,password:parsedPassword!,...(parsedProof?{proof:parsedProof}:{})};
    if(action==='/begin')return c.json(await options.store.begin(authority));
    const changed=action==='/activate'?await options.store.activate(authority,pendingToken!,confirmation!):
      action==='/remove'?await options.store.remove(authority):await options.store.regenerate(authority);
    writeSessionCookies(c,options.secure);return c.json(changed);
  }catch(error){
    if(error instanceof FactorError)throw new AccountHttpError(error.code==='temporarily_unavailable'?503:401,error.code,error.code==='temporarily_unavailable'?1:undefined);
    if(error instanceof FactorManagementError)throw new AccountHttpError(error.code==='temporarily_unavailable'?503:error.code==='invalid_input'?400:403,
      error.code==='permission_denied'?'credentials_invalid':error.code,error.code==='temporarily_unavailable'?1:undefined);
    if(!completion&&action!==''&&error instanceof IdentityError)throw new AccountHttpError(403,'credentials_invalid');
    throw error;
  }
}
