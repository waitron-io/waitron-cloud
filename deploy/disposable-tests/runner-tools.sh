#!/bin/bash
set -euo pipefail
# This runs only after guest-tools.sh has verified the disposable KVM guest.
export DEBIAN_FRONTEND=noninteractive
timeout 60s apt-get install -y --no-install-recommends 'libicu76=76.1-4'
temporary=$(mktemp -d /tmp/disposable-runner.XXXXXXXX)
trap 'rm -rf -- "$temporary"' EXIT
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 120 --max-filesize 268435456 \
  https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-linux-x64-2.338.2.tar.gz -o "$temporary/runner.tgz"
printf '%s  %s\n' baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40 "$temporary/runner.tgz" | sha256sum --check --status
mkdir /opt/actions-runner
tar --extract --gzip --file "$temporary/runner.tgz" --directory /opt/actions-runner --no-same-owner
/opt/actions-runner/bin/Runner.Listener --version | tee /opt/waitron-tools/runner-version.txt
test "$(cat /opt/waitron-tools/runner-version.txt)" = '2.338.2'
sha256sum /opt/actions-runner/bin/Runner.Listener > /opt/waitron-tools/runner-listener.sha256
