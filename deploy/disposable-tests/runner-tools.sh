#!/bin/bash
set -euo pipefail
# This runs only after guest-tools.sh has verified the disposable KVM guest.
export DEBIAN_FRONTEND=noninteractive
timeout 60s apt-get install -y --no-install-recommends 'libicu76=76.1-4' 'sudo=1.9.16p2-3+deb13u2'
temporary=$(mktemp -d /tmp/disposable-runner.XXXXXXXX)
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
download Actions-runner 120 268435456 https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-linux-x64-2.338.2.tar.gz "$temporary/runner.tgz"
printf '%s  %s\n' baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40 "$temporary/runner.tgz" | sha256sum --check --status || { echo 'Actions runner integrity mismatch' >&2; exit 1; }
mkdir /opt/actions-runner
tar --extract --gzip --file "$temporary/runner.tgz" --directory /opt/actions-runner --no-same-owner
/opt/actions-runner/bin/Runner.Listener --version | tee /opt/waitron-tools/runner-version.txt
test "$(cat /opt/waitron-tools/runner-version.txt)" = '2.338.2'
sha256sum /opt/actions-runner/bin/Runner.Listener > /opt/waitron-tools/runner-listener.sha256
useradd --uid 1001 --user-group --create-home --groups docker --shell /bin/bash runner
chown -R runner:runner /opt/actions-runner
printf '%s\n' 'runner ALL=(ALL:ALL) NOPASSWD:ALL' > /etc/sudoers.d/waitron-runner
chmod 0440 /etc/sudoers.d/waitron-runner
visudo --check --file=/etc/sudoers.d/waitron-runner
