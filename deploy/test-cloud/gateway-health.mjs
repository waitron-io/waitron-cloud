import {readFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export async function testGatewayHealthy(path='/state/status.json'){
 try{const info=await stat(path),value=JSON.parse(await readFile(path,'utf8'));return Date.now()-info.mtimeMs<5000&&value.ready===true&&Number.isSafeInteger(value.sequence)&&value.sequence>0&&Number.isInteger(value.routes)&&value.routes>=0&&value.routes<=64;}catch{return false;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await testGatewayHealthy()?0:1;
