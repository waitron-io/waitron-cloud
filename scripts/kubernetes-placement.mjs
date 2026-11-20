import {setTimeout as delay} from 'node:timers/promises';

export const separateByHost = matchLabels => ({podAntiAffinity: {requiredDuringSchedulingIgnoredDuringExecution: [
  {labelSelector: {matchLabels}, topologyKey: 'kubernetes.io/hostname'}
]}});

export async function spreadCoreDns(kube, nodes) {
  // Each survivor needs a local DNS endpoint even while a dead replica still looks ready.
  await kube(['patch', 'deployment', 'coredns', '-n', 'kube-system', '--type=merge', '-p',
    JSON.stringify({spec: {replicas: nodes.length, strategy: {type: 'RollingUpdate', rollingUpdate: {maxSurge: 0, maxUnavailable: 1}},
      template: {spec: {affinity: separateByHost({'k8s-app': 'kube-dns'})}}}})]);
  await kube(['rollout', 'status', 'deployment/coredns', '-n', 'kube-system', '--timeout=120s'], {timeout: 125_000});
  await kube(['patch', 'service', 'kube-dns', '-n', 'kube-system', '--type=merge', '-p',
    JSON.stringify({spec: {trafficDistribution: 'PreferSameNode'}})]);
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const {items} = JSON.parse(await kube(['get', 'endpointslices', '-n', 'kube-system',
      '-l', 'kubernetes.io/service-name=kube-dns', '-o', 'json'], {timeout: 10_000}));
    const local = new Set(items.flatMap(slice => slice.endpoints).filter(endpoint => endpoint.conditions?.ready === true &&
      endpoint.hints?.forNodes?.some(hint => hint.name === endpoint.nodeName)).map(endpoint => endpoint.nodeName));
    if (nodes.every(node => local.has(node))) return;
    await delay(250);
  }
  throw Error('CoreDNS has no ready endpoint with a local routing hint on every machine');
}
