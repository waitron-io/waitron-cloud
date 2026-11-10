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
   test "$(uname -m)" != x86_64 || ! [[ "$instance" =~ ^dt-[A-Za-z0-9_-]+-([0-9]|1[0-5])-[1-9][0-9]*$ ]] ||
   ! [[ "$virtualisation" =~ ^(kvm|qemu)$ ]]; then
  echo 'A fresh disposable Debian 13 x86 KVM guest is required' >&2; exit 1
fi
# BEGIN offline check
packages=(
  'docker.io=26.1.5+dfsg1-9+deb13u1' 'docker-cli=26.1.5+dfsg1-9+deb13u1' 'docker-compose=2.26.1-4' 'git=1:2.47.3-0+deb13u1'
  'zip=3.0-15+deb13u1' 'unzip=6.0-29+deb13u1' 'jq=1.7.1-6+deb13u4'
  'fonts-dejavu-core=2.37-8'
  'xvfb=2:21.1.16-1.3+deb13u4' 'fonts-noto-color-emoji=2.051-0+deb13u1'
  'fonts-unifont=1:15.1.01-1' 'libfontconfig1=2.15.0-2.3'
  'libfreetype6=2.13.3+dfsg-1+deb13u1' 'xfonts-scalable=1:1.0.3-1.3'
  'fonts-liberation=1:2.1.5-3' 'fonts-ipafont-gothic=00303-23'
  'fonts-wqy-zenhei=0.9.45-8' 'fonts-tlwg-loma-otf=1:0.7.3-1'
  'fonts-freefont-ttf=20211204+svn4273-2' 'libasound2t64=1.2.14-1+deb13u1'
  'libatk-bridge2.0-0t64=2.56.2-1+deb13u2' 'libatk1.0-0t64=2.56.2-1+deb13u2'
  'libatspi2.0-0t64=2.56.2-1+deb13u2' 'libcairo2=1.18.4-1+b1'
  'libcups2t64=2.4.10-3+deb13u2' 'libdbus-1-3=1.16.2-2'
  'libdrm2=2.4.124-2' 'libgbm1=25.0.7-2+deb13u1'
  'libglib2.0-0t64=2.84.4-3~deb13u5' 'libnspr4=2:4.36-1'
  'libnss3=2:3.110-1+deb13u5' 'libpango-1.0-0=1.56.3-1'
  'libx11-6=2:1.8.12-1' 'libxcb1=1.17.0-2+b1'
  'libxcomposite1=1:0.4.6-1' 'libxdamage1=1:1.1.6-1+b2'
  'libxext6=2:1.3.4-1+b3' 'libxfixes3=1:6.0.0-2+b4'
  'libxkbcommon0=1.7.0-2' 'libxrandr2=2:1.5.4-1+b3'
)
check_tools() {
  local pin
  for pin in "${packages[@]}"; do
    test "$(dpkg-query -W -f='${Version}' "${pin%%=*}")" = "${pin#*=}"
  done
  test "$(node --version)" = v26.13.0
  test "$(pnpm --version)" = 9.15.0
  test "$(docker compose version --short)" = 2.26.1-4
}
# END offline check
if test "${1:-}" = --check; then
  systemctl start docker
  check_tools
  docker info --format '{{.ServerVersion}}'
  exit
fi
export DEBIAN_FRONTEND=noninteractive
# A missing version refuses preparation. It must never silently change the tool set.
timeout 120s apt-get update -qq
# DejaVu supplies system-ui before the regional Chromium fonts can become its fallback.
# Include Chromium libraries and fonts before candidate browser tests start.
timeout 180s apt-get install -y --no-install-recommends "${packages[@]}"
temporary=$(mktemp -d /tmp/disposable-tools.XXXXXXXX)
trap 'rm -rf -- "$temporary"' EXIT
# BEGIN bounded download
download() {
  local tool=$1 budget=$2 limit=$3 url=$4 output=$5
  local end=$((SECONDS + budget)) attempt remaining status=0 http=000 reason='budget exhausted'
  for attempt in 1 2 3; do
    remaining=$((end - SECONDS))
    if ((remaining <= 0)); then reason='budget exhausted'; break; fi
    rm -f -- "$output"
    status=0
    http=$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
      --connect-timeout 10 --max-time "$remaining" --max-filesize "$limit" \
      --write-out '%{http_code}' "$url" -o "$output" 2>/dev/null) || status=$?
    http=${http:-000}
    case "$http" in 4??) reason='HTTP request refused'; break;; esac
    if ((status == 0)); then return 0; fi
    reason='request failed'
    case "$status:$http" in
      22:5??|6:*|7:*|18:*|28:*|52:*|55:*|56:*) ;;
      *) break;;
    esac
    if ((SECONDS >= end)); then reason='budget exhausted'; break; fi
    if ((attempt < 3)); then
      printf '%s download attempt %s failed (curl %s HTTP %s); retrying\n' "$tool" "$attempt" "$status" "$http"
      sleep 1
    fi
  done
  printf '%s download failed: %s (curl %s HTTP %s)\n' "$tool" "$reason" "$status" "$http" >&2
  return 1
}
# END bounded download
download Node 60 134217728 https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.xz "$temporary/node.tar.xz"
printf '%s  %s\n' d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997 "$temporary/node.tar.xz" | sha256sum --check --status || { echo 'Node integrity mismatch' >&2; exit 1; }
mkdir -p /opt/waitron-tools/pnpm
tar --extract --xz --file "$temporary/node.tar.xz" --directory /opt/waitron-tools --no-same-owner
for tool in node npm npx; do
  ln -s /opt/waitron-tools/node-v26.13.0-linux-x64/bin/"$tool" /usr/local/bin/"$tool"
done
download pnpm 30 33554432 https://registry.npmjs.org/pnpm/-/pnpm-9.15.0.tgz "$temporary/pnpm.tgz"
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
