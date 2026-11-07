import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {computerVncViewerHtml} from '../src/server/computer-vnc-viewer.ts';

const assetOrigin=new URL(process.env.COKE_GROK_NOVNC_ASSET_ORIGIN||'http://127.0.0.1:16080');
const viewerPath='/grok-bot/api/bots/44444444-4444-4444-8444-444444444444/computer/vnc/viewer.html';
// Match the current public test Bot's third 1440x900 screen slot.
const viewport={left:4416,top:0,width:1440,height:900};
const framebuffer={width:viewport.left+viewport.width,height:viewport.height};
const pointerEvents:Array<{mask:number;x:number;y:number}>=[];
const keyEvents:Array<{down:boolean;keysym:number}>=[];
let server:Server|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;

function sendFrame(socket:import('node:net').Duplex,opcode:number,payload:Buffer):void{
 const length=payload.length;
 let header:Buffer;
 if(length<126){header=Buffer.from([0x80|opcode,length])}
 else if(length<65536){header=Buffer.alloc(4);header[0]=0x80|opcode;header[1]=126;header.writeUInt16BE(length,2)}
 else{header=Buffer.alloc(10);header[0]=0x80|opcode;header[1]=127;header.writeBigUInt64BE(BigInt(length),2)}
 socket.write(Buffer.concat([header,payload]));
}

function serverInit():Buffer{
 const name=Buffer.from('input-test');
 const result=Buffer.alloc(24+name.length);
 result.writeUInt16BE(framebuffer.width,0);result.writeUInt16BE(framebuffer.height,2);
 result[4]=32;result[5]=24;result[6]=0;result[7]=1;
 result.writeUInt16BE(255,8);result.writeUInt16BE(255,10);result.writeUInt16BE(255,12);
 result[14]=16;result[15]=8;result[16]=0;result.writeUInt32BE(name.length,20);name.copy(result,24);
 return result;
}

function handleRfbSocket(socket:import('node:net').Duplex,head:Buffer):void{
 let handshake=0,wire=Buffer.alloc(0),rfb=Buffer.alloc(0),closed=false;
 const send=(value:Buffer)=>sendFrame(socket,2,value);
 const sendVersion=()=>send(Buffer.from('RFB 003.008\n'));
 const consumeRfb=()=>{
  while(rfb.length){
   const type=rfb[0];let size=0;
   if(type===0)size=20;
   else if(type===2){if(rfb.length<4)return;size=4+rfb.readUInt16BE(2)*4}
   else if(type===3)size=10;
   else if(type===4){size=8}
   else if(type===5){size=6}
   else if(type===6){if(rfb.length<8)return;size=8+rfb.readUInt32BE(4)}
   else if(type===150)size=10;
   else if(type===248){if(rfb.length<9)return;size=9+rfb[8]}
   else {throw new Error(`Unexpected RFB client message type ${type}`)}
   if(rfb.length<size)return;
   const message=rfb.subarray(0,size);rfb=rfb.subarray(size);
   if(type===4)keyEvents.push({down:message[1]===1,keysym:message.readUInt32BE(4)});
   if(type===5)pointerEvents.push({mask:message[1],x:message.readUInt16BE(2),y:message.readUInt16BE(4)});
  }
 };
 const consumeWs=()=>{
  while(wire.length>=2){
   const opcode=wire[0]&0x0f,masked=(wire[1]&0x80)!==0;let length=wire[1]&0x7f,offset=2;
   if(length===126){if(wire.length<4)return;length=wire.readUInt16BE(2);offset=4}
   else if(length===127){if(wire.length<10)return;const big=wire.readBigUInt64BE(2);if(big>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Oversize WebSocket frame');length=Number(big);offset=10}
   if(masked)offset+=4;
   if(wire.length<offset+length)return;
   let payload=Buffer.from(wire.subarray(offset,offset+length));
   if(masked){const mask=wire.subarray(offset-4,offset);for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4]}
   wire=wire.subarray(offset+length);
   if(opcode===8){closed=true;socket.end();return}
   if(opcode!==2&&opcode!==0)continue;
   rfb=Buffer.concat([rfb,payload]);
   if(handshake===0&&rfb.length>=12){rfb=rfb.subarray(12);handshake=1;send(Buffer.from([1,1]))}
   if(handshake===1&&rfb.length>=1){rfb=rfb.subarray(1);handshake=2;send(Buffer.from([0,0,0,0]))}
   if(handshake===2&&rfb.length>=1){rfb=rfb.subarray(1);handshake=3;send(serverInit())}
   if(handshake===3)consumeRfb();
  }
 };
 socket.on('data',chunk=>{try{wire=Buffer.concat([wire,chunk]);consumeWs()}catch(error){if(!closed&&!socket.destroyed)socket.destroy(error as Error)}});
 socket.once('close',()=>{closed=true});
 if(head.length){wire=Buffer.concat([wire,head]);consumeWs()}
 sendVersion();
}

async function serve(req:IncomingMessage,res:ServerResponse):Promise<void>{
 const url=new URL(req.url||'/',`http://${req.headers.host}`);
 if(url.pathname===viewerPath){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(computerVncViewerHtml(viewport));return;
 }
 const assetPath=url.pathname.startsWith('/grok-bot/api/bots/44444444-4444-4444-8444-444444444444/computer/vnc/')
  ?url.pathname.split('/computer/vnc/')[1]:'';
 if(!assetPath||!(/^(core|vendor)\/[A-Za-z0-9_./-]+\.js$/.test(assetPath))||assetPath.includes('..')){res.writeHead(404);res.end();return}
 try{
  const upstream=await fetch(new URL(`/${assetPath}`,assetOrigin),{signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!upstream.ok){res.writeHead(upstream.status);res.end();return}
  const body=Buffer.from(await upstream.arrayBuffer());
  res.writeHead(200,{'Content-Type':upstream.headers.get('content-type')||'application/javascript','Cache-Control':'no-store'});res.end(body);
 }catch{res.writeHead(502);res.end('Unable to load the installed noVNC test assets')}
}

async function waitUntil(check:()=>boolean,label:string):Promise<void>{
 for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20))}
 assert.fail(`Timed out waiting for ${label}`);
}

