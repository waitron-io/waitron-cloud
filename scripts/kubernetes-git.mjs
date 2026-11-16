import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const controllers = [
  ['source-controller','4d77b2cfa9b0baadfa2b99b11a52ef41f43f968286e37bb7e5b4886b3227438a'],
  ['kustomize-controller','895eaa7beebeeb344677fab0bbb39a8f8d8be97f8d51703188fcacf2474624ef'],
];
export const fluxImages = name => controllers.map(([role,digest]) => ({upstream:'ghcr.io/fluxcd/'+role+'@sha256:'+digest,tag:name+':'+role}));
export function renderFluxControllers(jsonl, name, node) {
  const items=jsonl.trim().split('\n').map(row=>JSON.parse(row));
  for(const row of items.filter(row=>row.kind==='Deployment')) {
    assert.ok(controllers.some(([role])=>role===row.metadata.name),'flux.controller_inventory');
    row.spec.replicas=1;
    const spec=row.spec.template.spec;spec.nodeSelector={'kubernetes.io/hostname':node};
    spec.containers[0].image=name+':'+row.metadata.name;spec.containers[0].imagePullPolicy='Never';
  }
  return {apiVersion:'v1',kind:'List',items};
}
export async function prepareFluxBundle(directory, name, {run, fetch:download=globalThis.fetch}={}) {
  const mac=process.platform==='darwin'&&process.arch==='arm64';
  assert.ok(mac||process.platform==='linux'&&process.arch==='x64','flux.builder_platform');
  const artifact='flux_2.8.0_'+(mac?'darwin_arm64':'linux_amd64')+'.tar.gz';
  const digest=mac?'60ffdb837b20c43de848029846634c7b2289753eb341e62b7dd5f155265225e8':'5339d6a6f85be36238480308458c86fc9a839821a80c7a55f1baf12151b47fd6';
  const response=await download('https://github.com/fluxcd/flux2/releases/download/v2.8.0/'+artifact,{signal:AbortSignal.timeout(90000)});
  assert.ok(response.ok,'flux.archive_download');
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),digest,'flux.archive_digest');
  const archive=join(directory,artifact);await writeFile(archive,bytes);
  await run('tar',['-xzf',archive,'-C',directory,'flux']);
  assert.equal(JSON.parse(await run('kubectl',['version','--client','-o','json'])).clientVersion.gitVersion,'v1.34.3','flux.kubectl_version');
  const yaml=(await run(join(directory,'flux'),['install','--export','--components=source-controller,kustomize-controller','--version=v2.8.0'])).trimEnd()+'\n';
  assert.equal(createHash('sha256').update(yaml).digest('hex'),'5018b70a763ce6eaa6c56b117f04a9f7ac8bc72e896f4dbe27e9195897ad8071','flux.export_digest');
  const source=join(directory,'flux.yaml');await writeFile(source,yaml);
  const jsonl=await run('kubectl',['patch','--local','--type=merge','-p','{}','-f',source,'-o','jsonpath={@}{"\\n"}']);
  const path=join(directory,'flux.json');await writeFile(path,JSON.stringify(renderFluxControllers(jsonl,name,name+'-control-plane')));
  return path;
}

const shaOf=value=>/([a-f0-9]{40})$/.exec(value??'')?.[1];
const releaseAnnotation='waitron.io/p1-revision';
export async function waitFluxRevision({kube,sha,applied=sha,value,worker,rejected=false,sourceUid,deadline,
  signal,now=()=>performance.now(),sleep=ms=>delay(ms,undefined,{signal})}) {
  let last={};
  while(now()<deadline) {
    signal?.throwIfAborted();
    try {
      const read=args=>kube(['get',...args,'-o','json','--request-timeout=5s'],undefined,false,
        AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.ceil(deadline-now())))].filter(Boolean))).then(JSON.parse);
      const [source,root,deployment,pods,controllers]=await Promise.all([
        read(['gitrepository','p1']),read(['kustomization','p1']),read(['deployment','manifest']),read(['pods','-l','app=manifest']),
        sourceUid?read(['pods','-n','flux-system','-l','app=source-controller']):undefined,
      ]);
      const condition=root.status?.conditions?.find(row=>row.type==='Ready');
      last={source:shaOf(source.status?.artifact?.revision),applied:shaOf(root.status?.lastAppliedRevision),
        attempted:shaOf(root.status?.lastAttemptedRevision),reason:['BuildFailed','ReconciliationSucceeded','HealthCheckFailed','GitOperationFailed'].includes(condition?.reason)?condition.reason:'OTHER'};
      const pod=pods.items?.length===1?pods.items[0]:undefined;
      const healthy=deployment.status?.observedGeneration===deployment.metadata.generation&&
        deployment.spec.template.metadata.annotations?.[releaseAnnotation]===value&&pod&&!pod.metadata.deletionTimestamp&&
        pod.metadata.annotations?.[releaseAnnotation]===value&&pod.spec.nodeName===worker&&
        pod.status?.conditions?.some(row=>row.type==='Ready'&&row.status==='True');
      if(now()<=deadline&&last.source===sha&&last.applied===applied&&healthy&&
        root.status.observedGeneration===root.metadata.generation&&
        (rejected?last.attempted===sha&&condition?.status==='False'&&condition.reason==='BuildFailed':condition?.status==='True')&&
        (!sourceUid||controllers.items?.length===1&&controllers.items[0].metadata.uid!==sourceUid&&controllers.items[0].status?.conditions?.some(row=>row.type==='Ready'&&row.status==='True')))return last;
    } catch(error) {signal?.throwIfAborted();}
    if(now()<deadline)await sleep(Math.min(1000,deadline-now()));
  }
  process.stderr.write('Flux revision observation '+JSON.stringify(last)+'\n');
  throw Error('flux.revision_timeout');
}

