#!/usr/bin/env python3
import json,os,stat,sys
from pathlib import Path
KEYS=Path('/root/.ssh/authorized_keys')
OWNER=0

def authorize(p):
 key=p['key'];assert len(key.splitlines())==1 and key.startswith('ssh-ed25519 ')
 path=KEYS;info=path.lstat();assert stat.S_ISREG(info.st_mode) and info.st_uid==OWNER and not info.st_mode&0o022
 body=path.read_text();line='from="'+p['host']+'",restrict '+key
 if not any(key.split()[1] in value.split() for value in body.splitlines()):
  with path.open('a') as output:output.write(('' if not body or body.endswith('\n') else '\n')+line+'\n');output.flush();os.fsync(output.fileno())

if __name__=='__main__':authorize(json.load(sys.stdin))
