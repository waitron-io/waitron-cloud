#!/bin/bash
set -euo pipefail
phase=${1:-}
case "$phase" in prepare|mesh|control|join|storage) ;; *) echo 'Unknown bootstrap phase' >&2; exit 1 ;; esac
[ "$(id -u)" = 0 ]
export DEBIAN_FRONTEND=noninteractive
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
  containerd config default | sed 's/SystemdCgroup = false/SystemdCgroup = true/' > /etc/containerd/config.toml
  systemctl restart containerd
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
  kubeadm init --kubernetes-version=v1.34.3 --apiserver-advertise-address=10.77.0.1 --pod-network-cidr=10.244.0.0/16
  export KUBECONFIG=/etc/kubernetes/admin.conf
  kubectl config rename-context kubernetes-admin@kubernetes "$2"
  kubectl taint node "$(hostname)" node-role.kubernetes.io/control-plane:NoSchedule-
  curl -fsSL https://raw.githubusercontent.com/flannel-io/flannel/v0.27.3/Documentation/kube-flannel.yml | sed '/- --kube-subnet-mgr/a\        - --iface=wg0' | kubectl apply -f -
  ;;
join)
  # The short-lived kubeadm join command arrives privately from this run's control plane.
  read -r -a command
  [ "${command[0]}" = kubeadm ]; [ "${command[1]}" = join ]; [ "${command[2]}" = 10.77.0.1:6443 ]
  "${command[@]}"
  ;;
esac
