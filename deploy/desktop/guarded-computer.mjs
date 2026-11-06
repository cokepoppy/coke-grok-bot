import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
const desktopPanelHeight=27;

/** Fingerprint the desktop beneath the volatile 26px Xfce panel while retaining the full approval image hash. */
export function stableScreenshotFingerprint(png) {
  if (!Buffer.isBuffer(png) || png.length < 33 || !png.subarray(0,8).equals(pngSignature)) throw new Error('Computer screenshot is invalid');
  let width=0,height=0,bitDepth=0,colorType=0,interlace=0;
  const data=[];
  for(let offset=8;offset+12<=png.length;){
    const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),start=offset+8,end=start+length;
    if(end+4>png.length)throw new Error('Computer screenshot is invalid');
    if(type==='IHDR'){
      if(length!==13)throw new Error('Computer screenshot is invalid');
      width=png.readUInt32BE(start);height=png.readUInt32BE(start+4);bitDepth=png[start+8];colorType=png[start+9];interlace=png[start+12];
    }else if(type==='IDAT')data.push(png.subarray(start,end));
    else if(type==='IEND')break;
    offset=end+4;
  }
  if(!width||height<=desktopPanelHeight||bitDepth!==8||![2,6].includes(colorType)||interlace!==0||!data.length)throw new Error('Computer screenshot format is unsupported');
  const bytesPerPixel=colorType===6?4:3,stride=width*bytesPerPixel,scanlines=inflateSync(Buffer.concat(data));
  if(scanlines.length!==height*(stride+1))throw new Error('Computer screenshot is invalid');
  const hash=createHash('sha256'),header=Buffer.alloc(12);
  header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header.writeUInt32BE(desktopPanelHeight,8);hash.update(header);
  let previous=Buffer.alloc(stride),offset=0;
  for(let y=0;y<height;y++){
    const filter=scanlines[offset],encoded=scanlines.subarray(offset+1,offset+1+stride),row=Buffer.allocUnsafe(stride);offset+=stride+1;
    if(filter>4)throw new Error('Computer screenshot filter is unsupported');
    for(let x=0;x<stride;x++){
      const left=x>=bytesPerPixel?row[x-bytesPerPixel]:0,up=previous[x],upperLeft=x>=bytesPerPixel?previous[x-bytesPerPixel]:0;
      let predictor=0;
      if(filter===1)predictor=left;
      else if(filter===2)predictor=up;
      else if(filter===3)predictor=Math.floor((left+up)/2);
      else if(filter===4){
        const base=left+up-upperLeft,da=Math.abs(base-left),db=Math.abs(base-up),dc=Math.abs(base-upperLeft);
        predictor=da<=db&&da<=dc?left:db<=dc?up:upperLeft;
      }
      row[x]=(encoded[x]+predictor)&255;
    }
    if(y>=desktopPanelHeight)hash.update(row);
    previous=row;
  }
  return hash.digest('hex');
}

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
    const screenshotSha256=createHash('sha256').update(bytes).digest('hex');
    let guardFingerprint=screenshotSha256;
    try{guardFingerprint=stableScreenshotFingerprint(bytes)}catch{/* Older fixtures and workers retain exact-byte guarding. */}
    const state={owner,url,screenshotSha256,guardFingerprint};
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
      if(!expected||typeof expected!=='object'||expected.owner!=='agent'||typeof expected.url!=='string'||!/^[a-f0-9]{64}$/.test(expected.screenshotSha256||'')||!/^[a-f0-9]{64}$/.test(expected.guardFingerprint||''))throw new Error('Invalid expected computer state');
      const current=await capture();
      const approvedNavigation=input?.kind==='browser'&&input.action==='navigate';
      if(current.owner!=='agent'||current.url!==expected.url||(!approvedNavigation&&current.guardFingerprint!==expected.guardFingerprint))throw new Error('Computer state or ownership changed');
      return perform(input);
    }),
  };
}
