#!/bin/bash
# Every candidate gets fresh tools and a private daemon inside its own VM.
set -euo pipefail
if ! test -r /etc/os-release || ! test -r /var/lib/cloud/data/instance-id; then
  echo 'A fresh disposable Debian 13 guest is required' >&2; exit 1
fi
. /etc/os-release
instance=$(cat /var/lib/cloud/data/instance-id)
virtualisation=$(systemd-detect-virt --vm || true)
if test "${ID:-}" != debian || test "${VERSION_ID:-}" != 13 || test "$(id -u)" != 0 ||
   test "$(uname -m)" != x86_64 || ! [[ "$instance" =~ ^dt-[A-Za-z0-9_-]+-0-[1-9][0-9]*$ ]] ||
   ! [[ "$virtualisation" =~ ^(kvm|qemu)$ ]]; then
  echo 'A fresh disposable Debian 13 x86 KVM guest is required' >&2; exit 1
fi
export DEBIAN_FRONTEND=noninteractive
# A missing version refuses preparation. It must never silently change the tool set.
timeout 120s apt-get update -qq
timeout 180s apt-get install -y --no-install-recommends \
  'docker.io=26.1.5+dfsg1-9+deb13u1' 'docker-cli=26.1.5+dfsg1-9+deb13u1' 'docker-compose=2.26.1-4' 'git=1:2.47.3-0+deb13u1'
temporary=$(mktemp -d /tmp/disposable-tools.XXXXXXXX)
trap 'rm -rf -- "$temporary"' EXIT
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 60 --max-filesize 134217728 \
  https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.xz -o "$temporary/node.tar.xz"
printf '%s  %s\n' d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997 "$temporary/node.tar.xz" | sha256sum --check --status
mkdir -p /opt/waitron-tools/pnpm
tar --extract --xz --file "$temporary/node.tar.xz" --directory /opt/waitron-tools --no-same-owner
for tool in node npm npx; do
  ln -s /opt/waitron-tools/node-v26.13.0-linux-x64/bin/"$tool" /usr/local/bin/"$tool"
done
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 30 --max-filesize 33554432 \
  https://registry.npmjs.org/pnpm/-/pnpm-9.15.0.tgz -o "$temporary/pnpm.tgz"
python3 - "$temporary/pnpm.tgz" <<'PY'
import base64,hashlib,sys
with open(sys.argv[1],'rb') as source:
    actual=hashlib.file_digest(source,'sha512').digest()
expected=base64.b64decode('duI3l2CkMo7EQVgVvNZije5yevN3mqpMkU45RBVsQpmSGon5djge4QfUHxLPpLZmgcqccY8GaPoIMe1MbYulbA==')
if actual!=expected:raise SystemExit('Pinned pnpm integrity mismatch')
PY
tar --extract --gzip --file "$temporary/pnpm.tgz" --directory /opt/waitron-tools/pnpm --no-same-owner
ln -s /opt/waitron-tools/pnpm/package/bin/pnpm.cjs /usr/local/bin/pnpm
systemctl start docker
node --version
pnpm --version
docker compose version
docker info --format '{{.ServerVersion}}'
dpkg-query -W -f='${Package}=${Version}\n' > /opt/waitron-tools/installed-packages.txt
