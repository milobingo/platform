let nextId=0;
export class Track {
 constructor(id='track-'+(++nextId),kind='audio'){this.id=id;this.kind=kind;this.readyState='live';this.enabled=true;}
 stop(){this.readyState='ended';}
 clone(){return new Track(this.id+'-clone',this.kind);}
}
export class Stream {
 constructor(tracks=[]){this.tracks=tracks;this.id='stream-'+(++nextId);}
 getTracks(){return this.tracks;}
 getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}
 getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}
}
class Node {
 constructor(context,type){this.context=context;this.type=type;this.edges=new Set();this.gain={value:1,setTargetAtTime(v){this.value=v;},cancelScheduledValues(){}};context.nodes.push(this);}
 connect(node){this.edges.add(node);return node;}
 disconnect(){this.edges.clear();}
 getByteTimeDomainData(bytes){bytes.fill(this.sample??128);}
}
export class Context {
 constructor(){this.nodes=[];this.state='running';this.currentTime=0;this.destination=new Node(this,'speakers');}
 createGain(){return new Node(this,'gain');}
 createAnalyser(){const n=new Node(this,'analyser');n.fftSize=256;return n;}
 createMediaStreamDestination(){const n=new Node(this,'mediaDestination');n.stream=new Stream([new Track()]);return n;}
 createMediaStreamSource(stream){const n=new Node(this,'mediaSource');n.stream=stream;return n;}
 async resume(){this.state='running';}
 async close(){this.state='closed';}
}
export function reaches(from,to,seen=new Set()){
 if(!from||seen.has(from)||from.type==='gain'&&from.gain.value===0)return false;
 if(from===to)return true;seen.add(from);return [...from.edges].some(node=>reaches(node,to,seen));
}
export const call=(id='call-a',name='Sophie')=>({id,transport:'livekit',gameId:'game-1',characterId:'milo',characterName:'Milo Magico',name,phase:'live',guestIdentity:'guest-'+id,outputIdentity:'output-'+id,context:{callName:name,confirmedFacts:[]},media:{player:{connected:true,audioReady:true}}});
