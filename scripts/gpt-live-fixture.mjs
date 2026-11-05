export function fakeLiveSocket({text='Hallo allemaal!',onStart=()=>{}}={}){
 const listeners=new Map();let closed=false;
 const emit=data=>queueMicrotask(()=>{for(const fn of listeners.get('message')||[])fn({data:JSON.stringify(data)});});
 return {webSocket:{accept(){},addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},send(raw){const e=JSON.parse(raw);if(e.type==='session.start'){
  onStart(e.session);emit({type:'session.started',session:{id:'live_script_test'}});emit({type:'session.output_transcript.delta',delta:text});
  const voiced=new Int16Array(2400).fill(850),silence=new Int16Array(24000),base64=a=>Buffer.from(a.buffer).toString('base64');
  emit({type:'session.output_audio.delta',delta:base64(voiced)});emit({type:'session.output_audio.delta',delta:base64(silence)});
 }if(e.type==='session.close'&&!closed){closed=true;emit({type:'session.closed'});}},close(){closed=true;}}};
}
