import {createPrivateKey} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {BackupKeyVault} from './keys.ts';
import {StorageAuthority,validateLocation} from './storage.ts';
import {workerObjects} from './worker-config.ts';
import type {ObjectStore} from './catalogue.ts';
import type {CaptureOptions} from './captures.ts';
export function captureRuntime(env:Record<string,string|undefined>):{options:CaptureOptions;close():void}|undefined{
 if(!Object.keys(env).some(k=>k.startsWith('CLOUD_BACKUP_')&&env[k]))return;
 if(!/^[0-9a-f]{64}$/.test(env.CLOUD_BACKUP_MASTER_KEY??''))throw Error('backup.key_unavailable');
 const config=JSON.parse(env.CLOUD_BACKUP_AUTHORITY??'null');
 if(!config||typeof config!=='object'||typeof config.issuer!=='string'||new URL(config.issuer).protocol!=='https:'||typeof config.audience!=='string'||!config.audience||typeof config.keyId!=='string'||!config.keyId||!config.roles||['capture','stream','restore'].some(k=>typeof config.roles[k]!=='string'||!config.roles[k]))throw Error('backup.storage_configuration');
 const privateKey=createPrivateKey(config.privateKey);if(privateKey.asymmetricKeyType!=='rsa'||(privateKey.asymmetricKeyDetails?.modulusLength??0)<2048)throw Error('backup.storage_configuration');
 const authority=new StorageAuthority({...config,privateKey});
 const ca=env.CLOUD_BACKUP_CA_FILE?readFileSync(env.CLOUD_BACKUP_CA_FILE,'utf8'):undefined;
 const objects=workerObjects(env,ca),clients=new Map<string,ObjectStore>();
 return {options:{vault:new BackupKeyVault(Buffer.from(env.CLOUD_BACKUP_MASTER_KEY!,'hex')),objects(location){const key=JSON.stringify(location);let client=clients.get(key);if(!client){client=objects.objects(location);clients.set(key,client);}return client;},async grant(location,scope){
  validateLocation(location);if(new URL(location.endpoint).href!==new URL(env.CLOUD_BACKUP_ENDPOINT!).href||location.region!==env.CLOUD_BACKUP_REGION)throw Error('backup.storage_configuration');
  return authority.grant(location,scope,ca);
 }},close(){clients.clear();objects.close();}};
}
