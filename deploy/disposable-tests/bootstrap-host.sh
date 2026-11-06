#!/bin/bash
set -euo pipefail
export LC_ALL=C

fail() { echo "$*" >&2; exit 1; }
check_host() {
  test "$(id -u)" = 0 || fail 'Root is required on the dedicated test host'
  test "$(uname -m)" = x86_64 || fail 'Expected x86_64'
  . /etc/os-release
  test "$ID:$VERSION_ID" = debian:13 || fail 'Expected Debian 13'
  test -c /dev/kvm || fail 'KVM device is missing'
}
mode=${1:-}
case "$mode" in
  --metadata)
    test "$#" = 1 || fail 'Usage: bootstrap-host.sh --metadata'
    check_host
    timeout 180 apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 update
    for package in qemu-system-x86 qemu-utils cloud-image-utils nftables; do
      version=$(apt-cache policy "$package" | awk '/Candidate:/ {print $2}')
      test -n "$version" && test "$version" != '(none)' || fail "Missing candidate for $package"
      echo "$package=$version"
    done
    exit 0
    ;;
  --plan|--install) test "$#" = 2 || fail 'Invalid package pins: manifest required' ;;
  *) fail 'Usage: bootstrap-host.sh --metadata | --plan PINS | --install PINS' ;;
esac
pins=()
while IFS= read -r pin || test -n "$pin"; do
  [[ "$pin" =~ ^(qemu-system-x86|qemu-utils|cloud-image-utils|nftables)=[a-zA-Z0-9:.+~_-]+$ ]] || fail 'Invalid package pin'
  pins+=("$pin")
done < "$2"
test "${#pins[@]}" = 4 || fail 'Invalid package pins: expected four packages'
for package in qemu-system-x86 qemu-utils cloud-image-utils nftables; do
  count=0
  for pin in "${pins[@]}"; do
    if [[ "$pin" == "$package="* ]]; then count=$((count+1)); fi
  done
  test "$count" = 1 || fail "Invalid package pins: $package must occur once"
done
if test "$mode" = --plan; then printf '%s\n' "${pins[@]}"; exit 0; fi
check_host
# Prevent package installation from starting unrelated host services. This file
# belongs to this invocation only; an existing administrator policy is preserved.
policy=/usr/sbin/policy-rc.d
created_policy=0
cleanup() { if test "$created_policy" = 1; then rm -- "$policy"; fi; }
trap cleanup EXIT
if ! test -e "$policy" && ! test -L "$policy"; then
  (set -o noclobber; printf '#!/bin/sh\nexit 101\n' > "$policy")
  created_policy=1
  chmod 755 "$policy"
fi
DEBIAN_FRONTEND=noninteractive timeout 300 apt-get -o Dpkg::Lock::Timeout=10 -o Acquire::Retries=1 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 install --no-install-recommends -y "${pins[@]}"
for pin in "${pins[@]}"; do
  package=${pin%%=*}
  actual=$(dpkg-query -W -f='${Version}' "$package")
  test "$package=$actual" = "$pin" || fail "Installed version differs for $package"
done
qemu-system-x86_64 --version
qemu-img --version
command -v cloud-localds
