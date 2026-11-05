import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {LiveChat} from '../public/live-chat.js';

const testCases=[];
const test=(name,run)=>testCases.push({name,run});
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const self=(changes={})=>({memberId:'member-1',role:'player',canSend:true,mutedUntil:0,reason:'',profiles:[{id:'p1',name:'Noor'},{id:'p2',name:'Sam'}],...changes});
const message=(changes={})=>({id:'m1',seq:1,memberId:'member-1',profileId:'p1',name:'Noor',role:'player',text:'Hoi Vlampie!',at:Date.now(),deleted:false,...changes});
const snapshot=(changes={})=>({messages:[],cursor:0,self:self(),serverTime:Date.now(),...changes});
class FakeEventSource{
 static instances=[];
 constructor(url){this.url=url;this.listeners=new Map();this.closed=false;FakeEventSource.instances.push(this);}
 addEventListener(name,callback){this.listeners.set(name,callback);}
 emit(name,data){this.listeners.get(name)?.({data:JSON.stringify(data)});}
 close(){this.closed=true;}
}
function fixture(fetcher,{hostView=false}={}){
 const {window}=parseHTML('<main><section id="chat"></section></main>');
 Object.assign(globalThis,{window,document:window.document,fetch:fetcher,EventSource:FakeEventSource});
 FakeEventSource.instances=[];return new LiveChat({root:document.getElementById('chat'),hostView});
}

test('Profiles switch identity without leaking ages; same game does not reconnect',async()=>{
 let calls=0;const chat=fixture(async()=>{calls++;return response(snapshot({self:self({profiles:[{id:'p1',name:'Noor',age:8},{id:'p2',name:'Sam',age:10}]})}));});
 try{await chat.setGame('show-a');assert.equal(chat.refs.profile.hidden,false);assert.equal(chat.selectedProfile,'p1');chat.selectedProfile='p2';chat.updateIdentity();assert.equal(chat.refs.profile.value,'p2');await chat.setGame('show-a');assert.equal(calls,1);assert.equal(chat.selectedProfile,'p2');assert.doesNotMatch(chat.root.textContent,/jaar/);}
 finally{chat.dispose();}
});

test('User content is plaintext, host identity is server-role based, and moderator can delete own message',async()=>{
 const unsafe='<img src=x onerror=alert(1)><script>bad()</script>';
 const chat=fixture(async()=>response(snapshot({messages:[message({text:unsafe,name:'<b>Noor</b>'}),message({id:'m2',seq:2,role:'host',name:'Not the host display name',memberId:'host'})],cursor:2,self:self({role:'moderator'})})),{hostView:true});
 try{await chat.setGame('show-a');assert.equal(chat.refs.messages.querySelectorAll('img,script,b').length,0);assert.ok(chat.refs.messages.textContent.includes(unsafe));assert.equal(chat.nodes.get('m2').querySelector('.lc-message-name').textContent,'Host');assert.equal(chat.canVlampie(),false);assert.equal(chat.canModerate(message({role:'moderator'})),true);assert.equal(chat.canModerate(message({role:'moderator',memberId:'other'})),false);}
 finally{chat.dispose();}
});

test('Sending retains the draft until acknowledgement and uses the selected player profile',async()=>{
 const pending=deferred();let sent;const chat=fixture(async(url,options)=>{if(options.method==='POST'){sent=JSON.parse(options.body);return pending.promise;}return response(snapshot());});
 try{await chat.setGame('show-a');chat.selectedProfile='p2';chat.refs.input.value='Een bericht van Sam';chat.updateComposer();const sending=chat.send();assert.equal(chat.refs.input.value,'Een bericht van Sam');assert.equal(chat.sending,true);assert.equal(sent.profileId,'p2');pending.resolve(response({message:message({text:sent.text,profileId:'p2',name:'Sam'})},201));await sending;assert.equal(chat.refs.input.value,'');assert.equal(chat.sending,false);assert.equal(chat.messages.size,1);}
 finally{chat.dispose();}
});

test('A lost send response is retried with one stable request ID',async()=>{
 const ids=[];const chat=fixture(async(url,options)=>{if(options.method==='POST'){const data=JSON.parse(options.body);ids.push(data.requestId);if(ids.length===1)throw new TypeError('Connection interrupted');return response({message:message({text:data.text})},201);}return response(snapshot());});
 try{await chat.setGame('show-a');chat.refs.input.value='Precies eenmaal';chat.updateComposer();await chat.send();assert.equal(ids.length,2);assert.equal(new Set(ids).size,1);assert.equal(chat.refs.input.value,'');assert.equal(chat.messages.size,1);}
 finally{chat.dispose();}
});

test('An old game response cannot overwrite a newly selected game',async()=>{
 const old=deferred();const chat=fixture(async url=>url.includes('show-old')?old.promise:response(snapshot({messages:[message({id:'new',text:'Nieuwe show'})],cursor:1})));
 try{const first=chat.setGame('show-old');await chat.setGame('show-new');old.resolve(response(snapshot({messages:[message({id:'old',text:'Oude show'})],cursor:1})));await first;assert.equal(chat.gameId,'show-new');assert.equal(chat.messages.has('new'),true);assert.equal(chat.messages.has('old'),false);assert.equal(chat.refs.messages.textContent.includes('Oude show'),false);}
 finally{chat.dispose();}
});

