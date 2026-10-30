import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {request} from 'node:https';
import type {AddressInfo} from 'node:net';
import {DesktopBrokerClient} from '../src/server/desktop-broker-client.ts';
import {createDesktopProvisioningBroker} from '../src/server/desktop-provisioning-broker.ts';

test('broker accepts only authenticated owner identities and verifies the returned desktop',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'grok-broker-test-')),keyPath=join(dir,'key.pem'),certPath=join(dir,'cert.pem');
 await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1']);
 const key=await readFile(keyPath),cert=await readFile(certPath),capability=randomBytes(32).toString('base64url'),agentToken=randomBytes(32).toString('base64url');let calls=0;
 const owner={tenantId:randomUUID(),userId:randomUUID()};
 const server=createDesktopProvisioningBroker({key,cert},capability,{connect:async selected=>{calls++;assert.deepEqual(selected,owner);const hash=createHash('sha256').update(`${selected.tenantId}:${selected.userId}`).digest('hex').slice(0,32);return {agentUrl:new URL(`http://agent.grok-user-${hash}.svc.cluster.local:8083/`),agentToken}}});server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as AddressInfo).port,base=`https://127.0.0.1:${port}/`;
 async function call(path:string,body:unknown,token=capability){return new Promise<number>((resolve,reject)=>{const data=JSON.stringify(body);const req=request(new URL(path,base),{method:'POST',ca:cert,headers:{authorization:`Bearer ${token}`,'content-type':'application/json','content-length':Buffer.byteLength(data)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode||0))});req.on('error',reject);req.end(data)})}
 try{
  assert.equal(await call('/v1/personal-computer',owner,randomBytes(32).toString('base64url')),401);
  assert.equal(await call('/v1/secret',owner),404);
  assert.equal(await call('/v1/personal-computer',{...owner,kind:'Secret'}),400);
  assert.equal(await call('/v1/personal-computer',{...owner,userId:'invalid'}),400);
  assert.equal(calls,0);
  const client=new DesktopBrokerClient(base,cert,capability),result=await client.connect(owner,new AbortController().signal);
  assert.equal(result.agentToken,agentToken);assert.match(result.agentUrl.hostname,/^agent\.grok-user-[a-f0-9]{32}\.svc\.cluster\.local$/);assert.equal(calls,1);
  await assert.rejects(new DesktopBrokerClient(base,cert,randomBytes(32).toString('base64url')).connect(owner,new AbortController().signal));
  assert.throws(()=>new DesktopBrokerClient('http://localhost/',cert,capability));
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true})}
});