async function requireNoVncAssets():Promise<void>{
 try{
  const response=await fetch(new URL('/core/rfb.js',assetOrigin),{signal:AbortSignal.timeout(3000),redirect:'error'});
  if(!response.ok)throw new Error('noVNC asset request failed');
  await response.body?.cancel();
 }catch{
  throw new Error(`The existing desktop's noVNC assets are unavailable at ${assetOrigin.origin}. Start a read-only port-forward from an existing desktop pod (kubectl -n <namespace> port-forward pod/<desktop-pod> 16080:6080), then rerun this local RFB-fixture test.`);
 }
}

try{
 await requireNoVncAssets();
 server=createServer((req,res)=>{void serve(req,res)});
 server.on('upgrade',(req,socket,head)=>{
  if(new URL(req.url||'/',`http://${req.headers.host}`).pathname!==viewerPath.replace(/viewer\.html$/,'websockify')){socket.destroy();return}
  const key=req.headers['sec-websocket-key'];if(typeof key!=='string'){socket.destroy();return}
  const accept=createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  handleRfbSocket(socket,head);
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address==='object');
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1000,height:600},deviceScaleFactor:1});const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${address.port}${viewerPath}`,{waitUntil:'domcontentloaded'});
 await page.locator('#status[data-state="connected"]').waitFor({timeout:8000});
 const geometry=await page.locator('canvas').evaluate(canvas=>{
  const rect=canvas.getBoundingClientRect(),screen=canvas.parentElement!,mount=screen.parentElement!;
  return {canvas:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},screen:{width:screen.getBoundingClientRect().width,height:screen.getBoundingClientRect().height},mount:{left:mount.getBoundingClientRect().left,top:mount.getBoundingClientRect().top},scale:(canvas as HTMLCanvasElement).width/rect.width};
 });
 assert.deepEqual(geometry.canvas,{x:20,y:0,width:960,height:600});
 assert.deepEqual(geometry.screen,{width:1440,height:900});
 assert.deepEqual(geometry.mount,{left:20,top:0});
 await page.mouse.click(500,300);
 await waitUntil(()=>pointerEvents.length>=2,'noVNC pointer down/up');
 const click=pointerEvents.slice(-2);assert.equal(click[0].mask,1);assert.equal(click[1].mask,0);
 assert.equal(click[0].x,5136);assert.equal(click[0].y,450);
 await page.keyboard.type('a');await waitUntil(()=>keyEvents.length>=2,'noVNC keyboard down/up');
 assert.deepEqual(keyEvents.slice(-2),[{down:true,keysym:0x61},{down:false,keysym:0x61}]);
 assert.deepEqual(errors,[]);
 console.log('noVNC protocol integration passed: the real noVNC client mapped a click for framebuffer slot 3 and sent keyboard events to a local RFB fixture. This does not verify K3D X11 input, the public VPS route, or takeover acceptance.');
}finally{
 if(browser)await browser.close();
 if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
}
