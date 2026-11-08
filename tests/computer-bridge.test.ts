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
test('computer action proposal failures expose only fixed diagnostic codes',async()=>{
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'about:blank',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>({ready:true})};
 const makeBridge=(live:boolean,propose:()=>Promise<unknown>)=>new ComputerBridge({hasLiveLease:async()=>live,markComputerUsed:async()=>true},{propose,consume:async()=>false,status:async()=>null} as any,()=>worker);
 const signal=new AbortController().signal,input={kind:'browser',action:'navigate',url:'https://example.com/'};
 for(const [bridge,code] of [[makeBridge(false,async()=>null),'COMPUTER_RUN_LEASE_UNAVAILABLE'],[makeBridge(true,async()=>null),'COMPUTER_APPROVAL_RUN_UNAVAILABLE'],[makeBridge(true,async()=>{throw new Error('private database detail')}),'COMPUTER_APPROVAL_STORE_FAILED']] as const){
  await assert.rejects(bridge.propose(scope,input,signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode===code);
 }
});
test('only directly requested browser destinations skip computer approval',async()=>{
 let approvalProposals=0,performed=0,marked=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'about:blank',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async(input?:unknown)=>{performed++;const url=input&&typeof input==='object'?(input as {url?:unknown}).url:undefined;return {ready:true,...(typeof url==='string'?{url}:{})}}};
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>{marked++;return true}},approvals,()=>worker),signal=new AbortController().signal;
 const scoped={...scope,requestedNavigationOrigins:['https://www.google.com','https://mail.google.com']};
 const googleNavigation=await bridge.propose(scoped,{kind:'browser',action:'navigate',url:'https://www.google.com/'},signal);
 assert.deepEqual(googleNavigation,{status:'completed',result:{ready:true,url:'https://www.google.com/'}});
 const navigation=await bridge.propose(scoped,{kind:'browser',action:'navigate',url:'https://mail.google.com/'},signal);
 assert.deepEqual(navigation,{status:'completed',result:{ready:true,url:'https://mail.google.com/'}});assert.equal(performed,2);assert.equal(marked,2);assert.equal(approvalProposals,0);
 const publicPrompt='For this read-only public end-to-end check, use Browser User on this Bot\'s cloud computer to open https://mail.google.com. If a Google sign-in page is visible, stop and report only its page title. If the existing session goes past sign-in, do not inspect messages or account data; stop and say the browser is already signed in. Do not use Desktop User, click page content, enter credentials, submit forms, or inspect the inbox.';
 const publicScope={...scope,requestedNavigationOrigins:requestedNavigationOrigins(publicPrompt)};assert.deepEqual(publicScope.requestedNavigationOrigins,['https://mail.google.com']);
 const publicNavigation=await bridge.propose(publicScope,{kind:'browser',action:'navigate',url:'https://mail.google.com/'},signal);
 assert.deepEqual(publicNavigation,{status:'completed',result:{ready:true,url:'https://mail.google.com/'}});assert.equal(performed,3);assert.equal(marked,3);assert.equal(approvalProposals,0,'the exact read-only public Gmail request must not create a repetitive navigation approval');
 const click=await bridge.propose(scoped,{kind:'browser',action:'click',by:'text',target:'Compose'},signal);
 assert.ok('id'in click);assert.equal(approvalProposals,1);
 const otherDestination=await bridge.propose(scoped,{kind:'browser',action:'navigate',url:'https://example.com/'},signal);
 assert.ok('id'in otherDestination);assert.equal(approvalProposals,2);
 const ordinaryDesktopClick=await bridge.propose(scoped,{kind:'desktop',action:'click',x:100,y:100},signal);
 assert.ok('id'in ordinaryDesktopClick);assert.equal(approvalProposals,3,'ordinary desktop actions remain approval-gated');
});
test('an explicitly requested navigation does not require an approval screenshot payload',async()=>{
 let imageSnapshots=0,performed=0,approvalProposals=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'about:blank',screenshotSha256:'a'.repeat(64)}),snapshotWithImage:async()=>{imageSnapshots++;throw new Error('large screenshot payload')},inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>{performed++;return {url:'https://example.org/'}}};
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 const result=await bridge.propose({...scope,requestedNavigationOrigins:['https://example.org']},{kind:'browser',action:'navigate',url:'https://example.org/'},signal);
 assert.deepEqual(result,{status:'completed',result:{url:'https://example.org/'}});assert.equal(imageSnapshots,0);assert.equal(performed,1);assert.equal(approvalProposals,0);
});
test('an explicitly requested navigation uses an atomic URL and owner check without taking any screenshot',async()=>{
 let stateReads=0,navigations=0,screenReads=0,approvalProposals=0,marked=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>{screenReads++;throw new Error('screenshot should not be needed')},snapshotWithImage:async()=>{screenReads++;throw new Error('screenshot should not be needed')},navigationState:async()=>{stateReads++;return {owner:'agent' as const,url:'about:blank'}},navigateIfUnchanged:async(input:unknown,expected:{owner:'agent'|'user';url:string})=>{navigations++;assert.equal(expected.owner,'agent');assert.equal(expected.url,'about:blank');assert.deepEqual(input,{kind:'browser',action:'navigate',url:'https://example.org/'});return {url:'https://example.org/'}},inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>{throw new Error('legacy navigation path should not be used')}};
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>{marked++;return true}},approvals,()=>worker),signal=new AbortController().signal;
 const result=await bridge.propose({...scope,requestedNavigationOrigins:['https://example.org']},{kind:'browser',action:'navigate',url:'https://example.org/'},signal);
 assert.deepEqual(result,{status:'completed',result:{url:'https://example.org/'}});assert.equal(stateReads,1);assert.equal(navigations,1);assert.equal(screenReads,0);assert.equal(approvalProposals,0);assert.equal(marked,1);
});
test('sign-in handoff rejects desktop and browser interaction proposals instead of creating approval prompts',async()=>{
 let approvalProposals=0,approvalConsumes=0,performed=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'https://example.test/',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async(input?:unknown)=>{performed++;const url=input&&typeof input==='object'?(input as {url?:unknown}).url:undefined;return {ready:true,...(typeof url==='string'?{url}:{})}}};
 const approvals={propose:async()=>{approvalProposals++;return {id:randomUUID()}},consume:async()=>{approvalConsumes++;return false},status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 const scoped={...scope,requestedNavigationOrigins:['https://www.google.com','https://mail.google.com'],signInHandoff:true};
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
 await assert.rejects(bridge.execute(scoped,randomUUID(),{kind:'terminal',action:'run',command:'printf unsafe',directory:'task'},signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_SIGNIN_HANDOFF_REQUIRED');
 assert.equal(approvalProposals,0);assert.equal(approvalConsumes,0);assert.equal(performed,1);
});
test('terminal approval is exact, lease-bound, screenshot-bound, and consumed before local execution',async()=>{
 let actionText='',consumed=0,workerActions=0,owner:'agent'|'user'='agent',screenshot='a'.repeat(64);
 const approvals:any={
  propose:async(_runId:string,_leaseId:string,action:string)=>{actionText=action;return {id:randomUUID(),action}},
  consume:async(_runId:string,_leaseId:string,_id:string,action:string)=>{if(action!==actionText)return false;consumed++;return true},
  status:async()=>null,
 };
 const worker={
  control:async()=>({owner}),snapshot:async()=>({owner,url:'https://example.test/',screenshotSha256:screenshot}),
  snapshotWithImage:async()=>({state:{owner,url:'https://example.test/',screenshotSha256:screenshot},image:Buffer.from('screenshot')}),
  inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>{workerActions++;return {ready:true}},
 };
 const bridge=new ComputerBridge({hasLiveLease:async()=>true,markComputerUsed:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 const input={kind:'terminal',action:'run',command:'printf approved',directory:'task'};
 const approval=await bridge.propose(scope,input,signal);assert.ok(approval.id);assert.match(actionText,/printf approved/);
 assert.deepEqual(await bridge.execute(scope,approval.id,input,signal),{approved:true});assert.equal(consumed,1);assert.equal(workerActions,0);
 const changed=await bridge.propose(scope,input,signal);screenshot='b'.repeat(64);
 await assert.rejects(bridge.execute(scope,changed.id,input,signal),/missing, expired or does not match/);assert.equal(consumed,1);
 owner='user';await assert.rejects(bridge.propose(scope,input,signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_OWNER_USER');assert.equal(consumed,1);
});
