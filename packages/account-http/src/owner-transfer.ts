import {organisationScopeSql} from '@waitron-cloud/identity';
import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {OwnerTransferStore,transaction} from '@waitron-cloud/registration';
import {AccountHttpError} from './errors.ts';
import {readSessionCookie} from './cookies.ts';
import {readBoundedJsonObject} from './request.ts';
import type {RateRule} from './rate-limit.ts';
export async function ownerTransferResponse(c:Context,o:{pool:Pool;store:OwnerTransferStore;origin:string;secure:boolean;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 const path=c.req.path.slice('/api/account/owner-transfers'.length),token=readSessionCookie(c,o.secure)??'',csrf=c.req.header('x-csrf-token')??'';
 if(path===''&&c.req.method==='GET'){
  const organisations=await transaction(o.pool,async client=>{
   const session=await resolveSession(client,token,{touch:false});
   return (await client.query(`SELECT o.id,o.name FROM organisations o JOIN organisation_memberships m ON m.organisation_id=o.id WHERE m.account_id=$1 AND m.is_owner AND ${organisationScopeSql('m.account_id','m.organisation_id')} ORDER BY o.id`,[session.accountId])).rows;
  });
  return c.json({organisations,offers:await o.store.list(token)});
 }
 if(!['/create','/accept','/cancel'].includes(path))throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==o.origin)throw new AccountHttpError(403,'forbidden');
 const body=await readBoundedJsonObject(c.req.raw),fields=path==='/create'?Object.hasOwn(body,'locale')?['email','locale','organisationId']:['email','organisationId']:['id'];
 if(Object.keys(body).sort().join(',')!==fields.sort().join(',')||fields.some(field=>typeof body[field]!=='string')||body.locale!==undefined&&!['en','es'].includes(String(body.locale)))throw new AccountHttpError(400,'invalid_input');
 const session=await transaction(o.pool,client=>resolveSession(client,token,{csrfToken:csrf,touch:false}));
 await o.consume([{scope:'owner-transfer-ip',subject:o.ip,limit:10,windowSeconds:60},{scope:'owner-transfer-account',subject:session.accountId,limit:20,windowSeconds:300}]);
 if(path==='/create'){await o.store.create(token,csrf,body.organisationId as string,body.email as string,body.locale as 'en'|'es'|undefined);return c.json({status:'accepted'},202);}
 return c.json(await o.store.decide(token,csrf,body.id as string,path==='/accept'?'accept':'cancel'));
}
