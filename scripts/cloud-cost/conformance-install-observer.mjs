const packageId=value=>typeof value==='string'&&value.length<=200&&/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@[0-9][a-zA-Z0-9.+-]*$/.test(value)?value:null;
const count=value=>Number.isSafeInteger(value)&&value>=0?value:undefined;
const scriptStages=new Set(['preinstall','install','postinstall','prepublish','preprepare','prepare','postprepare']);

const nativeMilestone=line=>{
  if(typeof line!=='string')return;
  if(/^gyp info using node-gyp@[0-9]+\.[0-9]+\.[0-9]+$/.test(line))return {step:'node-gyp-start'};
  if(/^gyp info find Python using Python version [0-9.]+ found at ".+"$/.test(line))return {step:'python-found'};
  if(/^gyp info spawn (?:.*[/\\])?python[0-9.]*$/.test(line))return {step:'configure'};
  if(/^gyp info spawn (?:.*[/\\])?(?:g?make|ninja)$/.test(line))return {step:'build'};
  if(/^gyp info ok\s*$/.test(line))return {step:'node-gyp-complete'};
  const request=/^gyp http (GET|[1-5][0-9]{2}) (\S+)$/.exec(line);
  if(!request)return;
  let url;try{url=new URL(request[2]);}catch{return;}
  if(!['http:','https:'].includes(url.protocol))return;
  const resource=/\/node-v[0-9]+\.[0-9]+\.[0-9]+-headers\.tar\.gz$/.test(url.pathname)?'headers'
    :url.pathname.endsWith('/SHASUMS256.txt')?'checksums':null;
  if(resource)return request[1]==='GET'?{step:resource+'-request'}:{step:resource+'-response',httpStatus:Number(request[1])};
};

export function createInstallObserver(source) {
  let buffer='',discarding=false,discardedLines=0,overflow=false,rootName;
  const packages=new Map(),scripts=new Map(),failedScripts=new Map(),errors=new Set();
  const fromPath=value=>{
    if(typeof value!=='string'||!source||!value.startsWith(source+'/node_modules/.pnpm/'))return null;
    const folder=value.slice((source+'/node_modules/.pnpm/').length).split('/')[0];
    const peer=folder.indexOf('_',folder.indexOf('@',1)+1);
    const name=peer===-1?folder:folder.slice(0,peer);
    const id=packageId(name.startsWith('@')?name.replace('+','/'):name);
    return packages.has(id)?id:null;
  };
  const failed=(id,stage,exitCode)=>{
    if(!id||!scriptStages.has(stage)||count(exitCode)===undefined||exitCode===0)return;
    const key=id+':'+stage,lastMilestone=scripts.get(key)?.lastMilestone??failedScripts.get(key)?.lastMilestone;scripts.delete(key);
    if(failedScripts.size<2048)failedScripts.set(key,{packageId:id,stage,exitCode,...lastMilestone?{lastMilestone}:{}});else overflow=true;
  };
  const consume=line=>{
    let record;try{record=JSON.parse(line);}catch{return;}
    if(!record||typeof record!=='object')return;
    if(record.name==='pnpm:package-manifest'&&record.prefix===source){
      const name=record.initial?.name;
      if(typeof name==='string'&&packageId(name+'@0'))rootName=name;
    }
    if(record.name==='pnpm'&&record.level==='error'&&typeof record.code==='string'&&(/^ERR_PNPM_[A-Z0-9_]{1,80}$/.test(record.code)||record.code==='ELIFECYCLE')) {
      if(errors.size<20)errors.add(record.code);else overflow=true;
      if(record.code==='ELIFECYCLE'){
        const id=rootName&&record.pkgname===rootName?'workspace':packageId(record.pkgid);
        failed(id==='workspace'||packages.has(id)?id:null,record.stage,record.errno);
      }
    }
    if(record.name==='pnpm:lifecycle'&&scriptStages.has(record.stage)) {
      const id=source&&record.depPath===source?'workspace':fromPath(record.depPath);
      if(!id)return;
      const key=id+':'+record.stage;
      if(count(record.exitCode)!==undefined){
        failed(id,record.stage,record.exitCode);
        scripts.delete(key);
      }
      else if(scripts.has(key)||scripts.size<2048){
        const state=scripts.get(key)??{packageId:id,stage:record.stage};
        // Keep only fixed milestones; script output and URLs never enter a snapshot.
        const milestone=nativeMilestone(record.line);if(milestone)state.lastMilestone=milestone;
        scripts.set(key,state);
      }else overflow=true;
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
        failedScriptCount:failedScripts.size,failedScripts:[...failedScripts.values()].slice(0,20),
        errorCodes:[...errors],discardedLines,truncated:overflow||downloads.length>20||imports.length>20||scripts.size>20||failedScripts.size>20};
    },
  };
}
