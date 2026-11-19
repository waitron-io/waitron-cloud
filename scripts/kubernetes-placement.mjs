export const separateByHost = matchLabels => ({podAntiAffinity: {requiredDuringSchedulingIgnoredDuringExecution: [
  {labelSelector: {matchLabels}, topologyKey: 'kubernetes.io/hostname'}
]}});

export async function spreadCoreDns(kube) {
  // One lost machine must leave DNS available to the surviving workloads.
  await kube(['patch', 'deployment', 'coredns', '-n', 'kube-system', '--type=merge', '-p',
    JSON.stringify({spec: {template: {spec: {affinity: separateByHost({'k8s-app': 'kube-dns'})}}}})]);
  await kube(['rollout', 'status', 'deployment/coredns', '-n', 'kube-system', '--timeout=120s'], {timeout: 125_000});
}
