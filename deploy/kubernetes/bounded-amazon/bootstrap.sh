#!/bin/bash
set -euo pipefail
phase=${1:-}
case "$phase" in prepare|mesh|control|join|storage) ;; *) echo 'Unknown bootstrap phase' >&2; exit 1 ;; esac
[ "$(id -u)" = 0 ]
export DEBIAN_FRONTEND=noninteractive

api_name=d618-api
hosts_file=${D618_HOSTS_FILE:-/etc/hosts}

mesh_address() {
  local address
  read -r _ _ _ address _ < <(ip -4 -o address show dev wg0 scope global)
  printf '%s\n' "${address%/*}"
}

set_api_address() {
  local other_hosts
  other_hosts=$(awk -v name="$api_name" '$2 != name' "$hosts_file")
  {
    if [ -n "$other_hosts" ]; then printf '%s\n' "$other_hosts"; fi
    printf '%s %s\n' "$1" "$api_name"
  } > "$hosts_file"
}

kubeadm_private() {
  local output
  if ! output=$(kubeadm "$@" 2>&1); then
    printf '%s\n' "${output//"$certificate_key"/[redacted certificate key]}" |
      sed -E 's/[a-z0-9]{6}\.[a-z0-9]{16}/[redacted token]/g' >&2
    return 1
  fi
}

configure_local_api() {
  export KUBECONFIG=/etc/kubernetes/admin.conf
  kubectl config rename-context kubernetes-admin@kubernetes "$1"
  for ((attempt = 0; attempt < 24; attempt++)); do
    if kubectl --request-timeout=5s get --raw=/readyz/etcd >/dev/null &&
       kubectl --request-timeout=5s get --raw=/readyz >/dev/null; then
      kubectl taint node "$(hostname)" node-role.kubernetes.io/control-plane:NoSchedule-
      return
    fi
    sleep 5
  done
  echo 'The local Kubernetes API or etcd did not become ready' >&2
  return 1
}
case "$phase" in
prepare)
  name=$2; address=$3
  [[ "$name" =~ ^d618-[a-f0-9-]+-(control-plane|worker|worker2)$ ]]
  [[ "$address" =~ ^10\.77\.0\.[123]$ ]]
  [ "$(uname -m)" = x86_64 ]
  # shellcheck source=/dev/null
  . /etc/os-release; [ "$ID" = debian ]; [ "$VERSION_ID" = 13 ]
  hostnamectl set-hostname "$name"
  swapoff -a
  modprobe overlay; modprobe br_netfilter
  printf 'net.ipv4.ip_forward=1\nnet.bridge.bridge-nf-call-iptables=1\n' > /etc/sysctl.d/90-d618.conf
  sysctl --system
  apt-get update
  apt-get install -y ca-certificates curl gnupg xz-utils wireguard-tools nfs-common nfs-kernel-server docker.io python3
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.34/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes.gpg
  echo 'deb [signed-by=/etc/apt/keyrings/kubernetes.gpg] https://pkgs.k8s.io/core:/stable:/v1.34/deb/ /' > /etc/apt/sources.list.d/kubernetes.list
  apt-get update
  apt-get install -y kubelet=1.34.3-1.1 kubeadm=1.34.3-1.1 kubectl=1.34.3-1.1
  apt-mark hold kubelet kubeadm kubectl
  # Debian's containerd defaults to /usr/lib/cni and an older pause image; flannel and
  # kubernetes-cni install their plugins in /opt/cni/bin.
  pause=$(kubeadm config images list --kubernetes-version=v1.34.3 | grep '/pause:')
  containerd config default | sed -e 's/SystemdCgroup = false/SystemdCgroup = true/' \
    -e 's#bin_dir = "/usr/lib/cni"#bin_dir = "/opt/cni/bin"#' -e "s#sandbox_image = \".*\"#sandbox_image = \"$pause\"#" > /etc/containerd/config.toml
  systemctl restart containerd
  effective=$(containerd config dump)
  grep -q 'bin_dir = "/opt/cni/bin"' <<<"$effective" || { echo 'containerd does not look for network plugins in /opt/cni/bin' >&2; exit 1; }
  grep -qF "sandbox_image = \"$pause\"" <<<"$effective" || { echo "containerd sandbox image is not kubeadm's $pause" >&2; exit 1; }
  grep -q 'SystemdCgroup = true' <<<"$effective" || { echo 'containerd does not use systemd cgroups' >&2; exit 1; }
  for plugin in bridge loopback portmap; do
    [ -x /opt/cni/bin/$plugin ] || { echo "network plugin $plugin is missing from /opt/cni/bin" >&2; exit 1; }
  done
  printf 'KUBELET_EXTRA_ARGS=--node-ip=%s\n' "$address" > /etc/default/kubelet
  if [ "$address" = 10.77.0.1 ]; then
    apt-get install -y docker-buildx
    mkdir -p /etc/docker
    echo '{"features":{"containerd-snapshotter":false}}' > /etc/docker/daemon.json
  fi
  systemctl enable --now docker kubelet
  systemctl restart docker
  iptables -P FORWARD ACCEPT
  work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
  cd "$work"
  curl -fsSLO https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.xz
  curl -fsSLO https://nodejs.org/dist/v26.13.0/SHASUMS256.txt
  grep ' node-v26.13.0-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum -c -
  tar -xJf node-v26.13.0-linux-x64.tar.xz --strip-components=1 -C /usr/local
  ;;
