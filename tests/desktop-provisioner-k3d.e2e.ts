import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { DesktopProvisioner,type DesktopKubernetes,type KubernetesObject } from '../src/server/desktop-provisioner.ts';
import { desktopIdentity } from '../src/server/desktop-resources.ts';
const image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE;if(!image)throw new Error('Pinned desktop image required');
const owner={tenantId:randomUUID(),userId:randomUUID()},key=randomBytes(32),identity=desktopIdentity(owner,key);let created=false;
async function exec(args:string[],input?:string,timeout=120_000){
 const child=spawn('kubectl',args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk});child.stderr.resume();child.stdin.end(input);
 const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}
}
const kube:DesktopKubernetes={
 async get(kind,namespace,name){const r=await exec([...(namespace?['-n',namespace]:[]),'get',kind,name,'--ignore-not-found','-o','json']);if(r.code!==0)throw new Error('Kubernetes read failed');return r.out.trim()?JSON.parse(r.out):null},
 async create(object){const r=await exec(['create','-f','-'],JSON.stringify(object));if(r.code!==0)throw new Error(`Kubernetes create failed: ${object.kind}`);if(object.kind==='Namespace')created=true;return true},
 async waitForReady(namespace,name){const r=await exec(['-n',namespace,'rollout','status',`deployment/${name}`,'--timeout=150s'],undefined,160_000);if(r.code!==0)throw new Error('Desktop deployment did not become ready')}
};
try{
 const context=await exec(['config','current-context']);assert.equal(context.out.trim(),'k3d-tp1121-sandbox-dev');
 const provisioner=new DesktopProvisioner(kube,key,{image,controlNamespace:'coke-grok-bot',gatewayCA:'-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----',split:true});
 const first=await provisioner.connect(owner,new AbortController().signal);assert.equal(first.agentUrl.hostname,`agent.${identity.namespace}.svc.cluster.local`);
 const second=await provisioner.connect(owner,new AbortController().signal);assert.equal(second.agentUrl.href,first.agentUrl.href);
 console.log('K3D desktop provisioner passed: create, readiness and idempotent re-read.');
}finally{if(created)await exec(['delete','namespace',identity.namespace,'--wait=false'],undefined,20_000)}
