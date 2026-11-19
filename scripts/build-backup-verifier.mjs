import {execFileSync} from 'node:child_process';
import {copyFile,mkdir,mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const checkout=process.env.WAITRON_CHECKOUT,image=process.env.CLOUD_VERIFIER_IMAGE??'waitron-backup-verifier:local';
if(!checkout||!process.env.NODE_AUTH_TOKEN)throw Error('Set WAITRON_CHECKOUT and NODE_AUTH_TOKEN before building the verifier');
const [profile,...extra]=process.argv.slice(2);
const targets = new Map([
 [undefined, 'target.json'],
 ['--streamed', 'streamed-target.json'],
 ['--amazon-test', 'amazon-test-target.json'],
]);
const targetFile = targets.get(profile);
if(extra.length||!targetFile)throw Error('Choose at most one verifier target: --streamed or --amazon-test');
// Public source must remain readable by the unprivileged image user under a private caller mask.
process.umask(0o022);
const root=fileURLToPath(new URL('../',import.meta.url)),context=await mkdtemp(join(tmpdir(),'cloud-verifier-build-'));
try{
 const targetBytes=await readFile(join(root,'deploy/backup-verifier',targetFile),'utf8');
 const target=JSON.parse(targetBytes);
 if(!/^[a-f0-9]{40}$/.test(target.runtime?.revision??''))throw Error('Invalid pinned verifier source');
 const revision=execFileSync('git',['-C',checkout,'rev-parse','--verify',target.runtime.revision+'^{commit}'],{encoding:'utf8'}).trim();
 if(revision!==target.runtime.revision)throw Error('Invalid pinned verifier source');
 await mkdir(join(context,'waitron'));await mkdir(join(context,'verifier'));
 // Archive only committed source: local credentials and untracked venue data never enter the image.
 execFileSync('git',['-C',checkout,'archive','--format=tar','-o',join(context,'waitron.tar'),revision]);
 execFileSync('tar',['-xf',join(context,'waitron.tar'),'-C',join(context,'waitron')]);await rm(join(context,'waitron.tar'));
 for(const name of ['container-entry.mjs','waitron-verifier.ts','waitron-verify-child.mjs','verify-process.ts','verification-protocol.ts','verification-transport.ts','waitron-data-verify-child.mjs','object-transfer.ts'])await writeFile(join(context,'verifier',name),await readFile(join(root,'packages/backups/src',name)));
 const {generateHourRelease}=await import(pathToFileURL(join(context,'waitron/scripts/generate-hour-release.mjs')).href);
 await mkdir(join(context,'waitron/build'),{recursive:true});
 await writeFile(join(context,'waitron/build/hour-release.json'),JSON.stringify(generateHourRelease({cwd:checkout,source:revision})));
 await writeFile(join(context,'verifier/target.json'),targetBytes);
 await copyFile(join(root,'deploy/backup-verifier/Dockerfile'),join(context,'Dockerfile'));
 execFileSync('docker',['build','--secret','id=npm_token,env=NODE_AUTH_TOKEN','--label','cloud.waitron-revision='+revision,'-t',image,context],{stdio:'inherit',timeout:600000});
}finally{await rm(context,{recursive:true,force:true});}
