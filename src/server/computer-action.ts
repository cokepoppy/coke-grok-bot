import { createHash } from 'node:crypto';

type BrowserAction = 'navigate'|'open_artifact'|'click'|'fill'|'select'|'check'|'uncheck'|'press';
type DesktopAction = 'click'|'type'|'press';
export interface ComputerSnapshot { url:string; screenshotSha256:string }
export interface ApprovedComputerAction { kind:'browser'|'desktop'; action:BrowserAction|DesktopAction; arguments:Record<string,string|number>; page:string; stateSha256:string; screenshotSha256:string }
const browserActions=new Set(['navigate','open_artifact','click','fill','select','check','uncheck','press']);
const desktopActions=new Set(['click','type','press']);
const keys=new Set(['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End','Space','Control+A','Meta+A']);
const locators=new Set(['role','text','label','placeholder','css']);
function text(value:unknown,max:number):string { if(typeof value!=='string'||!value||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Invalid computer action');return value; }
function location(raw:string):{page:string;stateSha256:string} {
 const url=new URL(raw);if(!['http:','https:','file:'].includes(url.protocol)||url.username||url.password||raw.length>4096)throw new Error('Invalid page location');
 const stateSha256=createHash('sha256').update(url.href).digest('hex');url.search='';url.hash='';
 return {page:url.href,stateSha256};
}
/** Canonicalize on the trusted server, not from a free-form model summary. */
export function canonicalComputerAction(input:unknown,snapshot:ComputerSnapshot):string {
 if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Invalid computer action');
 const value=input as Record<string,unknown>,kind=value.kind,action=value.action;
 if((kind!=='browser'&&kind!=='desktop')||typeof action!=='string'||!(kind==='browser'?browserActions:desktopActions).has(action))throw new Error('Invalid computer action');
 if(!/^[a-f0-9]{64}$/.test(snapshot.screenshotSha256))throw new Error('Invalid screenshot fingerprint');
 const args:Record<string,string|number>={};let allowed:string[]=['kind','action'];
 if(kind==='browser'){
  if(action==='navigate'){
   allowed.push('url');const url=new URL(text(value.url,2048));if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid destination');args.url=url.href;
  }else if(action==='open_artifact'){
   allowed.push('path');const path=text(value.path,500);if(path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Invalid artifact path');args.path=path;
  }else{
   allowed.push('by','target');const by=text(value.by,20);if(!locators.has(by))throw new Error('Invalid locator');args.by=by;args.target=text(value.target,500);
   if(by==='role'){allowed.push('role');args.role=text(value.role,40)}
   if(action==='fill'||action==='select'){allowed.push('value');if(typeof value.value!=='string'||value.value.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.value))throw new Error('Invalid value');args.value=value.value}
   if(action==='press'){allowed.push('key');const key=text(value.key,32);if(!keys.has(key))throw new Error('Invalid key');args.key=key}
  }
 }else if(action==='click'){
  allowed.push('x','y');if(!Number.isInteger(value.x)||!Number.isInteger(value.y)||(value.x as number)<0||(value.x as number)>1439||(value.y as number)<0||(value.y as number)>899)throw new Error('Invalid coordinates');args.x=value.x as number;args.y=value.y as number;
 }else if(action==='type'){
  allowed.push('text');if(typeof value.text!=='string'||value.text.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.text))throw new Error('Invalid text');args.text=value.text;
 }else{
  allowed.push('key');const key=text(value.key,32);if(!keys.has(key))throw new Error('Invalid key');args.key=key;
 }
 if(Object.keys(value).some(key=>!allowed.includes(key)))throw new Error('Unexpected computer action field');
 const current=location(snapshot.url);
 const result:ApprovedComputerAction={kind,action:action as BrowserAction|DesktopAction,arguments:args,...current,screenshotSha256:snapshot.screenshotSha256};
 const serialized=JSON.stringify(result);if(serialized.length>4000)throw new Error('Computer action too large');return serialized;
}