export async function startFluxMirror({name,image,run}) {
  const id=await run('docker',['run','-d','--name',name+'-git','--user','1000:1000','--entrypoint','node',
    '-v',fileURLToPath(import.meta.url)+':/proof/kubernetes-git.mjs:ro','-p','10.77.0.1::8000',image,
    '/proof/kubernetes-git.mjs','--serve-mirror','/tmp/mirror']);
  assert.match(id,/^[a-f0-9]{64}$/,'flux.mirror_identity');
  const close=()=>run('docker',['rm','-f',id],undefined,true);
  try {
    await run('docker',['exec',id,'sh','-ec',`mkdir -p /tmp/mirror /tmp/release
git init --bare --object-format=sha1 /tmp/mirror/run.git
git --git-dir=/tmp/mirror/run.git config http.receivepack false
cd /tmp/release
git init --object-format=sha1
git config user.name 'Cloud rehearsal'
git config user.email rehearsal@example.test`]);
    const port=/^10\.77\.0\.1:(\d+)$/.exec(await run('docker',['port',id,'8000/tcp']));
    assert.ok(port,'flux.mirror_binding');
    return {url:'http://10.77.0.1:'+port[1]+'/run.git',close,
      async publish(text,signal) {
        const sha=await run('docker',['exec','-i',id,'sh','-ec',`cd /tmp/release
cat > deployment.yaml
git add deployment.yaml
git commit -s -m 'Synthetic deployment' >/dev/null
git push /tmp/mirror/run.git HEAD:main >/dev/null
git rev-parse HEAD`],text,false,signal);
        assert.match(sha,/^[a-f0-9]{40}$/,'flux.published_revision');return sha;
      }};
  } catch(error) {await close();throw error;}
}

export async function installFlux({name,image,run,kube,deployment,controllersPath='/tmp/d618-flux.json',signal,mirror=startFluxMirror}) {
  const source=await mirror({name,image,run});
  const managed=structuredClone(deployment);delete managed.spec.replicas;
  managed.spec.strategy={type:'RollingUpdate',rollingUpdate:{maxUnavailable:0,maxSurge:1}};
  managed.spec.template.metadata.annotations={...managed.spec.template.metadata.annotations,[releaseAnnotation]:'baseline'};
  try {
    const sha=await source.publish(JSON.stringify(managed));
    await kube(['apply','-f','-'],await readFile(controllersPath,'utf8'));
    await kube(['wait','--for=condition=Established','crd/gitrepositories.source.toolkit.fluxcd.io','crd/kustomizations.kustomize.toolkit.fluxcd.io','--timeout=180s']);
    for(const [role] of controllers)await kube(['rollout','status','deployment/'+role,'-n','flux-system','--timeout=180s']);
    await kube(['apply','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:[
      {apiVersion:'source.toolkit.fluxcd.io/v1',kind:'GitRepository',metadata:{name:'p1'},spec:{interval:'15s',url:source.url,ref:{branch:'main'}}},
      {apiVersion:'kustomize.toolkit.fluxcd.io/v1',kind:'Kustomization',metadata:{name:'p1'},spec:{interval:'15s',path:'./',prune:false,wait:true,timeout:'180s',sourceRef:{kind:'GitRepository',name:'p1'}}},
    ]}));
    await waitFluxRevision({kube,sha,value:'baseline',worker:name+'-worker2',deadline:performance.now()+180000,signal});
    return {close:source.close,reconcile:signal=>reconcileFlux({kube,publish:source.publish,deployment:managed,worker:name+'-worker',signal})};
  } catch(error) {await source.close();throw error;}
}

