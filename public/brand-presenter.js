// Continuous source-art deformation. No body part is removed or independently hidden.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
const profiles={
 rocco:{neck:[548,386],headBottom:413,armsY:420,armBottom:800,mouth:[455,255,182,110]},
 milo:{neck:[540,472],headBottom:495,armsY:495,armBottom:835,mouth:[488,358,137,76]}
};
export function createBrandPresenter(image,{brandId,mouthImage,canvasFactory}={}){
 const profile=profiles[brandId]||profiles.rocco,w=image.width,h=image.height,make=canvasFactory||((w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h}));
 const frame=make(w,h),f=frame.getContext('2d'),mouth=make(w,h),mc=mouth.getContext('2d');
 if(mouthImage){const [x,y,mw,mh]=profile.mouth;mc.drawImage(mouthImage,0,0,w,h);mc.save();mc.globalCompositeOperation='destination-in';mc.translate(x+mw/2,y+mh/2);mc.scale(mw/2,mh/2);const mask=mc.createRadialGradient(0,0,.67,0,0,1);mask.addColorStop(0,'#fff');mask.addColorStop(1,'#fff0');mc.fillStyle=mask;mc.fillRect(-w/mw*2,-h/mh*2,w/mw*4,h/mh*4);mc.restore();}
 const cols=12,rows=18,vertices=[],triangles=[];let clock=0,lastState={},disposed=false;
 // Occupancy ignores transparent pixels once; all actual artwork remains continuous.
 f.drawImage(image,0,0,w,h);let alpha;try{alpha=f.getImageData(0,0,w,h).data;}catch{}
 for(let row=0;row<=rows;row++)for(let col=0;col<=cols;col++)vertices.push({x:col*w/cols,y:row*h/rows});
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
  const x=col*w/cols,y=row*h/rows,cw=w/cols,ch=h/rows;let visible=!alpha;
  if(alpha)for(let yy=Math.max(0,Math.floor(y)-2);yy<Math.min(h,y+ch+2)&&!visible;yy+=3)for(let xx=Math.max(0,Math.floor(x)-2);xx<Math.min(w,x+cw+2);xx+=3)if(alpha[(yy*w+xx)*4+3]>4){visible=true;break;}
  if(!visible)continue;const a=row*(cols+1)+col,b=a+1,c=a+cols+1,d=c+1;
  triangles.push([a,c,b],[b,c,d]);
 }
 function pose(p,state){
  let x=p.x,y=p.y;const energy=clamp((state.energy??65)/100),idle=state.idle!==false&&!state.show?.reducedMotion,t=clock,age=(state.age??0)/1000,motion=state.motion||'idle';
  const breath=idle?Math.sin(t*1.5)*2.1:0,move=idle?Math.sin(t*.8)*1.5:0;
  const envelope=Math.sin(clamp(age/3.8)*Math.PI),gesture=['welcome','wave','point','cheer','bow','think','look'].includes(motion)?envelope*energy:0;
  const head=1-smooth((y-(profile.headBottom-70))/115),angle=(idle?Math.sin(t*.7)*.009:0)+(motion==='think'?.045:motion==='look'?-.045:motion==='bow'?.065:0)*gesture;
  const nx=profile.neck[0],ny=profile.neck[1],dx=x-nx,dy=y-ny;
  x+=(dx*Math.cos(angle)-dy*Math.sin(angle)-dx)*head;y+=(dx*Math.sin(angle)+dy*Math.cos(angle)-dy)*head;
  const side=p.x<512?-1:1,lateral=smooth((Math.abs(p.x-545)-100)/135),vertical=smooth((p.y-profile.armsY)/80)*(1-smooth((p.y-profile.armBottom)/75)),arm=lateral*vertical;
  const wave=motion==='wave'&&side>0?Math.sin(age*8)*14:0,lift=motion==='cheer'?36:motion==='point'&&side>0?25:motion==='welcome'?14:0;
  x+=side*arm*gesture*(motion==='cheer'?13:8);y-=arm*gesture*(lift+wave);
  const above=clamp((h-y)/h);x+=move*above;y-=breath*above;
  if(motion==='bow')y+=gesture*9*above;
  return {x,y};
 }
 function draw(ctx,{x,y,height},state={},delta=1/30){
  if(disposed)return;if(!state.stopped){clock=state.time??clock+delta;lastState=state;}else state=lastState;
  const open=state.speaking?clamp(state.mouth?.open??.3):0;
  const points=vertices.map(p=>pose(p,state)),scale=height/(h-24);ctx.save();ctx.translate(x-w/2*scale,y-(h-15)*scale);ctx.scale(scale,scale);
  for(const [ai,bi,ci] of triangles){const a=vertices[ai],b=vertices[bi],c=vertices[ci],A=points[ai],B=points[bi],C=points[ci],den=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y),m11=((B.x-A.x)*(c.y-a.y)-(C.x-A.x)*(b.y-a.y))/den,m12=((B.y-A.y)*(c.y-a.y)-(C.y-A.y)*(b.y-a.y))/den,m21=((C.x-A.x)*(b.x-a.x)-(B.x-A.x)*(c.x-a.x))/den,m22=((C.y-A.y)*(b.x-a.x)-(B.y-A.y)*(c.x-a.x))/den;
   const cx=(A.x+B.x+C.x)/3,cy=(A.y+B.y+C.y)/3,expand=p=>{const dx=p.x-cx,dy=p.y-cy,k=1+.55/Math.max(1,Math.hypot(dx,dy));return [cx+dx*k,cy+dy*k];};ctx.save();ctx.beginPath();ctx.moveTo(...expand(A));ctx.lineTo(...expand(B));ctx.lineTo(...expand(C));ctx.closePath();ctx.clip();ctx.transform(m11,m12,m21,m22,A.x-m11*a.x-m21*a.y,A.y-m12*a.x-m22*a.y);const minx=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))-3),miny=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))-3),sw=Math.min(w-minx,Math.ceil(Math.max(a.x,b.x,c.x))-minx+3),sh=Math.min(h-miny,Math.ceil(Math.max(a.y,b.y,c.y))-miny+3);ctx.drawImage(image,minx,miny,sw,sh,minx,miny,sw,sh);const [mx,my,mw,mh]=profile.mouth;if(open>.05&&mouthImage&&minx<mx+mw&&minx+sw>mx&&miny<my+mh&&miny+sh>my){ctx.globalAlpha=smooth(open*2.4);ctx.drawImage(mouth,minx,miny,sw,sh,minx,miny,sw,sh);}ctx.restore();
  }
  ctx.restore();return {drawnTriangles:triangles.length};
 }
 return {draw,dispose(){disposed=true;frame.width=mouth.width=1;},stats:{drawnTriangles:triangles.length},height:2.7};
}
