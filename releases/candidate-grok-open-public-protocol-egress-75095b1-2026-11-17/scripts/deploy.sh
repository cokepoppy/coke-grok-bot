#!/usr/bin/env bash
set -euo pipefail
context="${KUBE_CONTEXT:-k3d-tp1121-sandbox-dev}"
cluster="${K3D_CLUSTER:-tp1121-sandbox-dev}"
image='coke-grok-desktop-broker:sha-75095b1ddd5b72dcd27d56c215b4d65c67cfdbe8'
command -v docker >/dev/null
docker image inspect "$image" >/dev/null
k3d image import -c "$cluster" "$image"
kubectl --context "$context" -n coke-grok-bot set image deployment/coke-grok-desktop-broker "broker=$image"
kubectl --context "$context" -n coke-grok-bot rollout status deployment/coke-grok-desktop-broker --timeout=180s
while IFS= read -r namespace; do
  [[ -n "$namespace" ]] || continue
  policy="$(kubectl --context "$context" -n "$namespace" get networkpolicy desktop-isolation -o json)"
  index="$(printf '%s' "$policy" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s),i=p.spec.egress.findIndex(r=>r.to?.some(t=>t.ipBlock?.cidr==="0.0.0.0/0"));if(i<0)process.exit(2);process.stdout.write(String(i))})')"
  has_ports="$(printf '%s' "$policy" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s),i=p.spec.egress.findIndex(r=>r.to?.some(t=>t.ipBlock?.cidr==="0.0.0.0/0"));process.stdout.write(p.spec.egress[i].ports?"yes":"no")})')"
  if [[ "$has_ports" == 'yes' ]]; then
    patch="$(node -e 'process.stdout.write(JSON.stringify([{op:"remove",path:`/spec/egress/${process.argv[1]}/ports`}]))' "$index")"
    kubectl --context "$context" -n "$namespace" patch networkpolicy desktop-isolation --type=json -p "$patch"
  fi
done < <(kubectl --context "$context" get ns -l app.kubernetes.io/managed-by=coke-grok-bot -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const n of JSON.parse(s).items)if(n.metadata.name.startsWith("grok-user-"))console.log(n.metadata.name)})')
"$(dirname "$0")/verify.sh"
