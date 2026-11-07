import {Pool} from 'pg';
import {staffProblemReports} from './staff-problem-reports.ts';

let pool:Pool|undefined;
try{
 const args=process.argv.slice(2),environment=args[1];
 if(args.length!==2||args[0]!=='--environment'||(environment!=='test'&&environment!=='production')||!process.env.DATABASE_URL)throw new Error('invalid_staff_report_configuration');
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000,
  options:[process.env.PGOPTIONS??'','-c default_transaction_read_only=on'].join(' ')});
 pool.on('error',()=>{});
 const result=await staffProblemReports(pool,environment);
 process.stdout.write(JSON.stringify(result).replace(/[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))+'\n');
}catch{
 console.error('Staff report read failed; check environment, database and migrations');process.exitCode=1;
}finally{
 try{await pool?.end();}catch{process.exitCode=1;}
}
