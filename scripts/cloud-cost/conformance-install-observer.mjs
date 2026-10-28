const packageId=value=>typeof value==='string'&&value.length<=200&&/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@[0-9][a-zA-Z0-9.+-]*$/.test(value)?value:null;
const count=value=>Number.isSafeInteger(value)&&value>=0?value:undefined;
const scriptStages=new Set(['preinstall','install','postinstall','prepublish','preprepare','prepare','postprepare']);

export function createInstallObserver(source) {
  let buffer='',discarding=false,discardedLines=0,overflow=false;
  const packages=new Map(),scripts=new Map(),errors=new Set();
  const fromPath=value=>{
    if(typeof value!=='string'||!source||!value.startsWith(source+'/node_modules/.pnpm/'))return null;
    const folder=value.slice((source+'/node_modules/.pnpm/').length).split('/')[0];
    const peer=folder.indexOf('_',folder.indexOf('@',1)+1);
    const name=peer===-1?folder:folder.slice(0,peer);
    const id=packageId(name.startsWith('@')?name.replace('+','/'):name);
    return packages.has(id)?id:null;
  };
  const consume=line=>{
    let record;try{record=JSON.parse(line);}catch{return;}
    if(!record||typeof record!=='object')return;
    if(record.name==='pnpm'&&record.level==='error'&&typeof record.code==='string'&&/^ERR_PNPM_[A-Z0-9_]{1,80}$/.test(record.code)) {
      if(errors.size<20)errors.add(record.code);else overflow=true;
    }
    if(record.name==='pnpm:lifecycle'&&scriptStages.has(record.stage)) {
      const id=source&&record.depPath===source?'workspace':fromPath(record.depPath);
      if(!id)return;
      const key=id+':'+record.stage;
      if(count(record.exitCode)!==undefined)scripts.delete(key);
      else if(scripts.size<2048)scripts.set(key,{packageId:id,stage:record.stage});else overflow=true;
      return;
    }
    if(record.name==='pnpm:progress'&&record.status==='imported') {
      const id=fromPath(record.to);if(id)packages.get(id).imported=true;return;
    }
    if(!(record.name==='pnpm:progress'&&['resolved','fetched','found_in_store'].includes(record.status))
      &&!(record.name==='pnpm:fetching-progress'&&['started','in_progress'].includes(record.status)))return;
    const id=packageId(record.packageId);if(!id)return;
    let state=packages.get(id);
    if(!state){if(packages.size>=2048){overflow=true;return;}state={packageId:id};packages.set(id,state);}
    if(record.name==='pnpm:progress') {
      if(record.status==='resolved')state.resolved=true;
      else state.available=true;
    } else {
      for(const key of ['attempt','size','downloaded'])if(count(record[key])!==undefined)state[key]=record[key];
    }
  };
  return {
    write(bytes){
      // Ignore an oversized record through its newline so a suffix cannot become a new event.
      for(const part of bytes.toString().split(/(?<=\n)/)) {
        const complete=part.endsWith('\n');
        if(!discarding&&buffer.length+part.length>65536){discarding=true;discardedLines++;buffer='';}
        if(!discarding)buffer+=part;
        if(complete){if(!discarding)consume(buffer);buffer='';discarding=false;}
      }
    },
    end(){if(buffer&&!discarding)consume(buffer);buffer='';},
    snapshot(){
      const states=[...packages.values()];
      const downloads=states.filter(s=>!s.available),imports=states.filter(s=>s.available&&!s.imported);
      return {resolved:states.filter(s=>s.resolved).length,available:states.filter(s=>s.available).length,
        imported:states.filter(s=>s.imported).length,pendingDownloadCount:downloads.length,pendingImportCount:imports.length,
        pendingDownloads:downloads.slice(0,20).map(({packageId,attempt,size,downloaded})=>({packageId,...attempt===undefined?{}:{attempt},...size===undefined?{}:{size},...downloaded===undefined?{}:{downloaded}})),
        pendingImports:imports.slice(0,20).map(s=>s.packageId),activeScriptCount:scripts.size,activeScripts:[...scripts.values()].slice(0,20),
        errorCodes:[...errors],discardedLines,truncated:overflow||downloads.length>20||imports.length>20||scripts.size>20};
    },
  };
}
