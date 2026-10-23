import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';

const execute=promisify(execFile);
export async function buildFixtureImage(image:string,root:string,budgetMs=120000,dockerfile:'Dockerfile'|'Worker.Dockerfile'='Dockerfile'){
 if(!Number.isInteger(budgetMs)||budgetMs<1||budgetMs>120000)throw Error('fixture_image.invalid_budget');
 const deadline=performance.now()+budgetMs;
 const remaining=()=>Math.ceil(deadline-performance.now());
 const docker=(...args:string[])=>execute('docker',args,{encoding:'utf8',timeout:Math.max(1,remaining()),killSignal:'SIGKILL'});
 try{await docker('image','inspect','node:26');}
 catch(error){
  if(!/No such (?:image|object):/i.test(String((error as {stderr?:string}).stderr)))throw error;
  for(let attempt=1;;attempt++){
   try{await docker('pull','node:26');break;}
   catch(error){
    const failure=error as {stderr?:string},pause=attempt*1000;
    const transient=/\b(?:500|502|503|504)\b|Client\.Timeout|i\/o timeout|TLS handshake timeout|context deadline exceeded|connection reset by peer|unexpected EOF/i.test(String(failure.stderr));
    if(!transient||attempt>=3||remaining()<=pause)throw error;
    await delay(pause);
    if(remaining()<=0)throw error;
   }
  }
 }
 // Acquisition and the single build share the existing two-minute setup budget.
 await docker('build','--pull=false','-q','-t',image,'-f',join(root,'packages/backups/test/container-fixture',dockerfile),root);
}
