import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer, request as httpRequest, type Server} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo, Socket} from 'node:net';
import {createAuthServer} from '../src/server/auth-http.ts';
import type {GoogleAuthService} from '../src/server/google-auth.ts';
import type {Session} from '../src/server/tenant-store.ts';
import {UserComputer} from '../src/server/user-computer.ts';

async function listen(server:Server):Promise<number>{server.listen(0,'127.0.0.1');await once(server,'listening');return (server.address() as AddressInfo).port}
async function close(server:Server,sockets?:Set<Socket>):Promise<void>{
 for(const socket of sockets||[])socket.destroy();
 server.closeAllConnections();
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}

test('authenticated computer takeover proxies noVNC assets and its live WebSocket only for the owning user',async()=>{
 const owner:Session={tenantId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',email:'owner@example.test',name:'owner',role:'owner'};
 const other:Session={...owner,userId:'33333333-3333-4333-8333-333333333333',email:'other@example.test'};
 const botId='44444444-4444-4444-8444-444444444444';let upstreamCookie:string|undefined,forwardedPath='';
 const vncSockets=new Set<Socket>();
 const vnc=createServer((req,res)=>{forwardedPath=req.url||'';res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>noVNC test</title>')});
 vnc.on('connection',socket=>{vncSockets.add(socket);socket.once('close',()=>vncSockets.delete(socket))});
 vnc.on('upgrade',(req,socket)=>{
  upstreamCookie=req.headers.cookie;forwardedPath=req.url||'';
  const key=req.headers['sec-websocket-key'];assert.equal(typeof key,'string');
  const accept=createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
 });
 const vncPort=await listen(vnc),vncBase=`http://127.0.0.1:${vncPort}/`;
 const computer=new UserComputer(()=>({
  async control(){return {owner:'user'}},async userScreenshot(){return Buffer.from('screen')},async setControl(value){return {owner:value}},async userAction(){}
 })) as UserComputer;
 computer.vncEndpoint=async(session,requestedBot)=>session.userId===owner.userId&&requestedBot===botId?new URL(vncBase):null;
 const auth={session:async(req:import('node:http').IncomingMessage)=>req.headers.cookie==='owner'?owner:req.headers.cookie==='other'?other:null} as unknown as GoogleAuthService;
 const runs={ownsBot:async(session:Session,id:string)=>session.userId===owner.userId&&id===botId} as unknown as import('../src/server/run-store.ts').RunStore;
 const reservation=createServer(),port=await listen(reservation);await close(reservation);const origin=`http://127.0.0.1:${port}`;
 const boundServer=createAuthServer(auth,`${origin}/grok-bot`,undefined,undefined,runs,undefined,computer);
 const boundSockets=new Set<Socket>();boundServer.on('connection',socket=>{boundSockets.add(socket);socket.once('close',()=>boundSockets.delete(socket))});
 boundServer.listen(port,'127.0.0.1');await once(boundServer,'listening');
 let clientSocket:import('node:net').Socket|undefined;
 try{
  const asset=await fetch(`${origin}/grok-bot/api/bots/${botId}/computer/vnc/vnc_lite.html`,{headers:{cookie:'owner'}});
  assert.equal(asset.status,200);assert.match(await asset.text(),/noVNC test/);assert.equal(forwardedPath,'/vnc_lite.html');
  const denied=await fetch(`${origin}/grok-bot/api/bots/${botId}/computer/vnc/vnc_lite.html`,{headers:{cookie:'other'}});assert.equal(denied.status,404);
  const unauthenticated=await fetch(`${origin}/grok-bot/api/bots/${botId}/computer/vnc/vnc_lite.html`);assert.equal(unauthenticated.status,401);
  await new Promise<void>((resolve,reject)=>{
   const request=httpRequest(`${origin}/grok-bot/api/bots/${botId}/computer/vnc/websockify`,{headers:{host:`127.0.0.1:${port}`,origin, cookie:'owner',upgrade:'websocket',connection:'Upgrade','sec-websocket-version':'13','sec-websocket-key':'dGhlIHNhbXBsZSBub25jZQ=='}});
   request.once('upgrade',(response,socket)=>{clientSocket=socket;assert.equal(response.statusCode,101);assert.equal(upstreamCookie,undefined);assert.equal(forwardedPath,'/websockify');resolve()});
   request.once('response',response=>{response.resume();reject(new Error(`Expected WebSocket upgrade, got HTTP ${response.statusCode}`))});request.once('error',reject);request.end();
  });
 }finally{
  clientSocket?.destroy();await close(boundServer,boundSockets);await close(vnc,vncSockets);
 }
});
