import { createHash } from 'node:crypto';

export interface ComputerSnapshot { url:string; screenshotSha256:string; guardFingerprint?:string }
export interface ApprovedComputerAction { kind:'browser'|'desktop'|'terminal'; action:string; arguments:Record<string,unknown>; page:string; stateSha256:string; screenshotSha256:string; guardFingerprint?:string }

function location(raw:string):{page:string;stateSha256:string} {
 const url=new URL(raw);
 const stateSha256=createHash('sha256').update(url.href).digest('hex');url.search='';url.hash='';url.username='';url.password='';
 return {page:url.href,stateSha256};
}

function canonicalValue(value:unknown):unknown {
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(Array.isArray(value))return value.map(canonicalValue);
 if(typeof value==='object'){
  const entries=Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b));
  return Object.fromEntries(entries.map(([key,entry])=>[key,canonicalValue(entry)]));
 }
 return null;
}

/** Bind any owner-scoped computer operation to the observed page and screen state. */
export function canonicalComputerAction(input:unknown,snapshot:ComputerSnapshot):string {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid computer action envelope');
 const value=input as Record<string,unknown>,kind=value.kind,action=value.action;
 if((kind!=='browser'&&kind!=='desktop'&&kind!=='terminal')||typeof action!=='string'||!action)throw new Error('Invalid computer action envelope');
 if(!/^[a-f0-9]{64}$/.test(snapshot.screenshotSha256))throw new Error('Invalid screenshot fingerprint');
 const current=location(snapshot.url);
 const args=Object.fromEntries(Object.entries(value).filter(([key])=>key!=='kind'&&key!=='action').map(([key,entry])=>[key,canonicalValue(entry)]).sort(([a],[b])=>String(a).localeCompare(String(b))));
 if(snapshot.guardFingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(snapshot.guardFingerprint))throw new Error('Invalid computer state fingerprint');
 const result:ApprovedComputerAction={kind,action,arguments:args,...current,screenshotSha256:snapshot.screenshotSha256,...(snapshot.guardFingerprint?{guardFingerprint:snapshot.guardFingerprint}:{})};
 return JSON.stringify(result);
}
