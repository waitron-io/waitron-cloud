import {createHash} from 'node:crypto';
import {Agent} from 'node:https';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(new URL('../../packages/backups/package.json',import.meta.url));
const {S3Client,CreateBucketCommand,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const config=JSON.parse(await readFile('/run/local-stack/runtime.json','utf8')),ca=await readFile('/run/local-stack/storage-ca.pem');
const client=new S3Client({endpoint:config.storage.endpoint,region:config.storage.region,credentials:{accessKeyId:config.storage.accessKeyId,secretAccessKey:config.storage.secretAccessKey},forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca})}});
const bucket='local-stack-proof',key='lifecycle-marker',body='waitron-cloud-local-stack-v1',digest=createHash('sha256').update(body).digest('hex');
try{
 if(process.argv[2]==='put'){
  try{await client.send(new CreateBucketCommand({Bucket:bucket}));}catch(error){if(!['BucketAlreadyExists','BucketAlreadyOwnedByYou'].includes(error?.name))throw error;}
  await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,IfNoneMatch:'*'})).catch(async error=>{if(error?.$metadata?.httpStatusCode!==412)throw error;});
 }else if(process.argv[2]!=='get'||process.argv.length!==3)throw Error();
 const result=await client.send(new GetObjectCommand({Bucket:bucket,Key:key})),actual=await result.Body?.transformToString();if(actual!==body)throw Error();
 console.log(JSON.stringify({present:true,digest}));
}catch{console.error('Local stack storage marker failed');process.exitCode=1;}finally{client.destroy();}
