#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const contextIndex=args.indexOf('--context');
const planOnly=args.includes('--plan-only');
const context=contextIndex>=0?args[contextIndex+1]:output('kubectl',['config','current-context']).trim();
const positional=[];
for(let index=0;index<args.length;index++){
  if(args[index]==='--context'){index++;continue;}
  if(args[index]==='--plan-only')continue;
  positional.push(args[index]);
}
const manifestPath=resolve(root,positional[0]||'dist/release-images.json');
if(!context||contextIndex>=0&&!args[contextIndex+1])throw new Error('A Kubernetes context is required');
if(!/^k3d-[a-z0-9-]+$/.test(context))throw new Error('The release target must be a named K3D context');
const cluster=context.slice('k3d-'.length);
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const releaseId=manifest.releaseId;
if(!/^sha-[a-f0-9]{40}$/.test(releaseId)||manifest.commit!==releaseId.slice(4))throw new Error('Invalid release manifest');
const imageRefs=Object.fromEntries(Object.entries(manifest.images||{}).map(([name,item])=>[name,item?.ref]));
for(const name of ['coke-grok-auth','coke-grok-desktop-broker','coke-grok-namespace-bootstrap','coke-grok-desktop']){
  if(imageRefs[name]!==`${name}:${releaseId}`)throw new Error(`Release manifest has an inconsistent image reference for ${name}`);
  const inspect=JSON.parse(output('docker',['image','inspect',imageRefs[name]]))[0];
  const labels=inspect?.Config?.Labels||{},env=inspect?.Config?.Env||[];
  if(labels['coke-grok-bot.io/release-id']!==releaseId||!env.includes(`COKE_GROK_RELEASE_ID=${releaseId}`)||inspect.Os!=='linux'||inspect.Architecture!=='arm64')throw new Error(`Local image metadata does not match ${releaseId}: ${name}`);
}

