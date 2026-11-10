#!/usr/bin/env python3
import json,subprocess,sys
p=json.load(sys.stdin)
code="import fs from 'node:fs';import {pathToFileURL} from 'node:url';const file=process.argv[1],c=JSON.parse(fs.readFileSync(file)),root=file.slice(0,file.lastIndexOf('/'));const {GithubApp}=await import(pathToFileURL(root+'/scripts/disposable-tests/github-app.mjs'));const repo=await new GithubApp(c.ci).get('/repos/'+c.ci.repository);if(repo.id!==c.ci.repositoryId)throw Error('App repository differs');const {SSHTransport}=await import(pathToFileURL(root+'/scripts/disposable-tests/transport.mjs'));if((await new SSHTransport(c).healthySlots({signal:AbortSignal.timeout(15000)})).length!==c.slots)throw Error('Server SSH capacity unavailable');console.log('Read-only App and both-host SSH verified')"
subprocess.run([p['node'],'--input-type=module','-e',code,p['configuration']],check=True,timeout=40)
subprocess.run(['python3','-B',p['recipe']+'/host-runtime.test.py',p['recipe']+'/host.py','--peers',','.join(p['peers'])],check=True,timeout=900)
