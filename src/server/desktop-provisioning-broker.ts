import {createServer,type ServerOptions} from 'node:https';
import {timingSafeEqual} from 'node:crypto';
import type {DesktopConnections} from './pi-executor.ts';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const capability=/^[A-Za-z0-9_-]{43}$/;

/** Private service: it accepts only an owner identity, never Kubernetes objects or resource paths. */
export function createDesktopProvisioningBroker(tls:ServerOptions,token:string,desktops:DesktopConnections) {
 if(!capability.test(token))throw new Error('Invalid broker capability');
 const expected=Buffer.from(`Bearer ${token}`);
 let active=0;
 const server=createServer(tls,async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const authorization=Buffer.from(req.headers.authorization||'');
  if(authorization.length!==expected.length||!timingSafeEqual(authorization,expected)){res.writeHead(401);return res.end()}
  if(req.method!=='POST'||req.url!=='/v1/personal-computer'){res.writeHead(404);return res.end()}
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){res.writeHead(415);return res.end()}
  try{
   let size=0;const chunks:Buffer[]=[];
   for await(const chunk of req){size+=chunk.length;if(size>1024){res.writeHead(413);return res.end()}chunks.push(chunk)}
   let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{res.writeHead(400);return res.end()}
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='tenantId,userId'){res.writeHead(400);return res.end()}
   const {tenantId,userId}=body as {tenantId?:unknown;userId?:unknown};
   if(typeof tenantId!=='string'||!uuid.test(tenantId)||typeof userId!=='string'||!uuid.test(userId)){res.writeHead(400);return res.end()}
   if(active>=4){res.writeHead(503);return res.end()}
   active++;
   try{
    const result=await desktops.connect({tenantId,userId},AbortSignal.timeout(210_000));
    const payload=JSON.stringify({agentUrl:result.agentUrl.href,agentToken:result.agentToken});
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(payload);
   }finally{active--}
  }catch{if(!res.headersSent)res.writeHead(503);return res.end()}
 });
 server.headersTimeout=10_000;server.requestTimeout=15_000;
 return server;
}
