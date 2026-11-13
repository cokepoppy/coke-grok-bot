import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ComputerBridge,type RunScope} from '../src/server/computer-bridge.ts';
import {requestedNavigationOrigins} from '../src/server/computer-navigation-policy.ts';
import {SafeDiagnosticError} from '../src/server/safe-diagnostics.ts';
const scope:RunScope={owner:{tenantId:randomUUID(),userId:randomUUID()},botId:randomUUID(),runId:randomUUID(),leaseId:randomUUID()};
test('bridge refuses expired or mismatched run scopes before reading a desktop',async()=>{
 let calls=0,marked=0,live=false;const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>{calls++;return {owner:'agent' as const,url:'https://example.test/',screenshotSha256:'a'.repeat(64)}},inspect:async()=>{calls++;return {ready:true}},screenshot:async()=>{calls++;return Buffer.from('png')},performIfUnchanged:async()=>{calls++;return {ready:true}}};
 const approvals={propose:async()=>null,consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async(owner,runId,leaseId,botId)=>live&&owner.userId===scope.owner.userId&&runId===scope.runId&&leaseId===scope.leaseId&&botId===scope.botId,markComputerUsed:async()=>{marked++;return true}},approvals,()=>worker),signal=new AbortController().signal;
 await assert.rejects(bridge.inspect(scope,signal));await assert.rejects(bridge.screenshot(scope,signal));assert.equal(calls,0);
 live=true;assert.deepEqual(await bridge.inspect(scope,signal),{ready:true});assert.equal(marked,1);
 await assert.rejects(bridge.inspect({...scope,owner:{...scope.owner,userId:randomUUID()}},signal));
 await assert.rejects(bridge.propose({...scope,leaseId:randomUUID()},{kind:'desktop',action:'click',x:1,y:1},signal));assert.equal(calls,1);
 const abort=new AbortController();abort.abort();await assert.rejects(bridge.screenshot(scope,abort.signal));assert.equal(calls,1);
});
test('direct task computer actions do not consult approval storage',async()=>{
 let proposals=0,performed=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'about:blank',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>{performed++;return {ready:true}}};
 const approvals={propose:async()=>{proposals++;return null},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 assert.deepEqual(await bridge.propose(scope,{kind:'desktop',action:'click',x:200,y:200},signal),{status:'completed',result:{ready:true}});
 assert.equal(proposals,0);assert.equal(performed,1);
});
test('ordinary browser navigation and page interactions skip per-step approval',async()=>{
 let approvalProposals=0,performed=0,marked=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'about:blank',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async(input?:unknown)=>{performed++;const url=input&&typeof input==='object'?(input as {url?:unknown}).url:undefined;return {ready:true,...(typeof url==='string'?{url}:{})}}};
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>{marked++;return true}},approvals,()=>worker),signal=new AbortController().signal;
 const scoped={...scope,browserTask:true,requestedNavigationOrigins:['https://www.google.com','https://mail.google.com']};
 const googleNavigation=await bridge.propose(scoped,{kind:'browser',action:'navigate',url:'https://www.google.com/'},signal);
 assert.deepEqual(googleNavigation,{status:'completed',result:{ready:true,url:'https://www.google.com/'}});
 const navigation=await bridge.propose(scoped,{kind:'browser',action:'navigate',url:'https://mail.google.com/'},signal);
 assert.deepEqual(navigation,{status:'completed',result:{ready:true,url:'https://mail.google.com/'}});assert.equal(performed,2);assert.equal(marked,2);assert.equal(approvalProposals,0);
 const publicPrompt='For this read-only public end-to-end check, use Browser User on this Bot\'s cloud computer to open https://mail.google.com. If a Google sign-in page is visible, stop and report only its page title. If the existing session goes past sign-in, do not inspect messages or account data; stop and say the browser is already signed in. Do not use Desktop User, click page content, enter credentials, submit forms, or inspect the inbox.';
 const publicScope={...scope,browserTask:true,requestedNavigationOrigins:requestedNavigationOrigins(publicPrompt)};assert.deepEqual(publicScope.requestedNavigationOrigins,['https://mail.google.com']);
 const publicNavigation=await bridge.propose(publicScope,{kind:'browser',action:'navigate',url:'https://mail.google.com/'},signal);
 assert.deepEqual(publicNavigation,{status:'completed',result:{ready:true,url:'https://mail.google.com/'}});assert.equal(performed,3);assert.equal(marked,3);assert.equal(approvalProposals,0,'the exact read-only public Gmail request must not create a repetitive navigation approval');
 const click=await bridge.propose(scoped,{kind:'browser',action:'click',by:'text',target:'Compose'},signal);
 assert.deepEqual(click,{status:'completed',result:{ready:true}});assert.equal(approvalProposals,0);
 const otherDestination=await bridge.propose(scoped,{kind:'browser',action:'navigate',url:'https://example.com/'},signal);
 assert.deepEqual(otherDestination,{status:'completed',result:{ready:true,url:'https://example.com/'}});assert.equal(performed,5);assert.equal(marked,5);assert.equal(approvalProposals,0,'ordinary navigation to a page discovered during the task must not create an approval');
 for(const action of [
  {kind:'desktop',action:'click',x:295,y:48},
  {kind:'desktop',action:'click',x:295,y:90},
  {kind:'desktop',action:'type',text:'https://mail.google.com/'},
 ] as const){
  await assert.rejects(bridge.propose(scoped,action,signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_NAVIGATION_USE_BROWSER');
 }
 assert.equal(approvalProposals,0,'browser-chrome clicks at both observed toolbar heights and URL entry must not create repetitive approval cards');
 const pageClick=await bridge.propose(scoped,{kind:'desktop',action:'click',x:100,y:130},signal);
 assert.deepEqual(pageClick,{status:'completed',result:{ready:true}});assert.equal(approvalProposals,0,'native desktop controls run without per-action approval');
 const enter=await bridge.propose(scoped,{kind:'desktop',action:'press',key:'Enter'},signal);
 assert.deepEqual(enter,{status:'completed',result:{ready:true}});assert.equal(approvalProposals,0,'Enter does not create per-action approval');
 const ordinaryDesktopClick=await bridge.propose(scope,{kind:'desktop',action:'click',x:100,y:200},signal);
 assert.deepEqual(ordinaryDesktopClick,{status:'completed',result:{ready:true}});assert.equal(approvalProposals,0,'native desktop actions do not need per-site allowlists');
 await assert.rejects(bridge.propose(scope,{kind:'desktop',action:'click',x:100,y:90},signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_NAVIGATION_USE_BROWSER');
 assert.equal(approvalProposals,0,'browser toolbar clicks are redirected without an approval even when the prompt did not name a URL');
});
test('a browser tool call outside an explicitly requested browser task is rejected without an approval',async()=>{
 let workerReads=0,performed=0,approvalProposals=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>{workerReads++;return {owner:'agent' as const,url:'about:blank',screenshotSha256:'a'.repeat(64)}},inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>{performed++;return {ready:true}}};
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 await assert.rejects(bridge.propose(scope,{kind:'browser',action:'navigate',url:'https://example.org/'},signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_WORKER_FORBIDDEN');
 await assert.rejects(bridge.propose(scope,{kind:'browser',action:'click',by:'role',role:'button',target:'Continue'},signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_WORKER_FORBIDDEN');
 assert.equal(workerReads,0);assert.equal(performed,0);assert.equal(approvalProposals,0,'unrequested browser calls do not create owner approval cards');
});

test('Browser User navigation recovers directly from Chromium’s connection-error page without approval',async()=>{
 let navigations=0,approvalProposals=0;
 const worker={
  control:async()=>({owner:'agent' as const}),
  snapshot:async()=>({owner:'agent' as const,url:'chrome-error://chromewebdata/',screenshotSha256:'a'.repeat(64)}),
  navigationState:async()=>({owner:'agent' as const,url:'chrome-error://chromewebdata/'}),
  navigateIfUnchanged:async(input:unknown,expected:{url:string})=>{navigations++;assert.deepEqual(input,{kind:'browser',action:'navigate',url:'http://127.0.0.1:8765/'});assert.equal(expected.url,'chrome-error://chromewebdata/');return {ready:true,url:'http://127.0.0.1:8765/',title:'BSE Demo'};},
  inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>({ready:true}),
 };
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 const result=await bridge.propose({...scope,browserTask:true},{kind:'browser',action:'navigate',url:'http://127.0.0.1:8765/'},signal);
 assert.deepEqual(result,{status:'completed',result:{ready:true,url:'http://127.0.0.1:8765/',title:'BSE Demo'}});
 assert.equal(navigations,1);assert.equal(approvalProposals,0);
});

test('Browser User opens a task HTML artifact from Chromium error page without approval',async()=>{
 let opened=0,approvalProposals=0,marked=0;
 const worker={
  control:async()=>({owner:'agent' as const}),
  snapshot:async()=>({owner:'agent' as const,url:'chrome-error://chromewebdata/',screenshotSha256:'a'.repeat(64)}),
  inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),
  performIfUnchanged:async(input:unknown,state:unknown,signal:AbortSignal,policy?:string)=>{
   opened++;assert.deepEqual(input,{kind:'browser',action:'open_artifact',path:'artifacts/bse-demo/index.html'});
   assert.equal((state as {url:string}).url,'chrome-error://chromewebdata/');assert.equal(signal.aborted,false);assert.equal(policy,'browser-task');
   return {ready:true,url:'file:///workspace/tasks/current/artifacts/bse-demo/index.html',title:'BSE Demo'};
  },
 };
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>{marked++;return true}},approvals,()=>worker),signal=new AbortController().signal;
 const result=await bridge.propose({...scope,browserTask:true},{kind:'browser',action:'open_artifact',path:'artifacts/bse-demo/index.html'},signal);
 assert.deepEqual(result,{status:'completed',result:{ready:true,url:'file:///workspace/tasks/current/artifacts/bse-demo/index.html',title:'BSE Demo'}});
 assert.equal(opened,1);assert.equal(approvalProposals,0);assert.equal(marked,1);
});

test('Browser User forwards an explicitly identified same-user task artifact without approval',async()=>{
 let opened=0,approvalProposals=0;
 const taskId='8faf80b9-752d-42f1-86fc-38bdaa0e4bc9';
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'chrome-error://chromewebdata/',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async(input:unknown,_state:unknown,_signal:AbortSignal,policy?:string)=>{opened++;assert.deepEqual(input,{kind:'browser',action:'open_artifact',artifactTaskId:taskId,path:'artifacts/bse-demo/index.html'});assert.equal(policy,'browser-task');return {ready:true,url:`file:///workspace/tasks/${taskId}/artifacts/bse-demo/index.html`,title:'BSE Demo'};}};
 const approvals={propose:async()=>{approvalProposals++;return{id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 const result=await bridge.propose({...scope,browserTask:true},{kind:'browser',action:'open_artifact',artifactTaskId:taskId,path:'artifacts/bse-demo/index.html'},signal);
 assert.deepEqual(result,{status:'completed',result:{ready:true,url:`file:///workspace/tasks/${taskId}/artifacts/bse-demo/index.html`,title:'BSE Demo'}});assert.equal(opened,1);assert.equal(approvalProposals,0);
});

test('Browser User opens a nested HTML artifact copied into its own task attachments without approval',async()=>{
 let opened=0,proposals=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'chrome-error://chromewebdata/',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async(input:unknown,_state:unknown,_signal:AbortSignal,policy?:string)=>{opened++;assert.deepEqual(input,{kind:'browser',action:'open_artifact',path:'attachments/bse-demo/index.html'});assert.equal(policy,'browser-task');return {ready:true,url:'file:///workspace/tasks/receiver/attachments/bse-demo/index.html',title:'BSE Demo'};}};
 const approvals={propose:async()=>{proposals++;return{id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 const result=await bridge.propose({...scope,browserTask:true},{kind:'browser',action:'open_artifact',path:'attachments/bse-demo/index.html'},signal);
 assert.deepEqual(result,{status:'completed',result:{ready:true,url:'file:///workspace/tasks/receiver/attachments/bse-demo/index.html',title:'BSE Demo'}});assert.equal(opened,1);assert.equal(proposals,0);
});

test('explicit browser task scope runs all requested page controls across sites without per-control approvals',async()=>{
 let proposals=0,performed=0,marked=0,lastPolicy:unknown,pageUrl='https://mail.google.com/mail/u/0/#inbox';
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:pageUrl,screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async(_input:unknown,_state:unknown,_signal:AbortSignal,policy?:unknown)=>{performed++;lastPolicy=policy;return {ready:true}}};
 const approvals={propose:async()=>{proposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>{marked++;return true}},approvals,()=>worker),signal=new AbortController().signal;
 const scoped={...scope,browserTask:true};
 for(const input of [
  {kind:'browser',action:'fill',by:'placeholder',target:'Search mail',value:'is:unread'},
  {kind:'browser',action:'press',by:'placeholder',target:'Search mail',key:'Enter'},
  {kind:'browser',action:'click',by:'role',role:'link',target:'Inbox Quarterly project update'},
  {kind:'browser',action:'click',by:'role',role:'button',target:'Reply'},
  {kind:'browser',action:'fill',by:'role',role:'textbox',target:'Message Body',value:'Thanks for the update.'},
  {kind:'browser',action:'click',by:'role',role:'menuitem',target:'Mark as unread'},
  {kind:'browser',action:'click',by:'role',role:'button',target:'Send'},
  {kind:'browser',action:'click',by:'role',role:'button',target:'Delete'},
  {kind:'browser',action:'click',by:'role',role:'button',target:'Archive'},
  {kind:'browser',action:'click',by:'role',role:'button',target:'Publish'},
  {kind:'browser',action:'upload_file',artifactTaskId:'8faf80b9-752d-42f1-86fc-38bdaa0e4bc9',path:'artifacts/bse-demo/index.html',by:'css',target:'input[type="file"]'},
 ] as const){
  assert.deepEqual(await bridge.propose(scoped,input,signal),{status:'completed',result:{ready:true}});
  assert.equal(lastPolicy,'browser-task');
 }
 assert.equal(proposals,0);assert.equal(performed,11);assert.equal(marked,11);
 const genericWebsiteSearch=await bridge.propose({...scoped}, {kind:'browser',action:'fill',by:'placeholder',target:'Search products',value:'wireless headphones'},signal);
 assert.deepEqual(genericWebsiteSearch,{status:'completed',result:{ready:true}},'search fields work on sites without a site-specific rule');
 pageUrl='https://shop.example/search';
 const crossSitePageClick=await bridge.propose(scoped,{kind:'browser',action:'click',by:'role',role:'link',target:'Product details'},signal);
 assert.deepEqual(crossSitePageClick,{status:'completed',result:{ready:true}},'the same run-scoped browser permission follows the user task across origins');
 assert.equal(proposals,0,'a direct, run-scoped browser task does not create approval cards for site controls or an explicitly requested artifact upload');
});
test('a direct browser task never creates a desktop approval for a click inside the active webpage',async()=>{
 let proposals=0,performed=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'https://mail.google.com/mail/u/0/#inbox',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>{performed++;return {ready:true}}};
 const approvals={propose:async()=>{proposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 for(const input of [
  {kind:'desktop',action:'click',x:682,y:340},
  {kind:'desktop',action:'type',text:'is:unread'},
  {kind:'desktop',action:'press',key:'Enter'},
 ] as const){
  await assert.rejects(bridge.propose({...scope,browserTask:true},input,signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_NAVIGATION_USE_BROWSER');
 }
 assert.equal(proposals,0,'route webpage interactions to Browser User rather than opening an approval card');
 assert.equal(performed,0,'coordinate based page actions are never executed through Computer User during a browser task');
});

test('an outdated Worker approval response fails safely instead of producing a per-control approval card',async()=>{
 let proposals=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'https://mail.google.com/mail/u/0/#inbox',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>{throw new SafeDiagnosticError('COMPUTER_ACTION_REQUIRES_APPROVAL')}};
 const approvals={propose:async()=>{proposals++;return{id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 await assert.rejects(bridge.propose({...scope,browserTask:true},{kind:'browser',action:'fill',by:'placeholder',target:'Search mail',value:'is:unread'},signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_WORKER_FORBIDDEN');
 assert.equal(proposals,0,'an older restrictive Worker must never recreate the approval loop');
});
test('an explicitly requested navigation does not require an approval screenshot payload',async()=>{
 let imageSnapshots=0,performed=0,approvalProposals=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'about:blank',screenshotSha256:'a'.repeat(64)}),snapshotWithImage:async()=>{imageSnapshots++;throw new Error('large screenshot payload')},inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>{performed++;return {url:'https://example.org/'}}};
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 const result=await bridge.propose({...scope,browserTask:true,requestedNavigationOrigins:['https://example.org']},{kind:'browser',action:'navigate',url:'https://example.org/'},signal);
 assert.deepEqual(result,{status:'completed',result:{url:'https://example.org/'}});assert.equal(imageSnapshots,0);assert.equal(performed,1);assert.equal(approvalProposals,0);
});
test('an explicitly requested navigation uses an atomic URL and owner check without taking any screenshot',async()=>{
 let stateReads=0,navigations=0,screenReads=0,approvalProposals=0,marked=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>{screenReads++;throw new Error('screenshot should not be needed')},snapshotWithImage:async()=>{screenReads++;throw new Error('screenshot should not be needed')},navigationState:async()=>{stateReads++;return {owner:'agent' as const,url:'about:blank'}},navigateIfUnchanged:async(input:unknown,expected:{owner:'agent'|'user';url:string})=>{navigations++;assert.equal(expected.owner,'agent');assert.equal(expected.url,'about:blank');assert.deepEqual(input,{kind:'browser',action:'navigate',url:'https://example.org/'});return {url:'https://example.org/'}},inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>{throw new Error('legacy navigation path should not be used')}};
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>{marked++;return true}},approvals,()=>worker),signal=new AbortController().signal;
 const result=await bridge.propose({...scope,browserTask:true,requestedNavigationOrigins:['https://example.org']},{kind:'browser',action:'navigate',url:'https://example.org/'},signal);
 assert.deepEqual(result,{status:'completed',result:{url:'https://example.org/'}});assert.equal(stateReads,1);assert.equal(navigations,1);assert.equal(screenReads,0);assert.equal(approvalProposals,0);assert.equal(marked,1);
});
test('an older guarded desktop still opens an explicitly requested URL without an approval after its fast-path endpoint returns 404',async()=>{
 let legacySnapshots=0,legacyNavigations=0,approvalProposals=0,marked=0;
 const worker={control:async()=>({owner:'agent' as const}),navigationState:async()=>{throw new SafeDiagnosticError('COMPUTER_WORKER_HTTP_ERROR',404)},navigateIfUnchanged:async()=>{throw new Error('unsupported endpoint must not be retried')},snapshot:async()=>{legacySnapshots++;return {owner:'agent' as const,url:'about:blank',screenshotSha256:'a'.repeat(64)}},inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async(input:unknown,expected:{owner:'agent'|'user';url:string})=>{legacyNavigations++;assert.deepEqual(input,{kind:'browser',action:'navigate',url:'https://example.org/'});assert.equal(expected.owner,'agent');assert.equal(expected.url,'about:blank');return {ready:true,url:'https://example.org/'}}};
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>{marked++;return true}},approvals,()=>worker),signal=new AbortController().signal;
 const result=await bridge.propose({...scope,browserTask:true,requestedNavigationOrigins:['https://example.org']},{kind:'browser',action:'navigate',url:'https://example.org/'},signal);
 assert.deepEqual(result,{status:'completed',result:{ready:true,url:'https://example.org/'}});assert.equal(legacySnapshots,1);assert.equal(legacyNavigations,1);assert.equal(approvalProposals,0);assert.equal(marked,1);
});
test('sign-in handoff blocks computer input and relies on the Worker to hand off Browser authentication',async()=>{
 let approvalProposals=0,approvalConsumes=0,performed=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'https://example.test/',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async(input?:unknown)=>{if(input&&typeof input==='object'&&(input as {action?:unknown}).action==='click')throw new SafeDiagnosticError('COMPUTER_SIGNIN_HANDOFF_REQUIRED');performed++;const url=input&&typeof input==='object'?(input as {url?:unknown}).url:undefined;return {ready:true,...(typeof url==='string'?{url}:{})}}};
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>{approvalConsumes++;return false},status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 const scoped={...scope,requestedNavigationOrigins:['https://www.google.com','https://mail.google.com'],signInHandoff:true,browserTask:true};
 for(const action of [
  {kind:'desktop',action:'click',x:100,y:100},
  {kind:'desktop',action:'type',text:'https://mail.google.com'},
  {kind:'desktop',action:'press',key:'Enter'},
  {kind:'browser',action:'click',by:'text',target:'Sign in'},
 ] as const){
  await assert.rejects(bridge.propose(scoped,action,signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_SIGNIN_HANDOFF_REQUIRED');
 }
 const navigation=await bridge.propose(scoped,{kind:'browser',action:'navigate',url:'https://mail.google.com/'},signal);
 assert.deepEqual(navigation,{status:'completed',result:{ready:true,url:'https://mail.google.com/'}});
 await assert.rejects(bridge.propose(scoped,{kind:'browser',action:'navigate',url:'https://example.test/'},signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_SIGNIN_HANDOFF_REQUIRED');
 await assert.rejects(bridge.execute(scoped,randomUUID(),{kind:'terminal',action:'run',command:'printf unsafe',directory:'task'},signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_SIGNIN_HANDOFF_REQUIRED');
 assert.equal(approvalProposals,0);assert.equal(approvalConsumes,0);assert.equal(performed,1);
});
test('a conditional sign-in handoff resumes generic Browser User work after control returns',async()=>{
 let proposals=0,performed=0,marked=0,lastPolicy:unknown;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'https://mail.google.com/mail/u/0/#inbox',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async(_input:unknown,_state:unknown,_signal:AbortSignal,policy?:unknown)=>{performed++;lastPolicy=policy;return {ready:true}}};
 const approvals={propose:async()=>{proposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>{marked++;return true}},approvals,()=>worker),signal=new AbortController().signal;
 const scoped={...scope,requestedNavigationOrigins:['https://mail.google.com'],signInHandoff:true,continuedSignInHandoff:true,browserTask:true};
 for(const input of [
  {kind:'browser',action:'fill',by:'placeholder',target:'Search mail',value:'is:unread'},
  {kind:'browser',action:'press',by:'placeholder',target:'Search mail',key:'Enter'},
  {kind:'browser',action:'click',by:'role',role:'link',target:'Quarterly update'},
  {kind:'browser',action:'click',by:'role',role:'button',target:'Reply'},
  {kind:'browser',action:'fill',by:'role',role:'textbox',target:'Message Body',value:'Thanks for the update.'},
  {kind:'browser',action:'click',by:'role',role:'menuitem',target:'Mark as unread'},
  {kind:'browser',action:'navigate',url:'https://mail.google.com/mail/u/0/#inbox'},
  {kind:'browser',action:'navigate',url:'https://www.example.org/'},
 ] as const){
  assert.deepEqual(await bridge.propose(scoped,input,signal),{status:'completed',result:{ready:true}});
  if(input.action!=='navigate')assert.equal(lastPolicy,'browser-task');
 }
 await assert.rejects(bridge.propose(scoped,{kind:'desktop',action:'click',x:200,y:200},signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_SIGNIN_HANDOFF_REQUIRED');
 assert.equal(proposals,0);assert.equal(performed,8);assert.equal(marked,8);
});
test('legacy terminal approvals cannot create or execute owner approval cards',async()=>{
 let actionText='',consumed=0,workerActions=0;
 const approvals:any={
  propose:async(_runId:string,_leaseId:string,action:string)=>{actionText=action;return {id:randomUUID(),action}},
  consume:async(_runId:string,_leaseId:string,_id:string,action:string)=>{if(action!==actionText)return false;consumed++;return true},
  status:async()=>null,
 };
 const worker={
  control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'https://example.test/',screenshotSha256:'a'.repeat(64)}),
  snapshotWithImage:async()=>({state:{owner:'agent' as const,url:'https://example.test/',screenshotSha256:'a'.repeat(64)},image:Buffer.from('screenshot')}),
  inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>{workerActions++;return {ready:true}},
 };
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 const input={kind:'terminal',action:'run',command:'printf approved',directory:'task'};
 await assert.rejects(bridge.propose(scope,input,signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_WORKER_FORBIDDEN');
 await assert.rejects(bridge.execute(scope,randomUUID(),input,signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_WORKER_FORBIDDEN');
 assert.equal(actionText,'');assert.equal(consumed,0);assert.equal(workerActions,0);
});
