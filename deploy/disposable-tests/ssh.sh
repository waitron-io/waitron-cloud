#!/bin/bash
set -euo pipefail
mode=command
if test "${1:-}" = --check; then mode=check; shift; fi
host=${1:-}
[[ "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.:-]*$ ]] || { echo 'Invalid test host' >&2; exit 2; }
shift
if test "$mode" = command && test "$#" -lt 1; then echo 'A remote command is required' >&2; exit 2; fi
connection_directory=$(python3 - "${XDG_CACHE_HOME:-$HOME/.cache}/wt-ssh" <<'PY'
import os,stat,sys
from pathlib import Path
p=Path(sys.argv[1])
if p.is_symlink():
    raise SystemExit('The SSH connection directory must be private, never linked')
p.mkdir(mode=0o700,parents=True,exist_ok=True)
s=p.stat()
if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.geteuid() or stat.S_IMODE(s.st_mode)!=0o700:
    raise SystemExit('The SSH connection directory must be private and owned by you')
print(p)
PY
)
options=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8
  -o ServerAliveInterval=15 -o ServerAliveCountMax=2
  -o ControlMaster=auto -o ControlPersist=600
  -o "ControlPath=$connection_directory/%C")
if test "$mode" = check; then
  exec ssh "${options[@]}" -O check "root@$host"
fi
exec ssh "${options[@]}" "root@$host" "$@"
