import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {HttpGuardedComputerWorker} from '../src/server/guarded-worker.ts';
import {safeDiagnosticMetadata,safeWorkerTarget} from '../src/server/safe-diagnostics.ts';
const owner={tenantId:randomUUID(),userId:randomUUID()},hash=createHash('sha256').update(`${owner.tenantId}:${owner.userId}`).digest('hex').slice(0,32),url=new URL(`http://desktop.grok-user-${hash}.svc.cluster.local:8082/`),token=randomBytes(32).toString('base64url'),taskId=randomUUID(),screenId=randomUUID(),signal=new AbortController().signal;
test('guarded worker scopes endpoint and task identity to the owner',async()=>{
 let calls=0;const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async (request,init)=>{calls++;assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${token}`);assert.equal(new Headers(init?.headers).get('x-coke-grok-screen-id'),screenId);if(calls===1){assert.equal(new URL(String(request)).pathname,'/v1/guarded/snapshot');return Response.json({owner:'agent',url:'https://example.test/',screenshotSha256:'a'.repeat(64)})}const body=JSON.parse(String(init?.body));assert.equal(body.action.taskId,taskId);assert.equal(body.action.action,'click');return Response.json({ready:true})});
 const state=await worker.snapshot(signal);assert.equal(state.owner,'agent');assert.deepEqual(await worker.performIfUnchanged({kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},state,signal),{ready:true});
 await assert.rejects(worker.performIfUnchanged({kind:'browser',action:'click',taskId:randomUUID()},state,signal));assert.equal(calls,2);
 assert.throws(()=>new HttpGuardedComputerWorker(owner,screenId,new URL('http://other.svc:8082/'),token,taskId));
 assert.throws(()=>new HttpGuardedComputerWorker(owner,'not-a-bot',url,token,taskId));
});
test('guarded worker returns only a validated Bot viewport while preserving worker scope',async()=>{
 const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async(request,init)=>{
  assert.equal(new URL(String(request)).pathname,'/v1/guarded/viewport');
  assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${token}`);
  assert.equal(new Headers(init?.headers).get('x-coke-grok-screen-id'),screenId);
  return Response.json({slot:1,left:1472,top:0,width:1440,height:900});
 });
 assert.deepEqual(await worker.vncViewport(signal),{left:1472,top:0,width:1440,height:900});
 for(const viewport of [{left:-1,top:0,width:1440,height:900},{left:0,top:0,width:0,height:900},{left:32700,top:0,width:1440,height:900}]){
  const invalid=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>Response.json(viewport));
  await assert.rejects(invalid.vncViewport(signal),/Invalid computer viewport/);
 }
});
test('guarded worker navigates through a fresh owner and URL state without transferring screenshot data',async()=>{
 let calls=0;const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async(request,init)=>{
  calls++;const path=new URL(String(request)).pathname;assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${token}`);assert.equal(new Headers(init?.headers).get('x-coke-grok-screen-id'),screenId);
  if(calls===1){assert.equal(path,'/v1/guarded/navigation-state');return Response.json({owner:'agent',url:'about:blank'})}
  assert.equal(path,'/v1/guarded/navigate');const body=JSON.parse(String(init?.body));assert.deepEqual(body.expected,{owner:'agent',url:'about:blank'});assert.equal(body.action.taskId,taskId);assert.equal(body.action.url,'https://example.org/');return Response.json({ready:true,url:'https://example.org/'})
 });
 const state=await worker.navigationState(signal);assert.deepEqual(state,{owner:'agent',url:'about:blank'});assert.deepEqual(await worker.navigateIfUnchanged({kind:'browser',action:'navigate',url:'https://example.org/'},state,signal),{ready:true,url:'https://example.org/'});assert.equal(calls,2);
 await assert.rejects(worker.navigateIfUnchanged({kind:'desktop',action:'click',x:1,y:1},state,signal),/Invalid computer navigation/);assert.equal(calls,2);
});
test('guarded worker identifies an older Desktop image without screenshot-free navigation support',async()=>{
 const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async(request,init)=>{
  assert.equal(new URL(String(request)).pathname,'/v1/guarded/navigation-state');assert.equal(new Headers(init?.headers).get('x-coke-grok-screen-id'),screenId);return new Response(null,{status:404});
 });
 await assert.rejects(worker.navigationState(signal),error=>error instanceof Error&&error.message==='COMPUTER_WORKER_HTTP_ERROR'&&(error as Error&{status?:number}).status===404);
});
test('guarded computer control records only safe auth and status failure codes',async()=>{
 for(const [status,code] of [[401,'COMPUTER_WORKER_AUTH_REJECTED'],[403,'COMPUTER_WORKER_FORBIDDEN'],[503,'COMPUTER_WORKER_HTTP_ERROR']] as const){
  const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>new Response('private upstream detail',{status}));
  await assert.rejects(worker.control(signal),error=>error instanceof Error&&error.message===code&&(error as Error&{status?:number}).status===status);
 }
 const offline=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>{throw new Error('private URL and token must not be logged')});
 await assert.rejects(offline.control(signal),error=>error instanceof Error&&error.message==='COMPUTER_WORKER_TRANSPORT_FAILED');
});
test('guarded worker transport diagnostics identify the operation and safe socket code without leaking error text',async()=>{
 const nested=Object.assign(new Error(`private upstream ${url.href} ${token}`),{code:'ECONNRESET'});
 const failure=Object.assign(new Error(`private request ${url.href} ${token}`),{cause:nested});
 const cases=[
  {operation:'control',run:(worker:HttpGuardedComputerWorker)=>worker.control(signal)},
  {operation:'navigate',run:(worker:HttpGuardedComputerWorker)=>worker.navigateIfUnchanged({kind:'browser',action:'navigate',url:'https://example.org/'},{owner:'agent',url:'about:blank'},signal)},
  {operation:'execute',run:(worker:HttpGuardedComputerWorker)=>worker.performIfUnchanged({kind:'browser',action:'click',by:'role',role:'button',target:'Continue'},{owner:'agent',url:'https://example.org/',screenshotSha256:'a'.repeat(64)},signal)},
 ] as const;
 for(const item of cases){
  const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>{throw failure});
  await assert.rejects(item.run(worker),error=>{
   const metadata=safeDiagnosticMetadata(error);
   return metadata.code==='COMPUTER_WORKER_TRANSPORT_FAILED'&&metadata.workerOperation===item.operation&&metadata.transportCode==='ECONNRESET'&&!JSON.stringify(metadata).includes(token)&&!JSON.stringify(metadata).includes(url.href);
  });
 }
});
test('guarded desktop failures preserve only fixed worker diagnostics and never response text',async()=>{
 for(const [workerCode,expected] of [['BOT_SCREEN_CAPACITY','COMPUTER_SCREEN_CAPACITY'],['ACTIVE_TAB_UNRESOLVED','COMPUTER_ACTIVE_TAB_UNRESOLVED'],['DOTS_RENDERER_UNRESPONSIVE','COMPUTER_RENDERER_UNRESPONSIVE']] as const){
  const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>Response.json({code:workerCode,error:`private URL ${url.href} token ${token}`},{status:503}));
  await assert.rejects(worker.snapshot(signal),error=>{
   const metadata=safeDiagnosticMetadata(error);
   return metadata.code===expected&&metadata.status===503&&error instanceof Error&&error.message===expected;
  });
 }
 const unmapped=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>Response.json({error:`private URL ${url.href} token ${token}`},{status:503}));
 await assert.rejects(unmapped.snapshot(signal),error=>{
  const metadata=safeDiagnosticMetadata(error);
  return metadata.code==='COMPUTER_SNAPSHOT_FAILED'&&metadata.status===503&&error instanceof Error&&error.message==='COMPUTER_SNAPSHOT_FAILED'&&!error.message.includes(token);
 });
});
test('guarded action failures preserve only a safe diagnostic code and HTTP status',async()=>{
 const state={owner:'agent' as const,url:'https://example.test/',screenshotSha256:'a'.repeat(64)},action={kind:'browser',action:'navigate',url:'https://example.test/'};
 for(const status of [400,409,503]){
  const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>Response.json({error:'private upstream detail',token},{status}));
  await assert.rejects(worker.performIfUnchanged(action,state,signal),error=>{
   const metadata=safeDiagnosticMetadata(error);
   return metadata.code==='COMPUTER_WORKER_HTTP_ERROR'&&metadata.status===status&&metadata.workerOperation==='execute'&&safeWorkerTarget(error)===`grok-user-${hash}`&&!JSON.stringify(metadata).includes(`grok-user-${hash}`)&&error instanceof Error&&error.message==='COMPUTER_WORKER_HTTP_ERROR';
  });
 }
 const forbidden=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>Response.json({error:`private upstream detail ${token}`},{status:403}));
 await assert.rejects(forbidden.performIfUnchanged(action,state,signal),error=>{
  const metadata=safeDiagnosticMetadata(error);
  return metadata.code==='COMPUTER_WORKER_FORBIDDEN'&&metadata.status===403&&error instanceof Error&&error.message==='COMPUTER_WORKER_FORBIDDEN'&&!error.message.includes(token);
 });
 const signInWorker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>Response.json({code:'COMPUTER_SIGNIN_HANDOFF_REQUIRED',error:'Human sign-in or verification is required'},{status:403}));
 await assert.rejects(signInWorker.performIfUnchanged({kind:'browser',action:'click',by:'role',role:'button',target:'Continue'},state,signal),error=>{
  const metadata=safeDiagnosticMetadata(error);
  return metadata.code==='COMPUTER_SIGNIN_HANDOFF_REQUIRED'&&metadata.status===403&&error instanceof Error&&error.message==='COMPUTER_SIGNIN_HANDOFF_REQUIRED';
 });
 const signInNavigationWorker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>Response.json({code:'COMPUTER_SIGNIN_HANDOFF_REQUIRED',error:'Human sign-in or verification is required'},{status:403}));
 await assert.rejects(signInNavigationWorker.navigateIfUnchanged({kind:'browser',action:'navigate',url:'https://accounts.example.test/signin'}, {owner:'agent',url:'https://example.test/'}, signal), error=>{
  const metadata=safeDiagnosticMetadata(error);
  return metadata.code==='COMPUTER_SIGNIN_HANDOFF_REQUIRED'&&metadata.status===403&&error instanceof Error&&error.message==='COMPUTER_SIGNIN_HANDOFF_REQUIRED';
 });
 const offline=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>{throw new Error(`private endpoint ${url.href} and ${token}`)});
 await assert.rejects(offline.performIfUnchanged(action,state,signal),error=>safeDiagnosticMetadata(error).code==='COMPUTER_WORKER_TRANSPORT_FAILED');
 const invalid=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>new Response('private upstream detail'));
 await assert.rejects(invalid.performIfUnchanged(action,state,signal),error=>safeDiagnosticMetadata(error).code==='COMPUTER_WORKER_INVALID_RESPONSE');
});
test('guarded snapshot failures identify the request stage and keep the worker target out of API diagnostics',async()=>{
 const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async request=>{
  assert.equal(new URL(String(request)).pathname,'/v1/guarded/snapshot');
  return Response.json({error:'private worker detail',token},{status:400});
 });
 await assert.rejects(worker.snapshot(signal),error=>{
  const metadata=safeDiagnosticMetadata(error);
  return metadata.code==='COMPUTER_SNAPSHOT_FAILED'&&metadata.status===400&&metadata.workerOperation==='snapshot'&&safeWorkerTarget(error)===`grok-user-${hash}`&&!JSON.stringify(metadata).includes(`grok-user-${hash}`)&&!JSON.stringify(metadata).includes(token);
 });
 const unsafeTarget=Object.assign(new Error('x'),{workerTarget:`grok-user-${'x'.repeat(32)}`});
 assert.equal(safeWorkerTarget(unsafeTarget),undefined);
});
test('guarded worker maps browser worker diagnostics to fixed safe codes',async()=>{
 const action={kind:'browser',action:'click',by:'role',role:'link',target:'Business Rules'},state={owner:'agent' as const,url:'https://www.bse.cn/',screenshotSha256:'a'.repeat(64)};
 for(const [workerCode,status,expected] of [
  ['COMPUTER_BROWSER_TARGET_NOT_FOUND',422,'COMPUTER_BROWSER_TARGET_NOT_FOUND'],
  ['COMPUTER_BROWSER_TARGET_AMBIGUOUS',422,'COMPUTER_BROWSER_TARGET_AMBIGUOUS'],
  ['COMPUTER_BROWSER_ACTION_TIMEOUT',504,'COMPUTER_BROWSER_ACTION_TIMEOUT'],
  ['COMPUTER_BROWSER_ACTION_FAILED',500,'COMPUTER_BROWSER_ACTION_FAILED'],
  ['COMPUTER_STATE_CHANGED',409,'COMPUTER_STATE_CHANGED'],
  ['COMPUTER_OWNER_USER',409,'COMPUTER_OWNER_USER'],
 ] as const){
  const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>Response.json({code:workerCode,error:`private page and token ${token}`},{status}));
  await assert.rejects(worker.performIfUnchanged(action,state,signal),error=>{
   const metadata=safeDiagnosticMetadata(error);
   return metadata.code===expected&&metadata.status===status&&error instanceof Error&&error.message===expected&&!error.message.includes(token);
  });
 }
 for(const workerCode of ['COMPUTER_WORKER_SCREEN_SCOPE_INVALID','COMPUTER_WORKER_SCREEN_OWNER_FAILED','COMPUTER_WORKER_REQUEST_BODY_INVALID','COMPUTER_WORKER_ACTION_EXECUTION_FAILED'] as const){
  const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async()=>Response.json({code:workerCode,error:`private page and token ${token}`},{status:workerCode.includes('OWNER')?503:workerCode.includes('EXECUTION')?500:400}));
  await assert.rejects(worker.performIfUnchanged(action,state,signal),error=>{
   const metadata=safeDiagnosticMetadata(error);
   return metadata.code===workerCode&&error instanceof Error&&error.message===workerCode&&!error.message.includes(token);
  });
 }
});
