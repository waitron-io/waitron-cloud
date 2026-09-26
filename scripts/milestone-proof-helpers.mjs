import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

export function repositoryRoot(moduleUrl){
 return resolve(dirname(fileURLToPath(moduleUrl)),'..');
}

export function expectedOldAuthorityRefusal(error){
 return error instanceof Error&&/^Waitron capture client failed:[\s\S]*\bcloud\.binding_conflict\b/.test(error.message);
}
