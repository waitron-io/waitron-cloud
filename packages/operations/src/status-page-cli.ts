import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {renderStatusPage} from './status-page.ts';

let ownedDirectory:string|undefined;
try{
 const [input,destination,...extra]=process.argv.slice(2);
 if(!input||!destination||extra.length)throw new Error();
 const pages=renderStatusPage(JSON.parse(readFileSync(input,'utf8')));
 mkdirSync(destination);ownedDirectory=destination;
 mkdirSync(join(destination,'es'));
 for(const [file,html] of Object.entries(pages))writeFileSync(join(destination,file),html,{flag:'wx'});
 console.log('Wrote status page bundle');
}catch{
 if(ownedDirectory)try{rmSync(ownedDirectory,{recursive:true,force:true});}catch{/* Leave only this invocation's incomplete directory for the operator. */}
 console.error('Status page generation failed; check input and use a new output directory');process.exitCode=1;
}
