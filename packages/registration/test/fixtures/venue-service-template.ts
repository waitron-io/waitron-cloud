import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../src/migrate.ts';

const seedSchema='venue_service_seed';
async function database(template?:string){
 if(template!==undefined&&!/^venue_service_template_[a-f0-9]{32}$/.test(template))throw new Error('invalid_venue_service_template');
 if(!process.env.TEST_DATABASE_URL)throw new Error('test_database_url_required');
 const token=randomUUID().replaceAll('-','');
 const name=template?'venue_service_clone_'+template.slice(-32)+'_'+token.slice(0,10):'venue_service_template_'+token;
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 let created=false;
 const close=async()=>{
  if(!created)return;
  if(!template){
   // Callers have exited; reap their abandoned clones using the full owner identity.
   const children=await admin.query('SELECT datname FROM pg_database WHERE datname ~ $1 ORDER BY datname',['^venue_service_clone_'+name.slice(-32)+'_[a-f0-9]{10}$']);
   for(const {datname} of children.rows)await admin.query(`DROP DATABASE "${datname}"`);
  }
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
 const owned=await database(),pool=new Pool({connectionString:owned.connectionString,options:`-c search_path=${seedSchema} -c statement_timeout=8000`});
 try{
  await pool.query(`CREATE SCHEMA ${seedSchema}`);await migrate(pool);await pool.end();return owned;
 }catch(error){await pool.end();await owned.close();throw error;}
}

export async function cloneVenueServiceTemplate(template:string,schema:string){
 if(!/^(?:venue_services|http)_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_venue_service_schema');
 const owned=await database(template),pool=new Pool({connectionString:owned.connectionString});
 try{
  await pool.query(`ALTER SCHEMA ${seedSchema} RENAME TO ${schema}`);
  // PostgreSQL does not rename schema names captured in function settings.
  const pinned=await pool.query('SELECT p.oid::regprocedure::text AS name FROM pg_proc p WHERE p.pronamespace=$1::regnamespace AND $2=ANY(p.proconfig)',[schema,`search_path=${seedSchema}`]);
  for(const {name} of pinned.rows)await pool.query(`ALTER FUNCTION ${name} SET search_path=${schema}`);
  await pool.end();return owned;
 }catch(error){await pool.end();await owned.close();throw error;}
}
