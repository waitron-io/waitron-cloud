#!/bin/bash
set -euo pipefail
test "$#" = 0 || { echo 'Usage: harden-ssh.sh' >&2; exit 2; }
test "$(id -u)" = 0 || { echo 'Dedicated root test host required' >&2; exit 1; }
. /etc/os-release
test "$ID:$VERSION_ID" = debian:13 || { echo 'Debian 13 required' >&2; exit 1; }
recipe=$(cd -- "$(dirname -- "$0")" && pwd -P)
source_file="$recipe/ssh-policy.conf"
target=/etc/ssh/sshd_config.d/00-00-waitron-disposable.conf
test -f "$source_file" && ! test -L "$source_file"
test -d /etc/ssh/sshd_config.d && ! test -L /etc/ssh/sshd_config.d
sshd -t
systemctl is-active --quiet ssh.service
created=0
completed=0
temporary=''
cleanup() {
  test -z "$temporary" || rm -- "$temporary"
  if test "$completed" = 0 && test "$created" = 1; then
    if cmp -s "$source_file" "$target"; then
      rm -- "$target"
      sshd -t && systemctl reload ssh.service
    else
      echo 'SSH policy changed during validation; inspect before recovery' >&2
    fi
  fi
}
trap cleanup EXIT
if test -e "$target" || test -L "$target"; then
  test -f "$target" && ! test -L "$target" && cmp -s "$source_file" "$target" || {
    echo 'Existing SSH policy belongs to another recipe; refusing replacement' >&2; exit 1;
  }
else
  temporary=$(mktemp /etc/ssh/sshd_config.d/.waitron-ssh-XXXXXX)
  cat "$source_file" > "$temporary"
  chmod 600 "$temporary"
  ln -- "$temporary" "$target"
  created=1
fi
sshd -t
source_address=${SSH_CONNECTION:-127.0.0.1}
source_address=${source_address%% *}
policy=$(sshd -T -C "user=root,host=disposable,addr=$source_address")
for pair in 'passwordauthentication no' 'kbdinteractiveauthentication no' 'pubkeyauthentication yes'; do
  if ! printf '%s\n' "$policy" | grep -Fx "$pair" > /dev/null; then echo "Effective SSH policy differs: $pair" >&2; exit 1; fi
done
printf '%s\n' "$policy" | grep -E '^permitrootlogin (without-password|prohibit-password)$' > /dev/null
systemctl reload ssh.service
completed=1
printf '%s\n' "$policy" | grep -E '^(passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|permitrootlogin) '
