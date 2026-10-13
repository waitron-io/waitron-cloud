import {Pool} from 'pg';
import {EmailOutbox,EmailWorker} from '../../src/email-outbox.ts';
import {MonitorWorker} from '../../src/monitoring.ts';
import {createLocalAccountMailer} from '../../src/local-mailer.ts';
const configuration=await new Promise<{schema:string;keys:Record<string,string>;quietSeconds:number;reminderSeconds:number}>(resolve=>process.once('message',resolve));
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+configuration.schema,application_name:'quiet-child-'+process.pid,statement_timeout:5000});
try{
 const outbox=new EmailOutbox({activeKeyId:'test',keys:configuration.keys}),mode=process.argv[2];
 if(mode==='mail-once'){
  const worker=new EmailWorker(pool,outbox,createLocalAccountMailer({port:Number(process.env.MAILPIT_TEST_SMTP_PORT)}));
  while(await worker.runOnce()){}
 }else{
  const monitor=new MonitorWorker(pool,outbox,configuration);await monitor.schedule();await monitor.runOnce();
  if(mode==='monitor-hold'){
   process.send?.({ready:true,pid:process.pid});
   await new Promise<void>(resolve=>process.once('SIGTERM',()=>resolve()));
  }else if(mode!=='monitor-once')throw new Error('invalid fixture mode');
 }
}finally{await pool.end();process.disconnect?.();}
