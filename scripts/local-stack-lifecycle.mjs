import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {waitForLocalStack} from './local-stack-compose.mjs';

const prefix=['compose','--env-file','deploy/local-stack/local.env'];
function runDocker(args,{capture=false}={}){
 const value=execFileSync('docker',[...prefix,...args],{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit'});
 return value?.trim()??'';
}

export async function startLocalStack(mode,{run=runDocker,waitForReady=waitForLocalStack}={}){
 if(!['up','upgrade'].includes(mode))throw new Error('local_stack.lifecycle_mode');
 run(['build','bootstrap']);
 run(['up','-d','--no-build',...(mode==='upgrade'?['--force-recreate']:[])]);
 await waitForReady(()=>run(['ps','-a','--format','json'],{capture:true}));
 run(['ps','-a']);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3||!['up','upgrade'].includes(process.argv[2]))throw new Error('Usage: node scripts/local-stack-lifecycle.mjs <up|upgrade>');
 if(!process.env.NODE_AUTH_TOKEN)throw new Error('Set NODE_AUTH_TOKEN to a package-read token before building the local stack');
 await startLocalStack(process.argv[2]);
}
