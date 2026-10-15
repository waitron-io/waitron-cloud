import {createHash} from 'node:crypto';
import {posix} from 'node:path';

const dependencyFields=['dependencies','devDependencies','optionalDependencies'];
const packageName=/^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/;
const recordKey=/^((?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+)@(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?)(.*)$/;
const safePath=value=>value==='.' || typeof value==='string' && value.length>0 && !value.startsWith('/') && !value.split('/').some(part=>['','..','.'].includes(part));
const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const freeze=value=>{
  if(value && typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
};

// This grammar deliberately rejects YAML features that cannot prove a complete v9 graph.
function parseYaml(source,fail) {
  if(typeof source!=='string' || Buffer.byteLength(source)>2*1024*1024)fail('Input size exceeds 2 MiB');
  if(source.includes('\0'))fail('Unsupported NUL');
  const lines=source.split(/\r?\n/).map((text,index)=>{
    if(text.includes('\t'))fail(`Unsupported tab indentation at line ${index+1}`);
    const indent=text.match(/^ */)[0].length;
    if(indent%2)fail(`Ambiguous indentation at line ${index+1}`);
    return {indent,text:text.slice(indent).replace(/ +$/, ''),line:index+1};
  }).filter(row=>row.text && !row.text.startsWith('#'));
  if(lines.length>50000)fail('Input size exceeds 50000 lines');
  let cursor=0;
  const inline=(source,depth=0)=>{
    let index=0;
    const whitespace=()=>{while(source[index]===' ')index++;};
    const quoted=()=>{
      const start=index,quote=source[index++];let result='';
      while(index<source.length) {
        const next=source[index++];
        if(next===quote) {
          if(quote==="'" && source[index]==="'"){result+="'";index++;continue;}
          if(quote==='"') {
            try{return JSON.parse(source.slice(start,index));}catch{fail('Unsupported quoted scalar');}
          }
          return result;
        }
        if(quote==='"' && next==='\\'){result+=next+source[index++];continue;}
        result+=next;
      }
      fail('Unterminated quoted scalar');
    };
    const key=(blockKey=false)=>{
      whitespace();let result;
      const quotedKey=['"',"'"].includes(source[index]);
      if(quotedKey)result=quoted();
      else {
        const start=index;
        while(index<source.length && source[index]!==':' && !/[{},\[\]]/.test(source[index]))index++;
        result=source.slice(start,index).replace(/^ +| +$/g, '');
        if(!/^[a-zA-Z0-9_./@()-]+$/.test(result))fail(`Unsupported map key ${result}`);
      }
      if(!result || result==='<<')fail('Unsupported merge or empty map key');
      whitespace();if(source[index++]!==':')fail(`Unsupported map key ${result}`);
      if((blockKey || !quotedKey) && index<source.length && source[index]!==' ')fail('Missing map value separation');
      return result;
    };
    const value=level=>{
      if(level>32)fail('Input depth exceeds 32');
      whitespace();const first=source[index];
      if(first==='{' || first==='[') {
        index++;const map=first==='{',result=map?Object.create(null):[],close=map?'}':']';
        whitespace();if(source[index]===close){index++;return result;}
        while(index<source.length) {
          if(map) {
            const name=key();if(Object.hasOwn(result,name))fail(`Duplicate key ${name}`);
            result[name]=value(level+1);
          }else result.push(value(level+1));
          whitespace();if(source[index]===close){index++;return result;}
          if(source[index++]!==',')fail('Unterminated or unsupported flow value');
          whitespace();if(source[index]===close){index++;return result;}
        }
        fail('Unterminated flow value');
      }
      if(['"',"'"].includes(first))return quoted();
      const start=index;
      while(index<source.length && !/[{},\[\]]/.test(source[index]) && !(source[index]==='#' && (index===start || source[index-1]===' ')))index++;
      const result=source.slice(start,index).replace(/^ +| +$/g, '');
      if(!result || /^[&*!|>%?]/.test(result) || /^[-:] /.test(result) || /: /.test(result))fail(`Unsupported scalar ${result}`);
      if(result==='true')return true;if(result==='false')return false;
      if(result==='null' || result==='~')return null;
      if(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(result))return Number(result);
      return result;
    };
    const name=()=>key(true);
    const finish=()=>{
      whitespace();if(index<source.length && source[index]!=='#')fail(`Trailing unsupported input ${source.slice(index)}`);
    };
    return {value:()=>value(depth),name,finish,empty:()=>{whitespace();return index===source.length || source[index]==='#';}};
  };
  const block=(indent,depth)=>{
    if(depth>32)fail('Input depth exceeds 32');
    const sequence=lines[cursor]?.text.startsWith('- '),result=sequence?[]:Object.create(null);
    while(cursor<lines.length && lines[cursor].indent===indent) {
      const row=lines[cursor++];
      if(row.text.startsWith('- ')!==sequence)fail(`Unsupported mixed map/sequence at line ${row.line}`);
      const parser=inline(sequence?row.text.slice(2):row.text,depth);
      const name=sequence?null:parser.name();
      if(!sequence && Object.hasOwn(result,name))fail(`Duplicate key ${name} at line ${row.line}`);
      let item;
      if(parser.empty()) {
        if(!lines[cursor] || lines[cursor].indent!==indent+2)fail(`Missing value or ambiguous indentation at line ${row.line}`);
        item=block(indent+2,depth+1);
      }else {item=parser.value();parser.finish();}
      if(sequence)result.push(item);else result[name]=item;
      if(lines[cursor]?.indent>indent)fail(`Ambiguous indentation at line ${lines[cursor].line}`);
    }
    return result;
  };
  if(!lines.length || lines[0].indent!==0)fail('Missing root map or ambiguous indentation');
  const result=block(0,0);
  if(cursor!==lines.length)fail('Unconsumed YAML input');
  return result;
}

export function parseLock(source,path='pnpm-lock.yaml') {
  const fail=reason=>{throw Error(`${path}: ${reason}`);};
  const map=(value,where)=>{if(!value || typeof value!=='object' || Array.isArray(value))fail(`${where}: expected map`);return value;};
  const string=(value,where)=>{if(typeof value!=='string' || !value.length || value.includes('\0'))fail(`${where}: expected nonempty string`);};
  const fields=(value,allowed,where)=>{
    map(value,where);for(const name of Object.keys(value))if(!allowed.includes(name))fail(`${where}: unsupported field ${name}`);
  };
  const strings=(value,where)=>{if(!Array.isArray(value) || value.length>50000)fail(`${where}: expected string list`);for(const item of value)string(item,where);};
  const boolean=(value,where)=>{if(typeof value!=='boolean')fail(`${where}: expected boolean`);};
  const namedStrings=(value,where)=>{map(value,where);for(const [name,item]of Object.entries(value)){if(!packageName.test(name))fail(`${where}: invalid dependency name ${name}`);string(item,`${where}.${name}`);}};
  const keyParts=(key,peers,level=0)=>{
    if(level>32)fail(`Peer context depth exceeds 32: ${key}`);
    const match=recordKey.exec(key);
    if(!match)fail(`Unsupported resolved version ${key}`);
    const suffix=match[3];let depth=0,start=0;
    if(suffix && (!peers || !suffix.startsWith('(')))fail(`Unsupported resolved version ${key}`);
    for(let index=0;index<suffix.length;index++) {
      const char=suffix[index];
      if(char==='('){if(depth===0)start=index+1;if(++depth>32)fail(`Peer context depth exceeds 32: ${key}`);}
      else if(char===')'){
        if(--depth<0)fail(`Unsupported peer context ${key}`);
        if(depth===0)keyParts(suffix.slice(start,index),true,level+1);
      }
      else if(depth===0 || !/[a-zA-Z0-9_./@+:-]/.test(char))fail(`Unsupported peer context ${key}`);
    }
    if(depth!==0)fail(`Unsupported peer context ${key}`);
    return {metadata:`${match[1]}@${match[2]}`};
  };
  const data=parseYaml(source,fail);
  fields(data,['lockfileVersion','settings','importers','packages','snapshots'],'root');
  if(data.lockfileVersion!=='9.0')fail('Unsupported lockfile version');
  fields(data.settings,['autoInstallPeers','excludeLinksFromLockfile'],'settings');
  if(data.settings.autoInstallPeers!==true || data.settings.excludeLinksFromLockfile!==false)fail('Unsupported settings');
  for(const name of ['importers','packages','snapshots'])map(data[name],name);
  if(!Object.hasOwn(data.importers,'.'))fail('Missing root importer .');
  for(const [id,importer]of Object.entries(data.importers)) {
    if(!safePath(id))fail(`Invalid importer path ${id}`);
    fields(importer,dependencyFields,`importers.${id}`);
    for(const field of dependencyFields)if(Object.hasOwn(importer,field)) {
      map(importer[field],`importers.${id}.${field}`);
      for(const [name,entry]of Object.entries(importer[field])) {
        if(!packageName.test(name))fail(`Invalid importer dependency ${name}`);
        fields(entry,['specifier','version'],`importers.${id}.${name}`);
        string(entry.specifier,`importers.${id}.${name}.specifier`);string(entry.version,`importers.${id}.${name}.version`);
      }
    }
  }
  for(const [key,record]of Object.entries(data.packages)) {
    keyParts(key,false);
    fields(record,['resolution','engines','cpu','os','hasBin','peerDependencies','peerDependenciesMeta'],`packages.${key}`);
    fields(record.resolution,['integrity','tarball'],`packages.${key}.resolution`);
    string(record.resolution.integrity,`packages.${key}.resolution.integrity`);
    if(!/^sha(?:1|256|384|512)-[a-zA-Z0-9+/]+={0,2}$/.test(record.resolution.integrity))fail(`Invalid integrity ${key}`);
    if(record.resolution.tarball!==undefined) {
      string(record.resolution.tarball,`packages.${key}.resolution.tarball`);
      let url;try{url=new URL(record.resolution.tarball);}catch{fail(`Unsupported tarball for ${key}`);}
      if(url.protocol!=='https:' || url.username || url.password || !url.hostname)fail(`Unsupported tarball for ${key}`);
    }
    if(record.engines!==undefined){map(record.engines,`packages.${key}.engines`);for(const [engine,version]of Object.entries(record.engines))string(version,`packages.${key}.engines.${engine}`);}
    for(const field of ['cpu','os'])if(record[field]!==undefined)strings(record[field],`packages.${key}.${field}`);
    if(record.hasBin!==undefined)boolean(record.hasBin,`packages.${key}.hasBin`);
    if(record.peerDependencies!==undefined)namedStrings(record.peerDependencies,`packages.${key}.peerDependencies`);
    if(record.peerDependenciesMeta!==undefined) {
      map(record.peerDependenciesMeta,`packages.${key}.peerDependenciesMeta`);
      for(const [name,meta]of Object.entries(record.peerDependenciesMeta)) {
        if(!packageName.test(name))fail(`Invalid peer metadata name ${name}`);
        fields(meta,['optional'],`packages.${key}.peerDependenciesMeta.${name}`);
        boolean(meta.optional,`packages.${key}.peerDependenciesMeta.${name}.optional`);
      }
    }
  }
  for(const [key,snapshot]of Object.entries(data.snapshots)) {
    keyParts(key,true);
    fields(snapshot,['dependencies','optionalDependencies','optional','transitivePeerDependencies'],`snapshots.${key}`);
    for(const field of ['dependencies','optionalDependencies'])if(snapshot[field]!==undefined)namedStrings(snapshot[field],`snapshots.${key}.${field}`);
    if(snapshot.optional!==undefined)boolean(snapshot.optional,`snapshots.${key}.optional`);
    if(snapshot.transitivePeerDependencies!==undefined)strings(snapshot.transitivePeerDependencies,`snapshots.${key}.transitivePeerDependencies`);
    if(!Object.hasOwn(data.packages,keyParts(key,true).metadata))fail(`Missing package metadata for ${key}`);
  }
  const target=(name,version,importer)=>{
    if(version.startsWith('link:')) {
      if(importer===null)fail(`Unsupported snapshot link ${version}`);
      const value=version.slice(5);
      if(!value || value.startsWith('/') || value.includes('\\'))fail(`Unsupported link ${version}`);
      const id=posix.normalize(posix.join(importer,value));
      if(!safePath(id) || !Object.hasOwn(data.importers,id))fail(`Missing or outside workspace link ${version}: ${id}`);
      return {importer:id};
    }
    const key=/^\d/.test(version)?`${name}@${version}`:version;
    keyParts(key,true);
    if(!Object.hasOwn(data.snapshots,key))fail(`Missing snapshot ${key}`);
    return {snapshot:key};
  };
  let fingerprintBytes=0;
  const fingerprint=value=>{
    const encoded=JSON.stringify(canonical(value));
    fingerprintBytes+=Buffer.byteLength(encoded);
    if(fingerprintBytes>32*1024*1024)fail('Resolved fingerprint input size exceeds 32 MiB');
    return createHash('sha256').update(encoded).digest('hex');
  };
  // Hash shared records once; closures retain identities and their complete record digests.
  const recordHashes=Object.fromEntries(['importers','snapshots','packages'].map(kind=>
    [kind,Object.fromEntries(Object.entries(data[kind]).map(([key,value])=>[key,fingerprint(value)]))]));
  const closures=Object.create(null),usedSnapshots=new Set(),usedMetadata=new Set();
  let steps=0;
  for(const id of Object.keys(data.importers).sort()) {
    const importers=new Set(),snapshots=new Set(),metadata=new Set(),pending=[{importer:id}];
    while(pending.length) {
      if(++steps>500000)fail('Resolved graph size exceeds 500000 visits');
      const next=pending.pop();
      if(next.importer!==undefined) {
        if(importers.has(next.importer))continue;importers.add(next.importer);
        const importer=data.importers[next.importer];
        for(const field of dependencyFields)for(const [name,entry]of Object.entries(importer[field]??{}))pending.push(target(name,entry.version,next.importer));
      }else {
        if(snapshots.has(next.snapshot))continue;snapshots.add(next.snapshot);
        metadata.add(keyParts(next.snapshot,true).metadata);
        const snapshot=data.snapshots[next.snapshot];
        for(const field of ['dependencies','optionalDependencies'])for(const [name,version]of Object.entries(snapshot[field]??{}))pending.push(target(name,version,null));
      }
    }
    const importerIds=[...importers].sort(),snapshotIds=[...snapshots].sort(),metadataIds=[...metadata].sort();
    const inputs={importers:importerIds.map(key=>[key,recordHashes.importers[key]]),snapshots:snapshotIds.map(key=>[key,recordHashes.snapshots[key]]),packages:metadataIds.map(key=>[key,recordHashes.packages[key]])};
    closures[id]={importers:importerIds,snapshots:snapshotIds,packages:metadataIds,fingerprint:fingerprint(inputs)};
    for(const key of snapshots)usedSnapshots.add(key);for(const key of metadata)usedMetadata.add(key);
  }
  for(const key of Object.keys(data.snapshots))if(!usedSnapshots.has(key))fail(`Unexplained orphan snapshot ${key}`);
  for(const key of Object.keys(data.packages))if(!usedMetadata.has(key))fail(`Unexplained orphan package metadata ${key}`);
  return freeze({...data,path,closures});
}

export function changedImporters(before,after) {
  const importers=[...new Set([...Object.keys(before.closures),...Object.keys(after.closures)])].sort()
    .filter(id=>before.closures[id]?.fingerprint!==after.closures[id]?.fingerprint);
  return freeze({importers,reasons:importers.map(id=>({path:after.path,reason:`Importer ${id}: resolved dependency inputs changed`}))});
}

export function describeLockChanges(base, head, git) {
  try {
    const locks = [base, head].map(sha => {
      if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Invalid lock revision');
      const entry = git('ls-tree', '-z', sha, '--', 'pnpm-lock.yaml');
      if (!/^100644 blob [a-f0-9]{40}\tpnpm-lock\.yaml\0$/.test(entry)) throw Error('Missing regular lockfile');
      return parseLock(git('show', `${sha}:pnpm-lock.yaml`));
    });
    const {importers} = changedImporters(...locks);
    const detail = importers.length ? `changed for ${importers.join(', ')}` : 'unchanged';
    return `pnpm-lock.yaml: resolved dependency inputs ${detail}; full suite retained until root readers are covered`;
  } catch {
    return 'pnpm-lock.yaml: resolved dependency evidence unavailable; full suite retained';
  }
}