test('A late POST acknowledgement never restores a deleted message',async()=>{
 const pending=deferred(),posted=message();const chat=fixture(async(url,options)=>options.method==='POST'?pending.promise:response(snapshot()));
 try{await chat.setGame('show-a');chat.refs.input.value=posted.text;chat.updateComposer();const sending=chat.send();chat.apply({events:[{seq:1,type:'message',message:posted},{seq:2,type:'delete',messageId:posted.id}],cursor:2,serverTime:Date.now(),self:self()});assert.equal(chat.messages.get(posted.id).deleted,true);pending.resolve(response({message:posted},201));await sending;assert.equal(chat.messages.get(posted.id).deleted,true);assert.equal(chat.messages.get(posted.id).text,'');assert.equal(chat.refs.messages.textContent.includes(posted.text),false);assert.equal(chat.cursor,2);}
 finally{chat.dispose();}
});

test('Out-of-order acknowledgements are displayed in event order, without duplicates',async()=>{
 const chat=fixture(async()=>response(snapshot()));
 try{await chat.setGame('show-a');chat.setMessage(message({id:'m3',seq:3}));chat.renderMessages();chat.apply({events:[1,2,3].map(seq=>({seq,type:'message',message:message({id:`m${seq}`,seq})})),cursor:3,serverTime:Date.now()});assert.deepEqual([...chat.refs.messages.children].map(node=>node.dataset.messageId),['m1','m2','m3']);chat.apply({events:[{seq:3,type:'message',message:message({id:'m3',seq:3})}],cursor:3,serverTime:Date.now()});assert.equal(chat.refs.messages.children.length,3);}
 finally{chat.dispose();}
});

test('Stale polling cannot undo a newer mute or role change',async()=>{
 const chat=fixture(async()=>response(snapshot()));
 try{await chat.setGame('show-a');const now=Date.now();chat.apply({events:[{seq:2,type:'member',member:{memberId:'member-1',role:'player',mutedUntil:now+60000}}],cursor:2,self:self({canSend:false,mutedUntil:now+60000}),serverTime:now+20});chat.apply({events:[],cursor:1,self:self({role:'moderator',canSend:true}),serverTime:now});assert.equal(chat.self.role,'player');assert.equal(chat.self.canSend,false);assert.equal(chat.refs.input.disabled,true);chat.apply({events:[],cursor:2,self:self({canSend:true}),serverTime:now});assert.equal(chat.self.canSend,false);}
 finally{chat.dispose();}
});

test('SSE access revocation disables sending and invalidates in-flight responses',async()=>{
 const pending=deferred();let poll=false;const chat=fixture(async()=>poll?pending.promise:response(snapshot()));
 try{await chat.setGame('show-a');poll=true;const polling=chat.poll();const source=FakeEventSource.instances[0];source.emit('chat-error',{error:{code:'forbidden',message:'Je toegang is ingetrokken.'}});assert.equal(chat.refs.input.disabled,true);assert.equal(source.closed,true);assert.equal(chat.self,null);pending.resolve(response({events:[],cursor:0,self:self(),serverTime:Date.now()}));await polling;assert.equal(chat.self,null);assert.equal(chat.refs.input.disabled,true);assert.ok(chat.refs.notice.textContent.includes('ingetrokken'));}
 finally{chat.dispose();}
});

test('Empty selection and disposal abort work and never pretend to be connected',async()=>{
 let calls=0;const chat=fixture(async()=>{calls++;return response(snapshot());});
 await chat.setGame('');assert.equal(calls,0);assert.notEqual(chat.refs.status.textContent,'Live');await chat.setGame('show-a');const source=FakeEventSource.instances[0];chat.dispose();assert.equal(source.closed,true);assert.equal(chat.controller.signal.aborted,true);assert.equal(chat.refs.input.disabled,true);assert.equal(chat.pollTimer,null);
});

test('A transient initial failure reconnects automatically without losing the composer draft',async()=>{
 let calls=0;const chat=fixture(async()=>{calls++;if(calls===1)throw new TypeError('Offline');return response(snapshot());});
 try{await chat.setGame('show-a');chat.refs.input.value='Mijn bericht blijft staan';assert.equal(chat.initialized,false);assert.ok(chat.initialRetryTimer);await new Promise(resolve=>setTimeout(resolve,2100));assert.equal(calls,2);assert.equal(chat.initialized,true);assert.equal(chat.refs.status.textContent,'Live');assert.equal(chat.refs.input.value,'Mijn bericht blijft staan');}
 finally{chat.dispose();}
});

test('A transient SSE error falls back to polling and preserves the draft',async()=>{
 const chat=fixture(async url=>response(url.includes('?after=')?{events:[],cursor:0,self:self(),serverTime:Date.now()}:snapshot()));
 try{await chat.setGame('show-a');chat.refs.input.value='Tot zo';FakeEventSource.instances[0].emit('chat-error',{error:{code:'unavailable',message:'Tijdelijk onderbroken'}});assert.equal(chat.terminalError,false);assert.equal(chat.pollActive,true);await chat.poll();assert.equal(chat.refs.status.textContent,'Live');assert.equal(chat.refs.input.value,'Tot zo');assert.equal(chat.self.canSend,true);}
 finally{chat.dispose();}
});

test('Emoji count uses the same 500 Unicode codepoint limit as the server',async()=>{
 const chat=fixture(async()=>response(snapshot()));
 try{await chat.setGame('show-a');chat.refs.input.value='🥳'.repeat(500);chat.updateComposer();assert.equal(chat.refs.count.textContent,'500 / 500');assert.equal(chat.refs.send.disabled,false);chat.refs.input.value+='a';chat.updateComposer();assert.equal(chat.refs.send.disabled,true);}
 finally{chat.dispose();}
});

let passed=0;for(const {name,run}of testCases){try{await run();console.log(`✓ ${name}`);passed++;}catch(error){console.error(`✗ ${name}`);throw error;}}
console.log(`${passed}/${testCases.length} chat client checks passed.`);
