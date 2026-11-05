/**
 * Small source-pixel cutout rig. The face follows one rigid head joint; body,
 * shoulders, forearms and feet use soft, bounded skin weights. No generated
 * geometry, models or WebGL context is needed for the broadcast renderer.
 */
export const RIG_PROFILES = Object.freeze({
  milo: { head:.42, shoulders:.44, hips:.71, mouth:[.45,.30,.12,.065], eyes:[[.36,.245,.10,.048],[.55,.245,.10,.048]], armReach:1 },
  stella: { head:.40, shoulders:.44, hips:.72, mouth:[.45,.32,.11,.055], eyes:[[.36,.255,.10,.045],[.55,.255,.10,.045]], armReach:.8 },
  otto: { head:.45, shoulders:.48, hips:.73, mouth:[.43,.33,.16,.065], eyes:[[.34,.265,.12,.06],[.55,.265,.12,.06]], tentacles:true, armReach:.65 },
  pip: { head:.39, shoulders:.42, hips:.73, mouth:[.44,.29,.13,.06], eyes:[[.34,.23,.11,.05],[.55,.23,.11,.05]], armReach:1 },
  lola: { head:.39, shoulders:.43, hips:.73, mouth:[.45,.30,.12,.055], eyes:[[.34,.24,.12,.045],[.55,.24,.12,.045]], armReach:.8 },
  bella: { head:.30, shoulders:.48, hips:.75, mouth:[.45,.215,.15,.07], eyes:[[.41,.17,.075,.04]], bird:true, armReach:.5 },
  piko: { head:.43, shoulders:.46, hips:.76, mouth:[.46,.32,.09,.065], eyes:[[.32,.25,.15,.07],[.54,.25,.15,.07]], bird:true, armReach:.6 },
  bruno: { head:.39, shoulders:.44, hips:.73, mouth:[.43,.295,.16,.065], eyes:[[.34,.24,.11,.045],[.55,.24,.11,.045]], armReach:.65 },
  nino: { head:.43, shoulders:.47, hips:.74, mouth:[.40,.32,.21,.07], eyes:[[.29,.25,.13,.06],[.57,.25,.13,.06]], armReach:.85 },
  benny: { head:.39, shoulders:.44, hips:.76, mouth:[.43,.30,.15,.065], eyes:[[.34,.235,.11,.055],[.55,.235,.11,.055]], bird:true, armReach:.65 },
  kora: { head:.42, shoulders:.46, hips:.73, mouth:[.43,.335,.15,.06], eyes:[[.34,.27,.11,.05],[.55,.27,.11,.05]], armReach:.8 },
  coco: { head:.39, shoulders:.45, hips:.73, mouth:[.43,.29,.18,.11], eyes:[[.38,.225,.12,.065]], bird:true, armReach:.5 },
});

export const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
export const mix=(a,b,t)=>a+(b-a)*t;
export const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const range=(a,b,x)=>smooth((x-a)/(b-a));
const rotate=(x,y,cx,cy,a)=>{const c=Math.cos(a),s=Math.sin(a);return [cx+(x-cx)*c-(y-cy)*s,cy+(x-cx)*s+(y-cy)*c];};

export function normaliseRigProfile(id, custom={}) {
  const p={...(RIG_PROFILES[id]||RIG_PROFILES.milo),...custom};
  p.head=clamp(Number(p.head)||.4,.18,.6);
  p.shoulders=clamp(Number(p.shoulders)||.44,p.head,.65);
  p.hips=clamp(Number(p.hips)||.73,.46,.89);
  return p;
}

