import { createHash } from 'node:crypto';

/** Serializes worker-owned actions and checks a fresh desktop snapshot immediately before acting. */
export function createGuardedComputer({readOwner,readPageUrl,readScreenshot,perform}) {
  let tail=Promise.resolve();
  async function locked(work) {
    const previous=tail;let release;
    tail=new Promise(resolve=>{release=resolve});
    await previous;
    try { return await work(); } finally { release(); }
  }
  async function capture(includeImage=false) {
    const owner=readOwner();
    const url=await readPageUrl();
    const bytes=await readScreenshot();
    if(readOwner()!==owner) throw new Error('Computer ownership changed');
    if(typeof url!=='string'||!Buffer.isBuffer(bytes)||!bytes.length)throw new Error('Computer snapshot unavailable');
    const state={owner,url,screenshotSha256:createHash('sha256').update(bytes).digest('hex')};
    if(includeImage) {
      if(bytes.length>1024*1024)throw new Error('Computer screenshot too large');
      return {...state,image:bytes.toString('base64')};
    }
    return state;
  }
  return {
    locked,
    snapshot:()=>locked(capture),
    snapshotWithImage:()=>locked(()=>capture(true)),
    execute:(input,expected)=>locked(async()=>{
      if(!expected||typeof expected!=='object'||expected.owner!=='agent'||typeof expected.url!=='string'||!/^[a-f0-9]{64}$/.test(expected.screenshotSha256||''))throw new Error('Invalid expected computer state');
      const current=await capture();
      if(current.owner!=='agent'||current.url!==expected.url||current.screenshotSha256!==expected.screenshotSha256)throw new Error('Computer state or ownership changed');
      return perform(input);
    }),
  };
}
