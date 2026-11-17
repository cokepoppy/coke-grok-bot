#!/usr/bin/env bash
set -euo pipefail
context="${KUBE_CONTEXT:-k3d-tp1121-sandbox-dev}"
kubectl --context "$context" -n coke-grok-bot get deployment coke-grok-desktop-broker -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s),c=d.spec.template.spec.containers.find(x=>x.name==="broker");if((d.status.readyReplicas||0)!==1)process.exit(1);console.log(`broker ready image=${c.image}`)})'
kubectl --context "$context" get networkpolicy -A -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).items.filter(x=>x.metadata.name==="desktop-isolation"&&x.metadata.namespace.startsWith("grok-user-"));for(const x of p){const r=x.spec.egress.find(e=>e.to?.some(t=>t.ipBlock?.cidr==="0.0.0.0/0"));if(!r||r.ports)process.exit(1)}if(p.length!==4)process.exit(1);console.log(`public egress unrestricted by protocol/port in ${p.length} user namespaces`)})'
