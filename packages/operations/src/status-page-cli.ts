import {readFileSync} from 'node:fs';
import {writeStatusPageBundle} from './status-page-bundle.ts';
import {renderStatusPage} from './status-page.ts';

try{
 const [input,destination,...extra]=process.argv.slice(2);
 if(!input||!destination||extra.length)throw new Error();
 const pages=renderStatusPage(JSON.parse(readFileSync(input,'utf8')));
 writeStatusPageBundle(destination,pages);
 console.log('Wrote status page bundle');
}catch{
 console.error('Status page generation failed; check input and use a new output directory');process.exitCode=1;
}
