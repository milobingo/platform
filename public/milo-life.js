// Presentation only: deterministic attention and blinks never make game choices.
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=t=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10);};
const hash=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
const finite=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const blinkPulse=t=>t<0||t>.205?0:t<.065?ease(t/.065):t<.085?1:1-ease((t-.085)/.12);

export function miloBlinkAt(time=0){
 const t=Math.max(0,finite(time)),slot=Math.floor(t/6.8);let blink=0;
 for(let i=Math.max(0,slot-1);i<=slot;i++){
  const start=i*6.8,first=start+.8+hash(i*3)*1.7,second=start+4.15+hash(i*3+1)*.65;
  blink=Math.max(blink,blinkPulse(t-first),blinkPulse(t-second));
  if(hash(i*3+2)<.28)blink=Math.max(blink,blinkPulse(t-second-.29)*.87);
 }
 return blink;
}

export function miloAttentionAt({speaking=false,listening=false,speakerSide=0,guestSide=0,numberAge=-1}={}){
 let attentionX=0,attentionY=0,expression=speaking?'warm':listening?'listening':'neutral';
 if(!speaking&&finite(speakerSide)!==0){attentionX=clamp(finite(speakerSide),-1,1)*.68;expression='listening';}
 else if(!speaking&&finite(guestSide)!==0){attentionX=clamp(finite(guestSide),-1,1)*.48;expression='curious';}
 const age=finite(numberAge,-1);
 if(!speaking&&!listening&&age>=0&&age<2.8){
  const glance=ease(age/.45)*(1-ease((age-1.25)/1.05));
  attentionY=.65*glance;attentionX*=1-glance;expression=glance>.15?'curious':expression;
 }
 return {attentionX,attentionY,expression};
}
