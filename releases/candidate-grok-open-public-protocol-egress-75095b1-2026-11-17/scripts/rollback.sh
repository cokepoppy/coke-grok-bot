#!/usr/bin/env bash
set -euo pipefail
context="${KUBE_CONTEXT:-k3d-tp1121-sandbox-dev}"
previous='coke-grok-desktop-broker:candidate-skill-library-20261115-r2'
kubectl --context "$context" -n coke-grok-bot set image deployment/coke-grok-desktop-broker "broker=$previous"
kubectl --context "$context" -n coke-grok-bot rollout status deployment/coke-grok-desktop-broker --timeout=180s
while IFS= read -r namespace; do
  [[ -n "$namespace" ]] || continue
  policy="$(kubectl --context "$context" -n "$namespace" get networkpolicy desktop-isolation -o json)"
  index="$(printf '%s' "$policy" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s),i=p.spec.egress.findIndex(r=>r.to?.some(t=>t.ipBlock?.cidr==="0.0.0.0/0"));if(i<0)process.exit(2);process.stdout.write(String(i))})')"
  has_ports="$(printf '%s' "$policy" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s),i=p.spec.egress.findIndex(r=>r.to?.some(t=>t.ipBlock?.cidr==="0.0.0.0/0"));process.stdout.write(p.spec.egress[i].ports?"yes":"no")})')"
  if [[ "$has_ports" == 'no' ]]; then
    patch="$(node -e 'process.stdout.write(JSON.stringify([{op:"add",path:`/spec/egress/${process.argv[1]}/ports`,value:[{protocol:"TCP",port:80},{protocol:"TCP",port:443}]}]))' "$index")"
    kubectl --context "$context" -n "$namespace" patch networkpolicy desktop-isolation --type=json -p "$patch"
  fi
done < <(kubectl --context "$context" get ns -l app.kubernetes.io/managed-by=coke-grok-bot -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const n of JSON.parse(s).items)if(n.metadata.name.startsWith("grok-user-"))console.log(n.metadata.name)})')