mesh)
  umask 077
  cat > /etc/wireguard/wg0.conf
  systemctl enable --now wg-quick@wg0
  ;;
storage)
  mkdir -p /var/local/d620-config /etc/exports.d
  if [ "$2" = control ]; then
    chmod 700 /var/local/d620-config
    echo '/var/local/d620-config 10.77.0.2(rw,sync,no_subtree_check,no_root_squash) 10.77.0.3(rw,sync,no_subtree_check,no_root_squash)' > /etc/exports.d/d618.exports
    exportfs -ra
    systemctl restart nfs-server
  else
    echo '10.77.0.1:/var/local/d620-config /var/local/d620-config nfs4 defaults,_netdev 0 0' >> /etc/fstab
    mount /var/local/d620-config
  fi
  mkdir -p /etc/systemd/system/kubelet.service.d
  printf '[Unit]\nRequiresMountsFor=/var/local/d620-config\nAfter=wg-quick@wg0.service\n' > /etc/systemd/system/kubelet.service.d/20-d618-storage.conf
  systemctl daemon-reload
  cd /var/local/d620-config; umask 077
  printf shared > mount-check; test "$(stat -c %a mount-check)" = 600
  test "$(cat mount-check)" = shared; mv mount-check mount-renamed; rm mount-renamed
  ;;
control)
  address=$(mesh_address)
  [ "$address" = 10.77.0.1 ]
  set_api_address "$address"
  certificate_key=$(kubeadm certs certificate-key)
  [[ "$certificate_key" =~ ^[a-f0-9]{64}$ ]]
  kubeadm_private init --kubernetes-version=v1.34.3 --apiserver-advertise-address="$address" \
    --control-plane-endpoint="$api_name:6443" --pod-network-cidr=10.244.0.0/16 \
    --upload-certs --certificate-key="$certificate_key"
  configure_local_api "$2" >&2
  curl -fsSL https://raw.githubusercontent.com/flannel-io/flannel/v0.27.3/Documentation/kube-flannel.yml | sed '/- --kube-subnet-mgr/a\        - --iface=wg0' | kubectl apply -f - >&2
  printf '%s\n' "$certificate_key"
  ;;
join)
  # Credentials arrive on stdin so they stay out of the SSH command and its logs.
  read -r -a command
  read -r certificate_key
  [ "${#command[@]}" = 7 ]
  [ "${command[0]}" = kubeadm ]; [ "${command[1]}" = join ]; [ "${command[2]}" = "$api_name:6443" ]
  [ "${command[3]}" = --token ]; [[ "${command[4]}" =~ ^[a-z0-9]{6}\.[a-z0-9]{16}$ ]]
  [ "${command[5]}" = --discovery-token-ca-cert-hash ]; [[ "${command[6]}" =~ ^sha256:[a-f0-9]{64}$ ]]
  [[ "$certificate_key" =~ ^[a-f0-9]{64}$ ]]
  address=$(mesh_address)
  [[ "$address" =~ ^10\.77\.0\.[23]$ ]]
  set_api_address 10.77.0.1
  kubeadm_private "${command[@]:1}" --control-plane --certificate-key="$certificate_key" \
    --apiserver-advertise-address="$address"
  # Every member keeps the certificate name but uses its own API after joining.
  set_api_address "$address"
  configure_local_api "$2" >&2
  ;;
esac
