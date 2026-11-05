export const EYE_PATCHES=[[410,289,86,76],[530,287,89,77]];
export function blinkAt(time,idle=true){
 if(!idle)return 0;const phase=time%5.1,start=2.55+Math.floor(time/5.1)%3*.31,t=(phase-start)/.19;return t>=0&&t<=1?Math.sin(t*Math.PI):0;
}
export function createBlinkTexture(original,closed,canvasFactory){
 const rect=[406,283,218,87],texture=canvasFactory(rect[2],rect[3]),c=texture.getContext('2d');let amount=0,key=-1;
 const patches=EYE_PATCHES.map(([x,y,w,h])=>{const p=canvasFactory(w,h),pctx=p.getContext('2d');pctx.drawImage(closed,x,y,w,h,0,0,w,h);pctx.globalCompositeOperation='destination-in';const gx=pctx.createLinearGradient(0,0,w,0);gx.addColorStop(0,'transparent');gx.addColorStop(.065,'#fff');gx.addColorStop(.935,'#fff');gx.addColorStop(1,'transparent');pctx.fillStyle=gx;pctx.fillRect(0,0,w,h);const gy=pctx.createLinearGradient(0,0,0,h);gy.addColorStop(0,'transparent');gy.addColorStop(.08,'#fff');gy.addColorStop(.92,'#fff');gy.addColorStop(1,'transparent');pctx.fillStyle=gy;pctx.fillRect(0,0,w,h);return {image:p,rect:[x,y,w,h]};});
 function update(value){amount=Math.max(0,Math.min(1,Number(value)||0));const q=Math.round(amount*12)/12;if(q===key)return;key=q;c.clearRect(0,0,rect[2],rect[3]);if(q){c.globalAlpha=q;for(const p of patches)c.drawImage(p.image,p.rect[0]-rect[0],p.rect[1]-rect[1]);c.globalAlpha=1;}}
 return {image:texture,rect,update,draw(ctx){if(amount>.01)ctx.drawImage(texture,...rect);},get opening(){return amount;}};
}