export function poseAt(time=0,motion='idle',energy=1,magicProgress=-1,blend=1) {
  const value=Number(energy),e=Number.isFinite(value)?clamp(value,0,1.8):1,t=Number(time)||0;
  const p={sway:Math.sin(t*.72)*.008,breathe:Math.sin(t*1.7)*.0035,head:Math.sin(t*.67)*.018,headY:Math.sin(t*1.9)*.0015,leftArm:Math.sin(t*.95)*.016,rightArm:-Math.sin(t*.95)*.016,leftLeg:0,rightLeg:0,jump:0};
  const idle={...p};
  if(['wave','welcome'].includes(motion)){p.leftArm=-.31+Math.sin(t*5.4)*.14;p.head=Math.sin(t*1.6)*.025;}
  if(['cheer','celebrate'].includes(motion)){p.leftArm=-.28;p.rightArm=.28;p.jump=Math.abs(Math.sin(t*3.4))*.018;}
  if(['think','listen','look'].includes(motion)){p.head=-.055;p.rightArm=.13;p.sway*=.25;}
  if(motion==='point'){p.rightArm=.23;p.head=-.035;p.leftArm=-.06;}
  if(motion==='speak'){p.rightArm+=Math.sin(t*2.1)*.045;p.headY+=Math.sin(t*2.8)*.002;}
  if(motion==='surprise'){p.leftArm=-.15;p.rightArm=.15;p.head=-.025;p.jump=.008;}
  if(['walk','enter','exit'].includes(motion)){p.leftLeg=Math.sin(t*6)*.1;p.rightLeg=-p.leftLeg;p.leftArm=Math.sin(t*6)*.1;p.rightArm=-p.leftArm;p.jump=Math.abs(Math.sin(t*6))*.005;}
  if(motion==='clap'){const beat=(Math.sin(t*5.8)+1)/2;p.leftArm=.12+beat*.22;p.rightArm=-.12-beat*.22;p.head=Math.sin(t*2.9)*.016;p.breathe+=beat*.003;}
  if(motion==='dance'){p.sway=Math.sin(t*3.3)*.027;p.leftArm=-.17+Math.sin(t*3.3)*.14;p.rightArm=.17+Math.sin(t*3.3)*.14;p.head=-Math.sin(t*3.3)*.035;p.leftLeg=Math.sin(t*3.3)*.065;p.rightLeg=-p.leftLeg;p.jump=Math.abs(Math.sin(t*3.3))*.009;}
  if(motion==='bow'){p.head=.05;p.breathe=-.02;p.leftArm=.05;p.rightArm=-.05;}
  if(magicProgress>=0||motion==='magic'){p.rightArm=.24+Math.sin(t*2.4)*.07;p.leftArm=-.12-Math.sin(t*1.6)*.045;p.head=Math.sin(t*.9)*.03;p.sway=Math.sin(t*.5)*.009;}
  for(const key of Object.keys(p))p[key]=mix(idle[key],p[key],clamp(Number(blend)||0,0,1))*e;
  return p;
}

export function rigPoint(x,y,profile,pose) {
  let px=x,py=y;
  const headWeight=1-range(profile.head-.015,profile.head+.055,y);
  const headPoint=rotate(x,y,.5,profile.head,pose.head);
  px=mix(px,headPoint[0],headWeight);py=mix(py,headPoint[1]+pose.headY,headWeight);
  const lateral=range(.12,.28,Math.abs(x-.5));
  const armWeight=range(profile.shoulders-.025,profile.shoulders+.06,y)*(1-range(profile.hips-.06,profile.hips+.04,y))*lateral;
  if(armWeight>0){const left=x<.5,a=(left?pose.leftArm:pose.rightArm)*(profile.armReach||1);const q=rotate(x,y,left?.30:.70,profile.shoulders,a);px=mix(px,q[0],armWeight);py=mix(py,q[1],armWeight);}
  const legWeight=range(profile.hips-.035,profile.hips+.06,y);
  if(legWeight>0){const left=x<.5,q=rotate(x,y,left?.39:.61,profile.hips,left?pose.leftLeg:pose.rightLeg);px=mix(px,q[0],legWeight);py=mix(py,q[1],legWeight);}
  const body=rotate(px,py,.5,1,pose.sway);
  px=body[0];py=body[1]-(1-y)*pose.breathe-pose.jump;
  if(profile.tentacles&&y>.66){px+=Math.sin(y*21+pose.sway*50)*Math.sin(pose.leftArm*4)*.013*(y-.66);}
  return [px,py];
}

function canvasFactory(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}

