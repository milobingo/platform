// A small, frame-rate-independent envelope for the presenter bus only. Caller,
// background music and jingles must never be supplied as this meter's input.
export function presenterMouthTarget(level,{speaking=false,enabled=true}={}){
 if(!speaking||!enabled||!Number.isFinite(level)||level<=.012)return 0;
 return Math.min(.98,Math.pow(Math.max(0,level-.012)*2.7,.72));
}
export class PresenterMouthEnvelope{
 constructor(){this.value=0;}
 read(level,{speaking=false,enabled=true,delta=1/60}={}){
  const target=presenterMouthTarget(level,{speaking,enabled}),seconds=target>this.value ? .035 : .085,dt=Math.max(0,Math.min(.1,Number(delta)||0));
  this.value+=(target-this.value)*(1-Math.exp(-dt/seconds));if(this.value<.005)this.value=0;return this.value;
 }
}
