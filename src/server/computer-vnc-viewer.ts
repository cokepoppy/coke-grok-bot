export type ComputerViewport={left:number;top:number;width:number;height:number};

function assertViewport(value:ComputerViewport):ComputerViewport{
 if(!value||![value.left,value.top,value.width,value.height].every(Number.isSafeInteger)||value.left<0||value.top<0||value.width<640||value.width>3840||value.height<480||value.height>2160||value.left+value.width>32767||value.top+value.height>32767)throw new Error('Invalid computer viewport');
 return value;
}

/** Serve a same-origin noVNC page cropped to the authenticated Bot's X11 screen. */
export function computerVncViewerHtml(input:ComputerViewport):string{
 const viewport=assertViewport(input),config=JSON.stringify(viewport).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cloud computer</title>
<style>
*{box-sizing:border-box}html,body,#viewport{width:100%;height:100%;margin:0;overflow:hidden}body{background:#090909;color:#aaa;font:12px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#viewport{position:relative;background:#090909}#mount{position:absolute;width:${viewport.width}px;height:${viewport.height}px}#status{position:fixed;left:12px;top:10px;z-index:2;padding:5px 8px;border-radius:999px;background:#111b;color:#ddd;pointer-events:none}#status[data-state="connected"]{color:#c9f4dc}#status[data-state="error"]{color:#ffd1d1}
</style></head><body><div id="viewport"><div id="mount"></div></div><div id="status" role="status" aria-live="polite" data-state="connecting">Connecting to computer…</div>
<script type="module">
import RFB from './core/rfb.js';
const box=${config};
const viewport=document.getElementById('viewport');
const mount=document.getElementById('mount');
const status=document.getElementById('status');
const socket=new URL('websockify',location.href);socket.protocol=location.protocol==='https:'?'wss:':'ws:';
const rfb=new RFB(mount,socket.toString());
rfb.viewOnly=false;rfb.focusOnClick=true;rfb.dragViewport=false;rfb.clipViewport=true;rfb.scaleViewport=false;rfb.resizeSession=false;
const screen=mount.firstElementChild;
const canvas=screen?.firstElementChild;
if(screen){screen.style.width=box.width+'px';screen.style.height=box.height+'px';screen.style.overflow='visible'}
// noVNC centers its scaled canvas inside the native-size screen. The outer
// mount already centers the scaled crop, so anchor the canvas to avoid a
// second centering offset while keeping noVNC's native viewport dimensions.
if(canvas)canvas.style.margin='0px';
const display=rfb._display;
let viewportReady=false,layoutUnavailable=false;
const moveViewport=display.viewportChangePos.bind(display);
display.viewportChangePos=(dx,dy)=>{
 if(!viewportReady)return;
 const current=display._viewportLoc;
 const x=Math.min(box.left+box.width-current.w,Math.max(box.left,current.x+Math.floor(dx)));
 const y=Math.min(box.top+box.height-current.h,Math.max(box.top,current.y+Math.floor(dy)));
 return moveViewport(x-current.x,y-current.y);
};
function center(){
 const scale=display.scale;
 const width=box.width*scale,height=box.height*scale;
 mount.style.left=(viewport.clientWidth-width)/2+'px';
 mount.style.top=(viewport.clientHeight-height)/2+'px';
}
function fitViewport(){
 if(!viewportReady||display.width<=0||display.height<=0)return;
 display.autoscale(viewport.clientWidth,viewport.clientHeight);
 center();
 rfb._fixScrollbars();
}
// Keep noVNC's resize observer from resetting the fitted crop to 1:1 scale.
rfb._updateScale=fitViewport;
function layout(){
 if(display.width<box.left+box.width||display.height<box.top+box.height)return false;
 viewportReady=true;
 const current=display._viewportLoc;
 if(current.w!==box.width||current.h!==box.height)display.viewportChangeSize(box.width,box.height);
 const positioned=display._viewportLoc;
 display.viewportChangePos(box.left-positioned.x,box.top-positioned.y);
 fitViewport();
 return true;
}
rfb.addEventListener('connect',()=>{
 if(!layout()){
  layoutUnavailable=true;status.textContent='Computer screen is unavailable';status.dataset.state='error';rfb.disconnect();return;
 }
 status.textContent='Connected';status.dataset.state='connected';
});
rfb.addEventListener('disconnect',event=>{
 if(layoutUnavailable)return;
 status.textContent=event.detail.clean?'Disconnected':'Connection failed';status.dataset.state='error';
});
new ResizeObserver(layout).observe(viewport);
</script></body></html>`;
}