export async function reconcileFlux({kube,publish,deployment,worker,signal,now=()=>performance.now(),sleep}) {
  const managed=structuredClone(deployment),report={};
  const release=value=>{managed.spec.template.metadata.annotations[releaseAnnotation]=value;return JSON.stringify(managed);};
  const phase=async(name,work)=>{
    const start=now(),deadline=start+180000;
    const request=AbortSignal.any([signal,AbortSignal.timeout(180000)].filter(Boolean));
    const wait=options=>waitFluxRevision({kube,worker,deadline,now,sleep,signal:request,...options});
    const command=(args,input)=>kube(args,input,false,request);
    const result=await work(wait,command,request);
    assert.ok(now()-start<=180000,'flux.revision_timeout');report[name]=now()-start;return result;
  };
  let sha=await phase('revisionMs',async(wait,command,request)=>{
    const sha=await publish(release('candidate'),request);await wait({sha,value:'candidate'});return sha;
  });
  await phase('driftMs',async(wait,command)=>{
    await command(['patch','deployment','manifest','--type=merge','-p',JSON.stringify({spec:{template:{metadata:{annotations:{[releaseAnnotation]:'drift'}}}}})]);
    await wait({sha,value:'candidate'});
  });
  sha=await phase('refetchMs',async(wait,command,request)=>{
    const pods=JSON.parse(await command(['get','pods','-n','flux-system','-l','app=source-controller','-o','json','--request-timeout=5s']));
    assert.equal(pods.items.length,1,'flux.source_identity');const previous=pods.items[0].metadata;
    await command(['delete','pod',previous.name,'-n','flux-system','--wait=true','--timeout=180s']);
    const sha=await publish(release('refetched'),request);await wait({sha,value:'refetched',sourceUid:previous.uid});return sha;
  });
  const refused=await phase('refusalMs',async(wait,command,request)=>{
    const attempted=await publish(': [invalid',request);
    const observation=await wait({sha:attempted,applied:sha,rejected:true,value:'refetched'});
    process.stderr.write('Flux render refused '+JSON.stringify(observation)+'\n');return attempted;
  });
  sha=await phase('restoreMs',async(wait,command,request)=>{
    const sha=await publish(release('refetched'),request);await wait({sha,value:'refetched'});return sha;
  });
  return {...report,appliedRevision:sha,attemptedRevision:refused};
}

// Only Git's read protocol is reachable; local publication never uses HTTP.
export async function serveMirror({repository,host='0.0.0.0',port=8000}) {
  const server=createServer((request,response)=>{
    const url=new URL(request.url,'http://mirror');
    if(!(request.method==='GET'&&url.pathname==='/run.git/info/refs'&&url.search==='?service=git-upload-pack'||
      request.method==='POST'&&url.pathname==='/run.git/git-upload-pack'&&url.search==='')) {response.writeHead(403);response.end('forbidden');return;}
    const child=spawn('git',['http-backend'],{env:{...process.env,GIT_PROJECT_ROOT:repository,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:url.pathname,
      QUERY_STRING:url.search.slice(1),REQUEST_METHOD:request.method,CONTENT_TYPE:request.headers['content-type']??'',
      CONTENT_LENGTH:request.headers['content-length']??'',GIT_PROTOCOL:request.headers['git-protocol']??''},stdio:['pipe','pipe','ignore']});
    let headers=Buffer.alloc(0),started=false;
    child.stdin.on('error',()=>{});request.pipe(child.stdin);
    child.stdout.on('data',part=>{
      if(started){response.write(part);return;}
      headers=Buffer.concat([headers,part]);const end=headers.indexOf('\r\n\r\n');if(end<0)return;
      for(const line of headers.subarray(0,end).toString().split('\r\n')) {
        const at=line.indexOf(':');if(at<0)continue;
        const key=line.slice(0,at),value=line.slice(at+1).trim();
        if(key.toLowerCase()==='status')response.statusCode=parseInt(value,10);else response.setHeader(key,value);
      }
      started=true;response.write(headers.subarray(end+4));headers=undefined;
    });
    child.once('error',()=>{if(!response.headersSent)response.writeHead(500);response.end();});
    child.once('close',()=>{if(!started&&!response.headersSent)response.writeHead(500);response.end();});
    response.once('close',()=>child.kill('SIGTERM'));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv[2]==='--serve-mirror') {
  const server=await serveMirror({repository:process.argv[3]});
  const close=()=>{server.closeAllConnections();server.close();};process.once('SIGTERM',close);process.once('SIGINT',close);
}
