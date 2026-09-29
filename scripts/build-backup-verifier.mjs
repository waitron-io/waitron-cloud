import {execFileSync} from 'node:child_process';
import {copyFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const checkout=process.env.WAITRON_CHECKOUT,image=process.env.CLOUD_VERIFIER_IMAGE??'waitron-backup-verifier:local';
if(!checkout||!process.env.NODE_AUTH_TOKEN)throw Error('Set WAITRON_CHECKOUT and NODE_AUTH_TOKEN before building the verifier');
const root=fileURLToPath(new URL('../',import.meta.url)),context=await mkdtemp(join(tmpdir(),'cloud-verifier-build-'));
try{
 const revision=execFileSync('git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 await mkdir(join(context,'waitron'));await mkdir(join(context,'verifier'));
 // Archive only committed source: local credentials and untracked venue data never enter the image.
 execFileSync('git',['-C',checkout,'archive','--format=tar','-o',join(context,'waitron.tar'),revision]);
 execFileSync('tar',['-xf',join(context,'waitron.tar'),'-C',join(context,'waitron')]);await rm(join(context,'waitron.tar'));
 for(const name of ['container-entry.mjs','waitron-verifier.ts','waitron-verify-child.mjs','verify-process.ts'])await copyFile(join(root,'packages/backups/src',name),join(context,'verifier',name));
 await copyFile(join(root,'deploy/backup-verifier/Dockerfile'),join(context,'Dockerfile'));
 execFileSync('docker',['build','--secret','id=npm_token,env=NODE_AUTH_TOKEN','--label','cloud.waitron-revision='+revision,'-t',image,context],{stdio:'inherit',timeout:600000});
}finally{await rm(context,{recursive:true,force:true});}
