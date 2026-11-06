import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../src/migrate.ts';

const seedSchema='venue_service_seed';
async function database(template?:string){
 if(template!==undefined&&!/^venue_service_template_[a-f0-9]{32}$/.test(template))throw new Error('invalid_venue_service_template');
 if(!process.env.TEST_DATABASE_URL)throw new Error('test_database_url_required');
 const name=(template?'venue_service_clone_'+template.slice(-8)+'_':'venue_service_template_')+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 let created=false;
 const close=async()=>{
  if(!created)return;
  await admin.query(`DROP DATABASE "${name}"`);created=false;await admin.end();
 };
 try{
  await admin.query(`CREATE DATABASE "${name}"${template?` TEMPLATE "${template}"`:''}`);created=true;
  const url=new URL(process.env.TEST_DATABASE_URL);url.pathname='/'+name;
  return {name,connectionString:url.href,close};
 }catch(error){await admin.end();throw error;}
}

// The template has no open connections when children clone its real migration state.
export async function createVenueServiceTemplate(){
 const owned=await database(),pool=new Pool({connectionString:owned.connectionString,options:`-c search_path=${seedSchema}`});
 try{
  await pool.query(`CREATE SCHEMA ${seedSchema}`);await migrate(pool);await pool.end();return owned;
 }catch(error){await pool.end();await owned.close();throw error;}
}

export async function cloneVenueServiceTemplate(template:string,schema:string){
 if(!/^venue_services_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_venue_service_schema');
 const owned=await database(template),pool=new Pool({connectionString:owned.connectionString});
 try{
  await pool.query(`ALTER SCHEMA ${seedSchema} RENAME TO ${schema}`);await pool.end();return owned;
 }catch(error){await pool.end();await owned.close();throw error;}
}