export function createCutoutRig(image,{id='milo',talkImage=null,profile:custom={},segmentsX=14,segmentsY=24}={}) {
  const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
  const sampler=canvasFactory(w,h),sc=sampler.getContext('2d',{willReadFrequently:true});sc.drawImage(image,0,0);
  let pixels=null,bounds={x:0,y:0,w,h};
  try{
    pixels=sc.getImageData(0,0,w,h).data;let x0=w,y0=h,x1=0,y1=0;
    for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2)if(pixels[(y*w+x)*4+3]>100){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    if(x1>x0)bounds={x:Math.max(0,x0-2),y:Math.max(0,y0-2),w:Math.min(w-x0,x1-x0+5),h:Math.min(h-y0,y1-y0+5)};
  }catch{}
  let talkBounds=bounds;
  if(talkImage){
    const tw=talkImage.naturalWidth||talkImage.width,th=talkImage.naturalHeight||talkImage.height,tc=canvasFactory(tw,th),tctx=tc.getContext('2d',{willReadFrequently:true});tctx.drawImage(talkImage,0,0);
    try{const data=tctx.getImageData(0,0,tw,th).data;let x0=tw,y0=th,x1=0,y1=0;for(let yy=0;yy<th;yy+=2)for(let xx=0;xx<tw;xx+=2)if(data[(yy*tw+xx)*4+3]>100){x0=Math.min(x0,xx);x1=Math.max(x1,xx);y0=Math.min(y0,yy);y1=Math.max(y1,yy);}if(x1>x0)talkBounds={x:Math.max(0,x0-2),y:Math.max(0,y0-2),w:Math.min(tw-x0,x1-x0+5),h:Math.min(th-y0,y1-y0+5)};}catch{}tc.width=tc.height=1;
  }
  const calibrated={...custom};
  if(custom.mouthROI){
    const toBounds=([x,y,rw,rh])=>[(x*w-bounds.x)/bounds.w,(y*h-bounds.y)/bounds.h,rw*w/bounds.w,rh*h/bounds.h];
    calibrated.mouth=toBounds(custom.mouthROI);
    if(custom.eyes)calibrated.eyes=custom.eyes.map(toBounds);
    if(custom.neckY)calibrated.head=(custom.neckY*h-bounds.y)/bounds.h;
    if(custom.shouldersY)calibrated.shoulders=(custom.shouldersY*h-bounds.y)/bounds.h;
    if(custom.hipsY)calibrated.hips=(custom.hipsY*h-bounds.y)/bounds.h;
  }else{if(custom.shouldersY)calibrated.shoulders=custom.shouldersY;if(custom.hipsY)calibrated.hips=custom.hipsY;}
  const profile=normaliseRigProfile(id,calibrated),sx=segmentsX,sy=segmentsY,points=[],triangles=[];
  for(let y=0;y<=sy;y++)for(let x=0;x<=sx;x++)points.push([x/sx,y/sy]);
  const occupied=(x,y)=>{if(!pixels)return true;const ix=clamp(Math.round(bounds.x+x*bounds.w),0,w-1),iy=clamp(Math.round(bounds.y+y*bounds.h),0,h-1);return pixels[(iy*w+ix)*4+3]>4;};
  for(let y=0;y<sy;y++)for(let x=0;x<sx;x++){
    if(!occupied((x+.5)/sx,(y+.5)/sy)&&!occupied(x/sx,y/sy)&&!occupied((x+1)/sx,(y+1)/sy)&&!occupied((x+1)/sx,y/sy)&&!occupied(x/sx,(y+1)/sy))continue;
    const a=y*(sx+1)+x,b=a+1,c=a+sx+1,d=c+1;triangles.push([a,b,c],[b,d,c]);
  }
  const patch=profile.mouth;
  let talkingPatch=null;
  if(talkImage&&patch){
    const [nx,ny,nw,nh]=patch,tw=talkImage.naturalWidth||talkImage.width,th=talkImage.naturalHeight||talkImage.height;
    const source=custom.talkMouthROI?custom.talkMouthROI.map((n,i)=>n*(i%2?th:tw)):[talkBounds.x+nx*talkBounds.w,talkBounds.y+ny*talkBounds.h,nw*talkBounds.w,nh*talkBounds.h];
    const pw=Math.max(32,Math.min(384,Math.round(source[2]))),ph=Math.max(24,Math.min(256,Math.round(source[3])));
    talkingPatch=canvasFactory(pw,ph);const pctx=talkingPatch.getContext('2d');pctx.drawImage(talkImage,...source,0,0,pw,ph);
    pctx.globalCompositeOperation='destination-in';pctx.translate(pw/2,ph/2);pctx.scale(pw/2,ph/2);const mask=pctx.createRadialGradient(0,0,.72,0,0,1);mask.addColorStop(0,'rgba(0,0,0,1)');mask.addColorStop(1,'rgba(0,0,0,0)');pctx.fillStyle=mask;pctx.fillRect(-1,-1,2,2);
  }
  const lidColors=(profile.eyes||[]).map(r=>{
    if(!pixels)return '#9c755c';const x=clamp(Math.floor(bounds.x+(r[0]+r[2]/2)*bounds.w),0,w-1),y=clamp(Math.floor(bounds.y+(r[1]-.012)*bounds.h),0,h-1),i=(y*w+x)*4;
    return `rgb(${pixels[i]},${pixels[i+1]},${pixels[i+2]})`;
  });
  sampler.width=sampler.height=1;pixels=null;
  const projected=new Float32Array(points.length*2);
  function draw(ctx,{x,y,height=500,time=0,motion='idle',energy=1,speaking=false,mouth=0,blink=0,magicProgress=-1,alpha=1,motionBlend=1}={}) {
    const width=height*bounds.w/bounds.h,pose=poseAt(time,motion,energy,magicProgress,motionBlend);
    for(let i=0;i<points.length;i++){const q=rigPoint(points[i][0],points[i][1],profile,pose);projected[i*2]=x+(q[0]-.5)*width;projected[i*2+1]=y-height+q[1]*height;}
    ctx.save();ctx.globalAlpha*=alpha;ctx.imageSmoothingEnabled=true;
    for(const t of triangles){
      const A=points[t[0]],B=points[t[1]],C=points[t[2]],ax=projected[t[0]*2],ay=projected[t[0]*2+1],bx=projected[t[1]*2],by=projected[t[1]*2+1],cx=projected[t[2]*2],cy=projected[t[2]*2+1];
      const ux=(B[0]-A[0])*bounds.w,uy=(B[1]-A[1])*bounds.h,vx=(C[0]-A[0])*bounds.w,vy=(C[1]-A[1])*bounds.h,det=ux*vy-uy*vx;
      if(Math.abs(det)<.001)continue;
      const a=((bx-ax)*vy-(cx-ax)*uy)/det,b=((by-ay)*vy-(cy-ay)*uy)/det,c=((cx-ax)*ux-(bx-ax)*vx)/det,d=((cy-ay)*ux-(by-ay)*vx)/det;
      const srcX=bounds.x+A[0]*bounds.w,srcY=bounds.y+A[1]*bounds.h;
      const pad=.65,mx=(ax+bx+cx)/3,my=(ay+by+cy)/3;
      ctx.save();ctx.beginPath();for(const [j,tx,ty] of [[0,ax,ay],[1,bx,by],[2,cx,cy]]){const len=Math.hypot(tx-mx,ty-my)||1,xx=tx+(tx-mx)/len*pad,yy=ty+(ty-my)/len*pad;if(j===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);}ctx.closePath();ctx.clip();ctx.transform(a,b,c,d,ax-a*srcX-c*srcY,ay-b*srcX-d*srcY);
      const rx=Math.max(0,Math.floor(bounds.x+Math.min(A[0],B[0],C[0])*bounds.w)-2),ry=Math.max(0,Math.floor(bounds.y+Math.min(A[1],B[1],C[1])*bounds.h)-2),rw=Math.min(w-rx,Math.ceil(bounds.w/sx)+5),rh=Math.min(h-ry,Math.ceil(bounds.h/sy)+5);
      ctx.drawImage(image,rx,ry,rw,rh,rx,ry,rw,rh);ctx.restore();
    }
    // Talking frame is sampled only inside the mouth ROI. The rest of the
    // original face stays unchanged, including eyes, fur and clothing.
    if(talkImage&&speaking&&mouth>.015&&patch){
      const [nx,ny,nw,nh]=patch,q=rigPoint(nx+nw/2,ny+nh/2,profile,pose),dw=nw*width,dh=nh*height;
      ctx.save();ctx.translate(x+(q[0]-.5)*width,y-height+q[1]*height);ctx.rotate(pose.head+pose.sway);ctx.globalAlpha*=clamp(mouth*1.6,0,1);
      // Frame pairs may have slightly different transparent padding. Mapping
      // through each frame's alpha bounds keeps the mouth registered to the face.
      if(talkingPatch)ctx.drawImage(talkingPatch,-dw/2,-dh/2,dw,dh);ctx.restore();
    }
    if(blink>.04)(profile.eyes||[]).forEach((r,i)=>{
      const [nx,ny,nw,nh]=r,q=rigPoint(nx+nw/2,ny+nh/2,profile,pose),dw=nw*width,dh=nh*height;
      ctx.save();ctx.translate(x+(q[0]-.5)*width,y-height+q[1]*height);ctx.rotate(pose.head+pose.sway);ctx.beginPath();ctx.ellipse(0,0,dw/2,dh/2,0,0,Math.PI*2);ctx.clip();ctx.globalAlpha*=blink;ctx.fillStyle=lidColors[i];ctx.fillRect(-dw/2,-dh/2,dw,dh);ctx.strokeStyle='rgba(45,25,28,.6)';ctx.lineWidth=Math.max(1,height*.0017);ctx.beginPath();ctx.ellipse(0,-dh*.12,dw*.43,dh*.22,0,0,Math.PI);ctx.stroke();ctx.restore();
    });
    ctx.restore();
    const wrist=rigPoint(.81,.60,profile,pose);
    return {wrist:{x:x+(wrist[0]-.5)*width,y:y-height+wrist[1]*height},bounds,width,height,triangles:triangles.length};
  }
  return {draw,bounds,profile,stats:{triangles:triangles.length,vertices:points.length},dispose(){if(talkingPatch){talkingPatch.width=talkingPatch.height=1;talkingPatch=null;}}};
}
