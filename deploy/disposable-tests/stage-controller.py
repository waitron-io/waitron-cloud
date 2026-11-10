#!/usr/bin/env python3
import importlib.util,json,sys,tarfile,tempfile
from pathlib import Path
p=json.loads(sys.stdin.buffer.readline(65537))
assert 0<p['archiveBytes']<=16*1024*1024 and 0<p['envBytes']<=65536 and 0<p['keyBytes']<=65536
with tempfile.TemporaryDirectory(prefix='waitron-controller-stage-') as temporary:
 archive=Path(temporary)/'source.tar';archive.write_bytes(sys.stdin.buffer.read(p['archiveBytes']))
 with tarfile.open(archive,'r:') as source:source.extractall(temporary,filter='data')
 env=sys.stdin.buffer.read(p['envBytes']);key=sys.stdin.buffer.read(p['keyBytes'])
 assert len(env)==p['envBytes'] and len(key)==p['keyBytes']
 spec=importlib.util.spec_from_file_location('installer',Path(temporary)/'deploy/disposable-tests/install-controller.py')
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 module.prepare_runtime();print(json.dumps(module.install(p,env,key)))
