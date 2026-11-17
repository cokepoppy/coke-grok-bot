#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args=process.argv.slice(2);
const contextIndex=args.indexOf('--context');
const context=contextIndex>=0?args[contextIndex+1]:'';
const snapshotPath=args.find((value,index)=>value!=='--context'&&index!==contextIndex+1);
if(!snapshotPath||!context)throw new Error('Usage: node scripts/rollback-k3d-release.mjs <pre-deploy-state.json> --context <k3d-context>');
const snapshot=JSON.parse(await readFile(resolve(snapshotPath),'utf8'));
if(snapshot.context!==context||!/^k3d-[a-z0-9-]+$/.test(context))throw new Error('Snapshot does not match the requested K3D context');
patchConfig(snapshot.authRuntimeImageConfig);
for(const pin of snapshot.desktopImagePins){
  run('kubectl',['--context',context,'-n',pin.namespace,'delete','cm','desktop-image-pin','--ignore-not-found=true','--wait=true']);
  if(pin.exists)run('kubectl',['--context',context,'-n',pin.namespace,'create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'ConfigMap',metadata:{name:'desktop-image-pin',namespace:pin.namespace,labels:pin.labels},immutable:pin.immutable,data:pin.data}));
}
for(const deployment of snapshot.deployments){
  const patch={spec:{template:{spec:{}}}};
  if(deployment.containers?.length)patch.spec.template.spec.containers=deployment.containers;
  if(deployment.initContainers?.length)patch.spec.template.spec.initContainers=deployment.initContainers;
  if(!Object.keys(patch.spec.template.spec).length)continue;
  run('kubectl',['--context',context,'-n',deployment.namespace,'patch','deployment',deployment.name,'--type=strategic','-p',JSON.stringify(patch)]);
}
for(const deployment of snapshot.deployments)run('kubectl',['--context',context,'-n',deployment.namespace,'rollout','status',`deployment/${deployment.name}`,'--timeout=300s']);
if(JSON.stringify(mysqlIdentity())!==JSON.stringify(snapshot.mysqlPods)||JSON.stringify(pvcIdentity())!==JSON.stringify(snapshot.persistentVolumeClaims))throw new Error('MySQL Pod or PVC identity changed; rollback did not verify persistence state');
console.log(`Restored the captured Grok Bot image references and pins from ${snapshot.capturedAt}. MySQL and PVC identities are unchanged.`);

function run(command,commandArgs,input){
  const result=spawnSync(command,commandArgs,{encoding:'utf8',input,maxBuffer:16*1024*1024});
  if(result.error||result.status!==0){if(result.stderr)process.stderr.write(result.stderr);throw new Error(`${command} rollback step failed (${commandArgs.slice(0,3).join(' ')})`)}
  if(result.stdout)process.stdout.write(result.stdout);
  return result.stdout;
}
function getJson(...commandArgs){
  const result=spawnSync('kubectl',['--context',context,...commandArgs,'-o','json'],{encoding:'utf8',maxBuffer:16*1024*1024});
  if(result.error||result.status!==0)throw new Error('Kubernetes rollback verification query failed');
  return JSON.parse(result.stdout);
}
function patchConfig(data){run('kubectl',['--context',context,'-n','coke-grok-bot','patch','cm','auth-runtime-config','--type=merge','-p',JSON.stringify({data})]);}
function mysqlIdentity(){
  return getJson('get','pods','-A').items.filter(p=>p.metadata.namespace==='coke-auth'&&p.metadata.name.startsWith('mysql')).map(p=>({namespace:p.metadata.namespace,name:p.metadata.name,uid:p.metadata.uid,images:(p.spec.containers||[]).map(c=>c.image)})).sort((a,b)=>a.name.localeCompare(b.name));
}
function pvcIdentity(){
  return getJson('get','pvc','-A').items.filter(p=>p.metadata.namespace==='coke-auth'||p.metadata.namespace.startsWith('grok-user-')).map(p=>({namespace:p.metadata.namespace,name:p.metadata.name,uid:p.metadata.uid,phase:p.status?.phase})).sort((a,b)=>`${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
}