const releaseDir=resolve(root,'releases',`candidate-grok-run-trace-version-${releaseId.slice(4,11)}-${new Date().toISOString().slice(0,10)}`);
const operationsDir=resolve(releaseDir,'operations');
await mkdir(operationsDir,{recursive:true});
await writeFile(resolve(releaseDir,'release-images.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
const snapshot=await captureSnapshot();
const snapshotPath=resolve(operationsDir,'pre-deploy-state.json');
await writeFile(snapshotPath,JSON.stringify(snapshot,null,2)+'\n',{mode:0o600});
await writeFile(resolve(operationsDir,'rollback-command.txt'),`node scripts/rollback-k3d-release.mjs ${snapshotPath} --context ${context}\n`,{mode:0o600});
console.log(`Prepared ${releaseId}; captured ${snapshot.deployments.length} Deployments, ${snapshot.desktopImagePins.length} user image pins, ${snapshot.mysqlPods.length} MySQL Pod(s), and ${snapshot.persistentVolumeClaims.length} MySQL/Grok PVC(s).`);
if(planOnly){
  for(const deployment of snapshot.deployments)console.log(`Plan: ${deployment.namespace}/${deployment.name} -> ${releaseId}`);
  console.log(`Plan only: no K3D images, Deployments, ConfigMaps, Pods, MySQL, or PVCs were changed. Snapshot: ${snapshotPath}`);
  process.exit(0);
}

let clusterMutationStarted=false;
try{
  run('k3d',['image','import',...Object.values(imageRefs),'--cluster',cluster]);
  patchConfig({COKE_GROK_DESKTOP_IMAGE:imageRefs['coke-grok-desktop'],COKE_GROK_AGENT_IMAGE:imageRefs['coke-grok-desktop']});
  clusterMutationStarted=true;
  await writeFile(resolve(operationsDir,'release-images.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  for(const pin of snapshot.desktopImagePins)writePin(pin.namespace,{desktopImage:imageRefs['coke-grok-desktop'],agentImage:imageRefs['coke-grok-desktop']},pin.labels);
  for(const deployment of snapshot.deployments)patchDeployment(deployment,releaseId);
  for(const deployment of snapshot.deployments)run('kubectl',['--context',context,'-n',deployment.namespace,'rollout','status',`deployment/${deployment.name}`,'--timeout=300s']);
  const verify=spawnSync(process.execPath,[resolve(root,'scripts/verify-k3d-release.mjs'),releaseId,'--context',context],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
  if(verify.stdout)process.stdout.write(verify.stdout);
  if(verify.stderr)process.stderr.write(verify.stderr);
  if(verify.status!==0)throw new Error('Same-release verification failed');
  assertPersistentState(snapshot);
  const result={releaseId,context,deployedAt:new Date().toISOString(),status:'deployed',deploymentCount:snapshot.deployments.length,pods:collectPodVersions(),preservedMysqlPods:snapshot.mysqlPods.length,preservedPvcs:snapshot.persistentVolumeClaims.length};
  await writeFile(resolve(operationsDir,'deployment-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(`Deployed and verified ${releaseId} across all Grok Bot application Deployments. MySQL and PVC identities are unchanged.`);
}catch(error){
  console.error(`Deployment failed for ${releaseId}; restoring the captured application images and pins.`);
  console.error(`Release operation diagnostic: ${error instanceof Error?error.message:'unknown_release_error'}`);
  try{
    if(clusterMutationStarted)restoreSnapshot(snapshot);
    assertPersistentState(snapshot);
    await writeFile(resolve(operationsDir,'deployment-result.json'),JSON.stringify({releaseId,context,failedAt:new Date().toISOString(),status:clusterMutationStarted?'rolled-back':'not-applied',diagnostic:'release_deploy_failed'},null,2)+'\n',{mode:0o600});
  }catch{console.error('Automatic rollback did not fully verify. Use the rollback command stored with this release.');}
  process.exitCode=1;
}

function run(command,commandArgs,input){
  const result=spawnSync(command,commandArgs,{cwd:root,encoding:'utf8',input,maxBuffer:16*1024*1024});
  if(result.error)throw new Error(`${command} could not be started`);
  if(result.status!==0){
    if(command==='kubectl'&&result.stderr)process.stderr.write(result.stderr);
    throw new Error(`${command} step failed (${commandArgs.slice(0,3).join(' ')})`);
  }
  if(result.stdout)process.stdout.write(result.stdout);
  return result.stdout;
}
function output(command,commandArgs){
  const result=spawnSync(command,commandArgs,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
  if(result.error||result.status!==0)throw new Error(`${command} query failed`);
  return result.stdout;
}
function getJson(...commandArgs){return JSON.parse(output('kubectl',['--context',context,...commandArgs,'-o','json']))}
async function captureSnapshot(){
  const all=getJson('get','deploy','-A').items;
  const coreNames=new Set(['coke-grok-auth','coke-grok-desktop-broker','coke-grok-namespace-bootstrap']);
  const deployments=[];
  for(const item of all){
    const namespace=item.metadata.namespace,name=item.metadata.name,spec=item.spec.template.spec;
    const containers=spec.containers||[],initContainers=spec.initContainers||[];
    const userDesktop=namespace.startsWith('grok-user-')&&[...containers,...initContainers].some(c=>imageRepository(c.image)==='coke-grok-desktop');
    if(namespace==='coke-grok-bot'&&coreNames.has(name)||userDesktop){
      deployments.push({namespace,name,releaseLabels:{deployment:item.metadata.labels?.['coke-grok-bot.io/release-id']??null,pod:item.spec.template.metadata?.labels?.['coke-grok-bot.io/release-id']??null},containers:containers.map(c=>({name:c.name,image:c.image,...(c.resources?{resources:c.resources}:{})})),initContainers:initContainers.map(c=>({name:c.name,image:c.image,...(c.resources?{resources:c.resources}:{})}))});
    }
  }
  deployments.sort((a,b)=>Number(a.namespace==='coke-grok-bot')-Number(b.namespace==='coke-grok-bot')||a.namespace.localeCompare(b.namespace)||a.name.localeCompare(b.name));
  for(const name of coreNames)if(!deployments.some(d=>d.namespace==='coke-grok-bot'&&d.name===name))throw new Error(`Required control-plane Deployment is missing: ${name}`);
  if(!deployments.some(d=>d.namespace.startsWith('grok-user-')))throw new Error('No Grok user computer Deployment was found');
  const config=getJson('get','cm','auth-runtime-config','-n','coke-grok-bot');
  const data=config.data||{};
  if(!data.COKE_GROK_DESKTOP_IMAGE||!data.COKE_GROK_AGENT_IMAGE)throw new Error('Runtime image configuration is incomplete');
  const desktopImagePins=[];
  for(const namespace of [...new Set(deployments.filter(d=>d.namespace.startsWith('grok-user-')).map(d=>d.namespace))]){
    const pin=getJson('get','cm','desktop-image-pin','-n',namespace);
    desktopImagePins.push({namespace,exists:true,immutable:pin.immutable===true,labels:pin.metadata.labels||{},data:{desktopImage:pin.data?.desktopImage,agentImage:pin.data?.agentImage}});
  }
  return {capturedAt:new Date().toISOString(),context,releaseId,deployments,authRuntimeImageConfig:{COKE_GROK_DESKTOP_IMAGE:data.COKE_GROK_DESKTOP_IMAGE,COKE_GROK_AGENT_IMAGE:data.COKE_GROK_AGENT_IMAGE},desktopImagePins,mysqlPods:mysqlIdentity(),persistentVolumeClaims:pvcIdentity()};
}
function imageRepository(image){return typeof image==='string'?image.slice(0,image.lastIndexOf(':')):''}
function patchConfig(data){run('kubectl',['--context',context,'-n','coke-grok-bot','patch','cm','auth-runtime-config','--type=merge','-p',JSON.stringify({data})]);}
function writePin(namespace,data,labels){
  run('kubectl',['--context',context,'-n',namespace,'delete','cm','desktop-image-pin','--ignore-not-found=true','--wait=true']);
  const ownerHash=/^grok-user-([a-f0-9]{32})$/.exec(namespace)?.[1];
  if(!ownerHash)throw new Error(`Unexpected owner namespace ${namespace}`);
  const object={apiVersion:'v1',kind:'ConfigMap',metadata:{name:'desktop-image-pin',namespace,labels:{...labels,'app.kubernetes.io/managed-by':'coke-grok-bot','coke-grok-bot.io/owner-hash':ownerHash}},immutable:true,data};
  run('kubectl',['--context',context,'-n',namespace,'create','-f','-'],JSON.stringify(object));
}
function patchDeployment(deployment,version){
  const imageMap={'coke-grok-auth':`coke-grok-auth:${version}`,'coke-grok-desktop-broker':`coke-grok-desktop-broker:${version}`,'coke-grok-namespace-bootstrap':`coke-grok-namespace-bootstrap:${version}`,'coke-grok-desktop':`coke-grok-desktop:${version}`};
  const regular=[],init=[];
  for(const field of ['containers','initContainers']){
    const images=deployment[field].filter(item=>imageMap[imageRepository(item.image)]).map(item=>{
      const next={name:item.name,image:imageMap[imageRepository(item.image)],...(item.resources?{resources:item.resources}:{})};
      if(field==='containers'&&deployment.namespace==='coke-grok-bot'&&deployment.name==='coke-grok-auth'&&item.name==='auth')next.resources={requests:{cpu:'50m',memory:'128Mi'},limits:{cpu:'1',memory:'512Mi'}};
      return next;
    });
    (field==='containers'?regular:init).push(...images);
  }
  patchDeploymentImageLists(deployment.namespace,deployment.name,regular,init,{deployment:version,pod:version});
}
function patchDeploymentImageLists(namespace,name,containers,initContainers,releaseLabels={deployment:null,pod:null}){
  const patch={metadata:{labels:{'coke-grok-bot.io/release-id':releaseLabels.deployment??null}},spec:{template:{metadata:{labels:{'coke-grok-bot.io/release-id':releaseLabels.pod??null}},spec:{}}}};
  if(containers.length)patch.spec.template.spec.containers=containers;
  if(initContainers.length)patch.spec.template.spec.initContainers=initContainers;
  if(!Object.keys(patch.spec.template.spec).length)throw new Error(`No versioned app containers found in ${namespace}/${name}`);
  run('kubectl',['--context',context,'-n',namespace,'patch','deployment',name,'--type=strategic','-p',JSON.stringify(patch)]);
}
function mysqlIdentity(){
  return getJson('get','pods','-A').items.filter(p=>p.metadata.namespace==='coke-auth'&&p.metadata.name.startsWith('mysql')).map(p=>({namespace:p.metadata.namespace,name:p.metadata.name,uid:p.metadata.uid,images:(p.spec.containers||[]).map(c=>c.image)})).sort((a,b)=>a.name.localeCompare(b.name));
}
function collectPodVersions(){
  const names=new Set(['coke-grok-auth','coke-grok-desktop-broker','coke-grok-namespace-bootstrap','coke-grok-desktop']);
  return getJson('get','pods','-A').items.filter(p=>!p.metadata.deletionTimestamp&&!['Succeeded','Failed'].includes(p.status?.phase)).flatMap(p=>{
    const containers=[...(p.spec.initContainers||[]),...(p.spec.containers||[])].filter(c=>names.has(imageRepository(c.image)));
    if(!containers.length)return [];
    const states=[...(p.status.initContainerStatuses||[]),...(p.status.containerStatuses||[])];
    return [{namespace:p.metadata.namespace,name:p.metadata.name,phase:p.status.phase,releaseId:p.metadata.labels?.['coke-grok-bot.io/release-id']||null,containers:containers.map(c=>{const state=states.find(item=>item.name===c.name);return {name:c.name,image:c.image,imageId:state?.imageID||null,ready:state?.ready??null}})}];
  }).sort((a,b)=>`${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
}
function pvcIdentity(){
  return getJson('get','pvc','-A').items.filter(p=>p.metadata.namespace==='coke-auth'||p.metadata.namespace.startsWith('grok-user-')).map(p=>({namespace:p.metadata.namespace,name:p.metadata.name,uid:p.metadata.uid,phase:p.status?.phase})).sort((a,b)=>`${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
}
function assertPersistentState(snapshot){
  if(JSON.stringify(mysqlIdentity())!==JSON.stringify(snapshot.mysqlPods)||JSON.stringify(pvcIdentity())!==JSON.stringify(snapshot.persistentVolumeClaims))throw new Error('MySQL Pod or persistent volume identity changed during the release');
}
function restoreSnapshot(snapshot){
  patchConfig(snapshot.authRuntimeImageConfig);
  for(const pin of snapshot.desktopImagePins){
    run('kubectl',['--context',context,'-n',pin.namespace,'delete','cm','desktop-image-pin','--ignore-not-found=true','--wait=true']);
    if(pin.exists)run('kubectl',['--context',context,'-n',pin.namespace,'create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'ConfigMap',metadata:{name:'desktop-image-pin',namespace:pin.namespace,labels:pin.labels},immutable:pin.immutable,data:pin.data}));
  }
  for(const deployment of snapshot.deployments)patchDeploymentImageLists(deployment.namespace,deployment.name,deployment.containers,deployment.initContainers,deployment.releaseLabels||{deployment:null,pod:null});
  for(const deployment of snapshot.deployments)run('kubectl',['--context',context,'-n',deployment.namespace,'rollout','status',`deployment/${deployment.name}`,'--timeout=300s']);
}
