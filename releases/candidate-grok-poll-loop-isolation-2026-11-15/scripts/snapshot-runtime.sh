#!/usr/bin/env bash
set -euo pipefail
CONTEXT="k3d-tp1121-sandbox-dev"
NS="coke-grok-bot"
OUT="${1:?output prefix required}"
[[ "$(kubectl config current-context)" == "$CONTEXT" ]]
kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth coke-grok-desktop-broker -o json |
node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const x of JSON.parse(s).items){const c=x.spec.template.spec.containers.map(c=>`${c.name}=${c.image}`).join(",");console.log(`${x.metadata.name}|generation=${x.metadata.generation}|ready=${x.status.readyReplicas||0}/${x.spec.replicas}|${c}`)}})' > "$OUT.control"
kubectl --context "$CONTEXT" get pods -A -o json |
node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const crypto=require("node:crypto");const ps=JSON.parse(s).items.filter(p=>p.metadata.namespace.startsWith("grok-user-")&&(p.spec.containers||[]).some(c=>["agent","desktop"].includes(c.name)));const ids=ps.map(p=>p.metadata.uid).sort().join("\n");const phases={};for(const p of ps)phases[p.status.phase]=(phases[p.status.phase]||0)+1;console.log(`computerPodCount=${ps.length}`);console.log(`computerPodUidSetSha256=${crypto.createHash("sha256").update(ids).digest("hex")}`);console.log(`phases=${JSON.stringify(phases)}`)})' > "$OUT.computers"
kubectl --context "$CONTEXT" -n coke-auth get pods,pvc -o json |
node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const crypto=require("node:crypto");const a=JSON.parse(s).items;for(const kind of ["Pod","PersistentVolumeClaim"]){const ids=a.filter(x=>x.kind===kind).map(x=>x.metadata.uid).sort().join("\n");console.log(`${kind.toLowerCase()}Count=${ids?a.filter(x=>x.kind===kind).length:0}`);console.log(`${kind.toLowerCase()}UidSetSha256=${crypto.createHash("sha256").update(ids).digest("hex")}`)}})' > "$OUT.database-identities"
