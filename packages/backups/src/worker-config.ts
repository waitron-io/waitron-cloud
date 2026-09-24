import {BackupObjects,validateLocation,type StorageLocation} from './storage.ts';
export function workerObjects(env:Record<string,string|undefined>,ca?:string){
 const endpoint=env.CLOUD_BACKUP_ENDPOINT??'',region=env.CLOUD_BACKUP_REGION??'';
 validateLocation({endpoint,region,bucket:'configuration-check'});
 const accessKeyId=env.CLOUD_BACKUP_ACCESS_KEY,secretAccessKey=env.CLOUD_BACKUP_SECRET_KEY;
 if(!accessKeyId||!secretAccessKey)throw Error('backup.storage_configuration');
 const clients:BackupObjects[]=[];
 return {
  objects(location:StorageLocation){
   // Operator credentials never follow an endpoint or region chosen by a catalogue row.
   validateLocation(location);
   if(new URL(location.endpoint).href!==new URL(endpoint).href||location.region!==region)throw Error('backup.storage_configuration');
   const client=new BackupObjects(location,{accessKeyId,secretAccessKey,...(env.CLOUD_BACKUP_SESSION_TOKEN?{sessionToken:env.CLOUD_BACKUP_SESSION_TOKEN}:{})},ca);clients.push(client);return client;
  },
  close(){for(const client of clients.splice(0))client.close();},
 };
}
