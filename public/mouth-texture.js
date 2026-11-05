// Only a small generated mouth patch changes. Hair, eyes, nose, clothes and
// the original silhouette always come from the user's immutable illustration.
export const MOUTH_PATCH={source:[434,387,156,66],target:[434,387,156,66],anchorY:397};

export function createMouthTexture(original,openImage,canvasFactory){
 const [sx,sy,sw,sh]=MOUTH_PATCH.source,[x,y,w,h]=MOUTH_PATCH.target;
 const rect=[x-5,y-10,w+10,h+20],texture=canvasFactory(rect[2],rect[3]),ctx=texture.getContext('2d');
 let amount=0,roundness=0,last='';
 const restore=()=>{ctx.clearRect(0,0,rect[2],rect[3]);ctx.drawImage(original,...rect,0,0,rect[2],rect[3]);};restore();
 const patch=canvasFactory(w,h),p=patch.getContext('2d');
 p.drawImage(openImage,sx,sy,sw,sh,0,0,w,h);
 // Feather only the patch border, so teeth and mouth cavity remain opaque.
 const mask=canvasFactory(w,h),m=mask.getContext('2d');
 const gx=m.createLinearGradient(0,0,w,0);gx.addColorStop(0,'transparent');gx.addColorStop(.13,'#fff');gx.addColorStop(.87,'#fff');gx.addColorStop(1,'transparent');m.fillStyle=gx;m.fillRect(0,0,w,h);
 m.globalCompositeOperation='destination-in';const gy=m.createLinearGradient(0,0,0,h);gy.addColorStop(0,'transparent');gy.addColorStop(.16,'#fff');gy.addColorStop(.8,'#fff');gy.addColorStop(1,'transparent');m.fillStyle=gy;m.fillRect(0,0,w,h);
 p.globalCompositeOperation='destination-in';p.drawImage(mask,0,0);p.globalCompositeOperation='source-over';
 function update(cue={},delta=1/30,active=true){
  const target=active?Math.max(0,Math.min(1,Number(cue.open)||0)):0;
  const roundTarget=active?Math.max(0,Math.min(1,Number(cue.round)||0)):0;
  amount=active?amount+(target-amount)*(1-Math.exp(-Math.max(0,delta)*35)):0;
  roundness=active?roundness+(roundTarget-roundness)*(1-Math.exp(-Math.max(0,delta)*28)):0;
  if(amount<.025)amount=0;
  const quantized=Math.round(amount*40)/40,rounded=Math.round(roundness*20)/20;
  const key=`${quantized}:${rounded}`;if(key===last)return;last=key;
  restore();
  if(quantized){
   const vertical=.24+quantized*.98+rounded*.15,anchor=MOUTH_PATCH.anchorY;
   ctx.save();ctx.globalAlpha=Math.min(1,quantized/.22);
   ctx.translate(x-rect[0],anchor-rect[1]);ctx.scale(1,vertical);
   // Deform the existing artwork, keeping both feathered edges fixed. Round
   // vowels narrow the center while broad vowels show teeth and a lowered jaw.
   const map=u=>u-rounded*.22*Math.sin((u-.5)*Math.PI*2)/Math.PI;
   for(let col=0;col<w;col+=2){const right=Math.min(w,col+2),left=map(col/w)*w,end=map(right/w)*w;ctx.drawImage(patch,col,0,right-col,h,left,y-anchor,end-left+.3,h);}
   ctx.restore();
  }
 }
 return {image:texture,rect,update,draw(destination){if(amount>0)destination.drawImage(texture,...rect);},get opening(){return amount;}};
}
