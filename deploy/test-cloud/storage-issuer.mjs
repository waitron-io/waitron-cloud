import {createServer} from 'node:https';
import {createHash,createPrivateKey,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {StorageAuthority} from '../../packages/backups/src/storage.ts';
import {bootstrapTestCloud} from './bootstrap.mjs';
import {atomicPrivateFile} from './storage-authority.mjs';
import {claimLease} from '../local-stack/lease.mjs';
const issuer='https://waitron.local:8444',audience='cloud-storage',keyId='test-cloud-storage-v1';
const roles=Object.fromEntries(['capture','stream','restore'].map(kind=>[kind,'arn:aws:iam::role/cloud-'+kind]));
const digest=value=>createHash('sha256').update(value).digest('hex');
function configuration(signingKey,directory){
 const resource='arn:aws:s3:::${jwt:bucket}/${jwt:scope}';
 return {
  sts:{tokenDuration:'15m',maxSessionLength:'15m',issuer:'cloud-test-sts',signingKey},
  providers:[{name:'cloud',type:'oidc',enabled:true,config:{issuer,clientId:audience,jwksUri:issuer+'/jwks',tlsCaCert:join(directory,'lan/ca.pem'),roleMapping:{rules:Object.entries(roles).map(([kind,role])=>({claim:'kind',value:kind,role}))}}}],
  policies:['capture','stream','restore'].map(kind=>({name:kind,document:{Version:'2012-10-17',Statement:[{Effect:'Allow',Action:kind==='capture'?['s3:PutObject']:kind==='restore'?['s3:GetObject']:['s3:PutObject','s3:GetObject','s3:DeleteObject'],Resource:[resource+(kind==='stream'?'*':'')]},...(kind==='stream'?[{Effect:'Allow',Action:['s3:ListBucket'],Resource:['arn:aws:s3:::${jwt:bucket}'],Condition:{StringLike:{'s3:prefix':'${jwt:scope}*'}}}]:[])]}})),
  roles:Object.entries(roles).map(([kind,roleArn])=>({roleName:'cloud-'+kind,roleArn,attachedPolicies:[kind],trustPolicy:{Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Federated:'*'},Action:['sts:AssumeRoleWithWebIdentity'],Condition:{StringEquals:{'oidc:iss':issuer,'oidc:kind':kind}}}]}}))
 };
}
async function privateFile(path){const info=await lstat(path);if(!info.isFile()||(info.mode&0o777)!==0o600)throw Error('test_cloud.storage_issuer_state');return readFile(path,'utf8');}
async function load(directory){
 const target=join(directory,'storage-authority');
 let info;try{info=await lstat(target);}catch(error){if(error.code==='ENOENT')return;throw error;}
 try{
  if(!info.isDirectory()||(info.mode&0o777)!==0o700)throw Error();
  const value=JSON.parse(await privateFile(join(target,'issuer.json'))),sts=JSON.parse(await privateFile(join(target,'sts.json'))),key=createPrivateKey(value.privateKey);
  if(value.version!==1||value.issuer!==issuer||value.audience!==audience||value.keyId!==keyId||key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048||!/^[A-Za-z0-9+/]{43}=$/.test(value.stsSigningKey)||JSON.stringify(sts)!==JSON.stringify(configuration(value.stsSigningKey,directory)))throw Error();
  return value;
 }catch{throw Error('test_cloud.storage_issuer_state');}
}
function publicIdentity(value){return {version:1,issuer,keyId,keySha256:digest(value.privateKey)};}
export async function bootstrapStorageIssuer(directory){
 await bootstrapTestCloud(directory);const found=await load(directory);if(found)return publicIdentity(found);
 let held;for(let n=0;n<200&&!held;n++){held=await claimLease(join(directory,'.storage-issuer.lock'));if(!held)await delay(25);}if(!held)throw Error('test_cloud.storage_issuer_busy');
 const scratch=join(directory,'.storage-issuer-'+randomUUID());
 try{
  const after=await load(directory);if(after)return publicIdentity(after);
  const key=generateKeyPairSync('rsa',{modulusLength:2048}),value={version:1,issuer,audience,keyId,roles,privateKey:key.privateKey.export({type:'pkcs8',format:'pem'}),stsSigningKey:randomBytes(32).toString('base64')};
  await mkdir(scratch,{mode:0o700});await atomicPrivateFile(join(scratch,'issuer.json'),JSON.stringify(value));await atomicPrivateFile(join(scratch,'sts.json'),JSON.stringify(configuration(value.stsSigningKey,directory)));
  await held.assertOwned();await rename(scratch,join(directory,'storage-authority'));return publicIdentity(await load(directory));
 }finally{await rm(scratch,{recursive:true,force:true});await held.release();}
}
export async function startStorageIssuer(directory,{port=8444,host='0.0.0.0'}={}){
 await bootstrapStorageIssuer(directory);const value=await load(directory),authority=new StorageAuthority({...value,privateKey:createPrivateKey(value.privateKey)});
 const server=createServer({key:await readFile(join(directory,'lan/key.pem')),cert:await readFile(join(directory,'lan/cert.pem'))},(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.writeHead(405);res.end('{}');return;}
  if(req.url==='/jwks'){res.end(JSON.stringify(authority.jwks()));return;}
  if(req.url==='/.well-known/openid-configuration'){res.end(JSON.stringify({issuer,jwks_uri:issuer+'/jwks',id_token_signing_alg_values_supported:['RS256'],subject_types_supported:['public'],response_types_supported:['id_token']}));return;}
  res.writeHead(404);res.end('{}');
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return {authority,port:server.address().port,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
