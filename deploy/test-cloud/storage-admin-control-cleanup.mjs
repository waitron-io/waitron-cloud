import {readdir,readlink,unlink} from 'node:fs/promises';
import {join} from 'node:path';

export async function releaseStorageControlClaims(roots, directory = '/tmp/waitron-cloud-storage-ports-' + process.getuid()) {
  const owned = new Set(roots);
  let entries;
  try {entries = await readdir(directory);}
  catch (error) {if (error.code === 'ENOENT') return; throw error;}
  for (const name of entries) {
    const path = join(directory,name);
    let target;
    try {target = await readlink(path);}
    catch (error) {if (['ENOENT','EINVAL'].includes(error.code)) continue; throw error;}
    // Claims outlive their sockets; only roots created by this control confer cleanup ownership.
    if (!owned.has(target)) continue;
    try {await unlink(path);}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
}
