import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DesktopKubernetesClient } from '../src/server/desktop-kubernetes.ts';
test('Kubernetes client uses authenticated TLS, refuses unsafe paths and never replaces objects',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'grok-kube-test-')),key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
 let requests=0; const server=createServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
  requests++;assert.equal(req.headers.authorization,'Bearer test-token');
  if(req.method==='GET'&&req.url==='/api/v1/namespaces/test-space'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({apiVersion:'v1',kind:'Namespace',metadata:{name:'test-space'}}));return}
  if(req.method==='GET'&&req.url==='/api/v1/namespaces/missing'){res.writeHead(404);res.end();return}
  if(req.method==='POST'&&req.url==='/api/v1/namespaces'){res.writeHead(409);res.end();return}
  res.writeHead(403);res.end('private-error-body');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No port');
 try{
  const client=new DesktopKubernetesClient(`https://localhost:${address.port}/`,readFileSync(cert),'test-token'),signal=new AbortController().signal;
  assert.equal((await client.get('Namespace',null,'test-space',signal))?.kind,'Namespace');
  assert.equal(await client.get('Namespace',null,'missing',signal),null);
  assert.equal(await client.create({apiVersion:'v1',kind:'Namespace',metadata:{name:'test-space'}},signal),false);
  await assert.rejects(client.get('Secret','../other','name',signal));
  await assert.rejects(client.get('Pod','test-space','name',signal));
  await assert.rejects(client.get('Secret','test-space','name',signal),error=>error instanceof Error&&!error.message.includes('private-error-body'));
  assert.equal(requests,4);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true})}
});
