// The selected historical checkout supplies the application and SQL. This current
// deployment wrapper supplies the startup gate missing from historical releases.
import {spawn} from 'node:child_process';
import {checkConsumerDatabase} from './runtime.mjs';
let child;
const forward=signal=>child?.kill(signal);
process.once('SIGTERM',forward);process.once('SIGINT',forward);
try{
 if(!process.env.DATABASE_URL||process.argv.length<3)throw Error();
 await checkConsumerDatabase(process.env.DATABASE_URL,process.cwd());
 child=spawn(process.execPath,process.argv.slice(2),{env:process.env,stdio:'inherit'});
 process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}catch{console.error('Consumer refused: schema or configuration is incompatible');process.exitCode=1;}
finally{process.removeListener('SIGTERM',forward);process.removeListener('SIGINT',forward);}
