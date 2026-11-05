import {bt} from './brand-ui.js?v=37';
const EMOJI = ['😀','🥳','🤩','😍','😂','👏','🙌','👍','❤️','🔥','🎉','🎁','⭐','🍀','🎯','🏆','🎄','🍪','👋','💃'];
const ROLES = {host:'Host', moderator:'Moderator', player:'Speler'};
const MUTE_OPTIONS = [[60,'1 minuut'],[300,'5 minuten'],[900,'15 minuten'],[3600,'1 uur'],[86400,'24 uur']];
const uuid = () => globalThis.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const el = (tag, className, text) => { const node=document.createElement(tag); if(className)node.className=className;if(text!==undefined)node.textContent=text;return node; };
const button = (text, action, className='lc-button') => {const node=el('button',className,text);node.type='button';if(action)node.dataset.action=action;return node;};
const timeLabel = at => {const date=new Date(at);return Number.isNaN(date.getTime())?'':date.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});};
const wait = (ms,signal) => new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new DOMException('Aborted','AbortError'));const done=()=>{signal?.removeEventListener('abort',abort);resolve();};const timer=setTimeout(done,ms);const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};signal?.addEventListener('abort',abort,{once:true});});

/** Shared host/player chat. All author identity and permissions come from the server. */
export class LiveChat {
 constructor({root,onVlampie=()=>{},hostView=false,compact=false,fetcher,streaming=true,simulated=false}={}) {
  this.root=typeof root==='string'?document.querySelector(root):root;
  if(!this.root)throw new Error('LiveChat heeft een container nodig.');
  this.onVlampie=onVlampie;this.hostView=hostView;this.compact=!!compact;this.fetcher=fetcher||((...args)=>fetch(...args));this.streaming=streaming!==false;this.simulated=!!simulated;this.gameId='';this.epoch=0;this.cursor=0;this.messages=new Map();this.deletedIds=new Set();this.members=new Map();this.nodes=new Map();this.self=null;this.selectedProfile='';this.disposed=false;this.sending=false;this.unread=0;this.pendingDraft=null;this.readyPromise=Promise.resolve();this.listenerController=new AbortController();this.serverOffset=0;this.selfVersion={cursor:-1,time:0};
  this.mount();this.brandListener=()=>{this.updateComposer?.();this.renderMessages?.();};document.addEventListener('show-brand-changed',this.brandListener);
 }
 mount(){
  this.root.classList.add('live-chat');this.root.dataset.chatState='empty';
  this.root.innerHTML=`<header class="lc-header"><div class="lc-heading"><span class="lc-eyebrow">SAMEN IN DE SHOW</span><h2>${this.simulated?'Demochat':'Live chat'} <span class="lc-status" data-ref="status" role="status">Kies een spel</span></h2></div><button type="button" class="lc-icon-button lc-manage" data-action="members" title="Chat beheren" aria-label="Chat beheren" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6m8 4v6"/></svg></button></header><div class="lc-body"><div class="lc-messages" data-ref="messages" role="log" aria-label="Berichten in de showchat" aria-live="off" tabindex="0"></div><div class="lc-empty" data-ref="empty"><span class="lc-empty-icon" aria-hidden="true">✦</span><strong data-ref="emptyTitle">De show begint samen</strong><p data-ref="emptyText">Kies een spel om de chat te openen.</p><button type="button" class="lc-button" data-action="retry" data-ref="retry" hidden>Opnieuw verbinden</button></div><button type="button" class="lc-new-messages" data-action="latest" data-ref="latest" hidden></button></div><div class="lc-notice" data-ref="notice" role="status" hidden></div><form class="lc-composer" data-ref="form"><div class="lc-compose-meta"><label class="lc-person-label" data-ref="personLabel"><span>Je reageert als</span><select data-ref="profile" aria-label="Kies wie reageert" hidden></select><strong data-ref="identity">—</strong></label><span class="lc-char-count" data-ref="count">0 / 500</span></div><div class="lc-input-wrap"><textarea data-ref="input" rows="2" maxlength="500" placeholder="Typ een bericht of vraag met @${bt("Vlampie")}…" aria-label="Je chatbericht" disabled></textarea></div><div class="lc-compose-footer"><button type="button" class="lc-emoji-button" data-action="emoji" data-ref="emojiButton" aria-label="Emoji toevoegen" aria-expanded="false" disabled><span aria-hidden="true">☺</span><span>Emoji</span></button><span class="lc-compose-hint" data-ref="hint">Enter om te verzenden</span><button type="submit" class="lc-send" data-ref="send" disabled><span data-ref="sendLabel">Verstuur</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Z M7 12h14"/></svg></button></div><div class="lc-emoji-picker" data-ref="emoji" role="group" aria-label="Kies een emoji" hidden></div></form><section class="lc-overlay" data-ref="overlay" role="dialog" aria-modal="false" aria-label="Chat beheren" hidden><header><div><span class="lc-eyebrow">CHATBEHEER</span><h3 data-ref="overlayTitle">Deelnemers</h3></div><button type="button" class="lc-icon-button" data-action="close-overlay" aria-label="Chatbeheer sluiten">×</button></header><div class="lc-overlay-content" data-ref="overlayContent"></div></section><span class="lc-sr-only" data-ref="announcer" aria-live="polite" aria-atomic="true"></span>`;
  this.refs=Object.fromEntries([...this.root.querySelectorAll('[data-ref]')].map(node=>[node.dataset.ref,node]));
  this.refs.input.rows=this.compact?1:2;
  this.manageButton=this.root.querySelector('.lc-manage');
  for(const emoji of EMOJI){const node=button(emoji,'insert-emoji','lc-emoji-option');node.dataset.emoji=emoji;node.setAttribute('aria-label',`Emoji ${emoji}`);this.refs.emoji.append(node);}
  const signal=this.listenerController.signal;
  this.root.addEventListener('click',event=>this.click(event),{signal});
  this.refs.form.addEventListener('submit',event=>{event.preventDefault();void this.send();},{signal});
  this.refs.input.addEventListener('input',()=>this.updateComposer(),{signal});
  this.refs.input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void this.send();}if(event.key==='Escape'&&!this.refs.emoji.hidden){event.preventDefault();event.stopPropagation();this.toggleEmoji(false);}},{signal});
  this.refs.profile.addEventListener('change',()=>{this.selectedProfile=this.refs.profile.value;this.pendingDraft=null;this.updateComposer();},{signal});
  this.refs.messages.addEventListener('scroll',()=>{if(this.nearBottom())this.clearUnread();},{signal,passive:true});
  this.root.addEventListener('keydown',event=>{if(event.key==='Escape'&&(!this.refs.emoji.hidden||!this.refs.overlay.hidden)){event.preventDefault();event.stopPropagation();this.toggleEmoji(false);this.closeOverlay();}},{signal});
  this.refs.input.maxLength=1000;
  if(typeof window!=='undefined')window.addEventListener('online',()=>{if(this.gameId&&!this.disposed&&!this.terminalError){if(!this.initialized)void this.initialLoad(this.epoch);else{this.beginPolling();this.scheduleStream(0);}}},{signal});
 }
 setGame(gameId,{profiles}={}){
  if(this.disposed)return Promise.resolve();
  const id=String(gameId||'');
  if(id===this.gameId){if(profiles&&this.self){this.self={...this.self,profiles};this.updateIdentity();}return this.readyPromise;}
  this.stopTransport();this.gameId=id;this.epoch++;this.cursor=0;this.messages.clear();this.deletedIds.clear();this.members.clear();this.nodes.clear();this.self=null;this.sending=false;this.pendingDraft=null;this.selectedProfile='';this.unread=0;this.lastSync=0;this.failures=0;this.serverOffset=0;this.selfVersion={cursor:-1,time:0};this.initialFailures=0;this.initialBusy=false;this.terminalError=false;
  this.refs.messages.replaceChildren();this.refs.input.value='';this.refs.announcer.textContent='';this.refs.latest.hidden=true;this.closeOverlay();this.toggleEmoji(false);this.notice('');
  this.controller=new AbortController();this.updateIdentity();
  if(!id){this.status('empty','Kies een spel','Selecteer een spel om de showchat te openen.');this.empty('De show begint samen','Kies een spel om de chat te openen.');this.readyPromise=Promise.resolve();return this.readyPromise;}
  this.status('connecting','Verbinden…','De chatgeschiedenis wordt opgehaald.');this.empty('Even verbinden','De berichten van deze show worden geladen.');
  const epoch=this.epoch;this.readyPromise=this.initialLoad(epoch);return this.readyPromise;
 }
 async initialLoad(epoch){
  if(!this.current(epoch)||this.initialBusy||this.terminalError)return;this.initialBusy=true;clearTimeout(this.initialRetryTimer);
  try{const data=await this.api('',{},epoch);if(!this.current(epoch))return;this.apply(data,true);this.initialized=true;this.initialFailures=0;this.status('connected','Live','Chat is verbonden.');this.openStream(epoch);clearInterval(this.watchdog);this.watchdog=setInterval(()=>this.checkConnection(epoch),5000);this.watchdog?.unref?.();}
  catch(error){if(!this.current(epoch)||error.name==='AbortError')return;this.initialized=false;this.terminalError=!!error.status&&error.status<500&&error.status!==429;this.status('offline',this.terminalError?'Niet verbonden':'Opnieuw verbinden…',error.message);this.empty('Chat nog niet beschikbaar',this.terminalError?error.message:'De verbinding wordt automatisch hersteld. Je kunt ook zelf opnieuw verbinden.',true);this.updateComposer();if(!this.terminalError){this.initialFailures++;this.initialRetryTimer=setTimeout(()=>void this.initialLoad(epoch),Math.min(15000,2000*2**(this.initialFailures-1)));this.initialRetryTimer?.unref?.();}}
  finally{if(this.current(epoch))this.initialBusy=false;}
 }
 current(epoch){return !this.disposed&&epoch===this.epoch;}
 async api(path,{method='GET',body}={},epoch=this.epoch){
  if(!this.current(epoch))throw new DOMException('Aborted','AbortError');
  const signal=this.controller.signal,write=method!=='GET';let lastError;
  const base=`/api/bingo/games/${encodeURIComponent(this.gameId)}/chat${path}`,url=base+(this.hostView?'':`${base.includes('?')?'&':'?'}player=1`);
  for(let attempt=0;attempt<(write?3:1);attempt++){
   if(!this.current(epoch))throw new DOMException('Aborted','AbortError');
   try{
    const response=await this.fetcher(url,{method,signal,credentials:'same-origin',cache:'no-store',headers:write?{'Content-Type':'application/json','X-Vlampie-Bingo':'1'}:{},...(write?{body:JSON.stringify(body)}:{})});
    let result;try{result=await response.json();}catch{if(response.ok)throw new Error('De server heeft deze aanvraag nog niet bevestigd.');result={};}
    if(response.ok)return result;
    const error=new Error(result.error?.message||'De aanvraag is niet bevestigd. Probeer opnieuw.');error.code=result.error?.code;error.status=response.status;error.retriable=response.status===503||response.status===502||response.status===504||error.code==='conflict';
    if(!write||!error.retriable||attempt===2)throw error;lastError=error;
   }catch(error){if(error.name==='AbortError'||error.status&&!error.retriable||!write||attempt===2)throw error;lastError=error;}
   await wait(350+attempt*450,signal);
  }
  throw lastError||new Error('De verbinding is onderbroken.');
 }
 apply(data,snapshot=false){
  if(!data||typeof data!=='object')return;
  const responseCursor=Number(data.cursor)||0;
  if(!snapshot&&responseCursor<this.cursor)return;
  if(Number.isFinite(Number(data.serverTime)))this.serverOffset=Number(data.serverTime)-Date.now();
  this.acceptSelf(data);
  const atBottom=this.nearBottom(),anchor=atBottom?null:this.readingAnchor(),before=new Set(this.messages.keys()),newMessages=[];
  if(snapshot||data.reset||Array.isArray(data.messages)){
   this.messages.clear();for(const message of data.messages||[])this.setMessage(message);
   this.cursor=Math.max(0,Number(data.cursor)||0);
  }else{
   for(const event of [...(data.events||[])].sort((a,b)=>Number(a.seq)-Number(b.seq))){
    const seq=Number(event.seq)||0;if(seq<=this.cursor)continue;
    if(event.type==='message'&&event.message?.id)this.setMessage(event.message);
    if(event.type==='delete'){const id=String(event.messageId||event.message?.id||'');this.deletedIds.add(id);const old=this.messages.get(id);if(old)this.setMessage({...old,text:'',deleted:true});}
    if(event.type==='member'&&event.member){this.applyMember(event.member);}
    this.cursor=seq;
   }
   this.cursor=Math.max(this.cursor,Number(data.cursor)||0);
  }
  for(const [id,message]of this.messages)if(!before.has(id)&&!message.deleted)newMessages.push(message);
  this.lastSync=Date.now();this.renderMessages();if(anchor)this.restoreAnchor(anchor);
  if(snapshot||atBottom)this.scrollBottom();else if(newMessages.length){this.unread+=newMessages.length;this.refs.latest.textContent=`${this.unread} nieuw${this.unread===1?' bericht':'e berichten'} ↓`;this.refs.latest.hidden=false;}
  if(!snapshot&&newMessages.length){const last=newMessages.at(-1);this.refs.announcer.textContent=newMessages.length>1?`${newMessages.length} nieuwe berichten. ${last.name}: ${last.text}`:`${last.name}: ${last.text}`;}
  if(data.hasMore)this.beginPolling(0);
 }
 acceptSelf(data){if(!data.self)return;const version={cursor:Number(data.cursor)||this.cursor,time:Number(data.serverTime)||Date.now()};if(version.cursor<this.selfVersion.cursor||version.cursor===this.selfVersion.cursor&&version.time<this.selfVersion.time)return;this.selfVersion=version;this.self=data.self;this.updateIdentity();}
 setMessage(message){if(!message?.id)return;const id=String(message.id);if(message.deleted||this.messages.get(id)?.deleted)this.deletedIds.add(id);this.messages.set(id,this.deletedIds.has(id)?{...message,text:'',deleted:true}:message);}
 applyMember(member){
  this.members.set(member.memberId,{...this.members.get(member.memberId),...member});
  if(this.self?.memberId===member.memberId){this.self={...this.self,...member};this.updateIdentity();}
  for(const [id,message]of this.messages)if(message.memberId===member.memberId&&message.role!=='host')this.messages.set(id,{...message,role:member.role||message.role});
  if(!this.refs.overlay.hidden&&this.overlayMode==='members')this.renderMembers();
 }
 updateIdentity(){
  const self=this.self,profiles=Array.isArray(self?.profiles)?self.profiles:[],host=self?.role==='host';
  this.manageButton.hidden=!['host','moderator'].includes(self?.role);
  if(this.manageButton.hidden&&!this.refs.overlay.hidden)this.closeOverlay();
  const optionsKey=JSON.stringify(profiles.map(profile=>[profile.id,profile.name]));
  if(this.profileOptionsKey!==optionsKey){this.profileOptionsKey=optionsKey;this.refs.profile.replaceChildren();for(const profile of profiles){const option=el('option','',profile.name);option.value=profile.id;this.refs.profile.append(option);}}
  if(!profiles.some(profile=>profile.id===this.selectedProfile))this.selectedProfile=profiles[0]?.id||'';
  for(const option of this.refs.profile.querySelectorAll('option'))option.selected=option.value===this.selectedProfile;
  this.refs.profile.hidden=host||profiles.length<2;this.refs.identity.hidden=!host&&profiles.length>1;
  this.refs.identity.textContent=host?'Host':profiles.find(profile=>profile.id===this.selectedProfile)?.name||'Kies eerst een speler';
  this.refs.identity.classList.toggle('lc-host-identity',host);
  this.updateComposer();
 }
 updateComposer(){
  const input=this.refs.input,text=input.value||'',self=this.self,hasProfile=self?.role==='host'||!!this.selectedProfile;
  const muted=Number(self?.mutedUntil)>Date.now()+this.serverOffset;
  const canSend=!!this.gameId&&!!self?.canSend&&!muted&&hasProfile&&!this.disposed;
  input.disabled=!canSend||this.sending;this.refs.profile.disabled=this.sending;this.refs.emojiButton.disabled=!canSend||this.sending;this.refs.send.disabled=!canSend||this.sending||!text.trim()||[...text].length>500;
  this.refs.count.textContent=`${[...text].length} / 500`;this.refs.count.classList.toggle('lc-count-over',[...text].length>500);this.refs.sendLabel.textContent=this.sending?'Versturen…':'Verstuur';
  this.refs.input.placeholder=!this.gameId?'Kies eerst een spel…':!self?'De chat wordt verbonden…':muted?'Je account is tijdelijk gemutet…':!self.canSend?'Reageren is nu niet mogelijk…':this.compact?'Typ je bericht…':bt('Typ een bericht of vraag met @Vlampie…');
  let reason=self?.reason||'';
  if(muted){const minutes=Math.max(1,Math.ceil((Number(self.mutedUntil)-Date.now()-this.serverOffset)/60000));reason=`Je account is gemutet. Nog ${minutes===1?'ongeveer 1 minuut':`${minutes} minuten`}.`;}
  else if(self?.canSend&&!hasProfile)reason='Voeg eerst een speler toe aan je account om mee te praten.';
  this.refs.hint.textContent=reason||'Enter om te verzenden';this.refs.hint.title=reason||'Enter om te verzenden · Shift + Enter voor een nieuwe regel';this.refs.hint.classList.toggle('lc-restricted',!!reason);
  this.refs.form.setAttribute('aria-busy',String(this.sending));
 }
 renderMessages(){
  const messages=[...this.messages.values()].sort((a,b)=>Number(a.seq)-Number(b.seq)).slice(-300),wanted=new Set(messages.map(message=>String(message.id)));
  for(const id of this.messages.keys())if(!wanted.has(id))this.messages.delete(id);
  for(const [id,node]of this.nodes)if(!wanted.has(id)){node.remove();this.nodes.delete(id);}
  let position=0;
  for(const message of messages){
   const id=String(message.id),signature=JSON.stringify([message.name,message.role,message.text,message.deleted,this.self?.role,this.self?.memberId]);let node=this.nodes.get(id);
   if(!node){node=el('article','lc-message');node.dataset.messageId=id;this.nodes.set(id,node);this.refs.messages.append(node);}
   if(this.refs.messages.children[position]!==node)this.refs.messages.insertBefore(node,this.refs.messages.children[position]||null);position++;
   if(node._signature===signature)continue;node._signature=signature;node.replaceChildren();
   node.className=`lc-message${message.role==='host'?' lc-message-host':''}${message.deleted?' lc-message-deleted':''}${message.memberId===this.self?.memberId?' lc-message-own':''}`;
   const meta=el('div','lc-message-meta'),name=el('strong','lc-message-name',message.role==='host'?'Host':message.name||'Speler');meta.append(name);
   if(['host','moderator'].includes(message.role))meta.append(el('span',`lc-role lc-role-${message.role}`,ROLES[message.role]));
   const time=el('time','lc-message-time',timeLabel(message.at));const date=new Date(message.at);if(!Number.isNaN(date.getTime())){time.dateTime=date.toISOString();time.title=date.toLocaleString('nl-NL');}meta.append(time);
   if(!message.deleted&&(this.canModerate(message)||this.canVlampie())){const more=button('•••','message-actions','lc-message-more');more.dataset.messageId=id;more.setAttribute('aria-label',`Acties voor bericht van ${message.name||'Host'}`);more.title='Berichtacties';meta.append(more);}
   node.append(meta,el('p','lc-message-text',message.deleted?'Dit bericht is verwijderd door de moderatie.':message.text||''));
  }
  this.refs.empty.hidden=messages.length>0;
  if(!messages.length&&this.self)this.empty('Iedereen is welkom',bt('Zeg hallo, leef mee en praat met Vlampie. Houd het gezellig voor alle spelers.'));
 }
 canModerate(message){const role=this.self?.role;return role==='host'||role==='moderator'&&message?.role!=='host'&&(message?.role!=='moderator'||message?.memberId===this.self?.memberId);}
 canVlampie(){return this.hostView&&this.self?.role==='host';}
 nearBottom(){const node=this.refs.messages;return !Number.isFinite(node.scrollHeight)||node.scrollHeight-node.scrollTop-node.clientHeight<65;}
 readingAnchor(){if(typeof this.refs.messages.getBoundingClientRect!=='function')return null;const top=this.refs.messages.getBoundingClientRect().top;for(const node of this.refs.messages.children){const bounds=node.getBoundingClientRect();if(bounds.bottom>top)return{id:node.dataset.messageId,offset:bounds.top-top};}return null;}
 restoreAnchor(anchor){const node=this.nodes.get(anchor.id);if(node&&typeof node.getBoundingClientRect==='function'){const offset=node.getBoundingClientRect().top-this.refs.messages.getBoundingClientRect().top;this.refs.messages.scrollTop+=offset-anchor.offset;}}
 scrollBottom(){this.refs.messages.scrollTop=this.refs.messages.scrollHeight;this.clearUnread();}
 clearUnread(){this.unread=0;this.refs.latest.hidden=true;}
 empty(title,text,retry=false){this.refs.empty.hidden=false;this.refs.emptyTitle.textContent=title;this.refs.emptyText.textContent=text;this.refs.retry.hidden=!retry;}
 notice(message,error=false){this.refs.notice.textContent=message||'';this.refs.notice.hidden=!message;this.refs.notice.classList.toggle('lc-notice-error',error);}
 status(state,label,title){this.root.dataset.chatState=state;this.refs.status.textContent=this.simulated?'Demo':label;this.refs.status.title=this.simulated?'Fictieve voorbeeldberichten, zonder echte chatverbinding.':title||label;}
 openStream(epoch=this.epoch){
  if(!this.current(epoch)||!this.gameId||!this.initialized)return;
  clearTimeout(this.reconnectTimer);this.stream?.close();
  if(!this.streaming||typeof EventSource==='undefined'){this.beginPolling(0);return;}
  let stream;try{stream=new EventSource(`/api/bingo/games/${encodeURIComponent(this.gameId)}/chat/stream?after=${this.cursor}${this.hostView?'':'&player=1'}`,{withCredentials:true});}catch{this.beginPolling(0);return;}
  this.stream=stream;this.lastStreamSync=Date.now();
  stream.addEventListener('sync',event=>{
   if(!this.current(epoch)||this.stream!==stream)return;
   try{const data=JSON.parse(event.data);this.lastStreamSync=Date.now();this.apply(data);this.failures=0;if(!data.hasMore)this.stopPolling();this.status('connected','Live','Berichten worden rechtstreeks bijgewerkt.');if(data.reconnect){stream.close();this.stream=null;this.scheduleStream(150);}}catch{stream.close();this.stream=null;this.beginPolling(0);this.scheduleStream(1200);}
  });
  stream.addEventListener('chat-error',event=>{if(!this.current(epoch)||this.stream!==stream)return;let error;try{error=JSON.parse(event.data)?.error;}catch{}if(['unauthenticated','unauthorized','forbidden','not_found','auth','not_admitted','not_participant'].includes(error?.code)){this.revoke(error?.message||'Je chattoegang is gewijzigd. Maak opnieuw verbinding.');}else{stream.close();this.stream=null;this.status('offline','Verbinding herstellen…',error?.message||'De chatverbinding wordt hersteld.');this.beginPolling(0);this.scheduleStream(1500);}});
  stream.onerror=()=>{if(!this.current(epoch)||this.stream!==stream)return;stream.close();this.stream=null;this.failures++;this.beginPolling(0);this.scheduleStream(Math.min(6000,700*this.failures));};
 }
 scheduleStream(delay=1000){clearTimeout(this.reconnectTimer);const epoch=this.epoch;if(!this.gameId||this.disposed)return;this.reconnectTimer=setTimeout(()=>this.openStream(epoch),delay);this.reconnectTimer?.unref?.();}
 beginPolling(delay=1500){
  if(this.disposed||!this.gameId||!this.initialized)return;
  this.pollActive=true;if(this.pollBusy||this.pollTimer)return;const epoch=this.epoch;this.pollTimer=setTimeout(()=>{this.pollTimer=null;void this.poll(epoch);},delay);this.pollTimer?.unref?.();
 }
 stopPolling(){this.pollActive=false;clearTimeout(this.pollTimer);this.pollTimer=null;}
 async poll(epoch=this.epoch){
  if(!this.current(epoch)||this.pollBusy)return;this.pollBusy=true;
  try{const data=await this.api(`?after=${this.cursor}`,{},epoch);if(!this.current(epoch))return;this.apply(data);this.status('connected','Live','Chat is verbonden. Berichten worden automatisch bijgewerkt.');}
  catch(error){if(this.current(epoch)&&error.name!=='AbortError'){this.status('offline','Verbinding herstellen…',error.message||'De verbinding wordt hersteld.');if([401,403,404].includes(error.status))this.revoke(error.message);}}
  finally{if(this.current(epoch)){this.pollBusy=false;if(this.pollActive)this.beginPolling(1500);}}
 }
 checkConnection(epoch){if(!this.current(epoch))return;this.updateComposer();if(Date.now()-this.lastSync>12000)this.beginPolling(0);if(Date.now()-this.lastSync>28000)this.status('offline','Verbinding herstellen…','De chat wacht op een bevestigde verbinding.');if(this.stream&&Date.now()-this.lastStreamSync>28000){this.stream.close();this.stream=null;this.beginPolling(0);this.scheduleStream(0);}}
 async send(){
  const text=this.refs.input.value.trim();if(this.sending||this.refs.send.disabled||!text)return;const epoch=this.epoch,profileId=this.self?.role==='host'?null:this.selectedProfile;
  const sameDraft=this.pendingDraft?.text===text&&this.pendingDraft.profileId===profileId;const payload=sameDraft?this.pendingDraft:{requestId:uuid(),profileId,text};this.pendingDraft=payload;this.sending=true;this.notice('');this.toggleEmoji(false);this.updateComposer();
  try{
   const data=await this.api('',{method:'POST',body:payload},epoch);if(!this.current(epoch))return;if(!data.message?.id&&!data.events&&!data.messages)throw new Error('Het bericht is nog niet bevestigd.');
   if(data.message?.id){this.setMessage(data.message);this.renderMessages();this.scrollBottom();}
   this.acceptSelf(data);
   if(data.events||data.messages)this.apply(data);
   if(this.refs.input.value.trim()===text)this.refs.input.value='';this.pendingDraft=null;this.notice('');this.beginPolling(0);
  }catch(error){if(this.current(epoch)&&error.name!=='AbortError'){const uncertain=!error.status||error.retriable;this.notice(uncertain?'Het verzenden is nog niet bevestigd. Je bericht staat klaar; probeer veilig opnieuw.':error.message,true);if(!uncertain)this.pendingDraft=null;this.beginPolling(0);}}
  finally{if(this.current(epoch)){this.sending=false;this.updateComposer();if(!this.refs.input.disabled)this.refs.input.focus();}}
 }
 click(event){
  const node=event.target.closest?.('[data-action]');if(!node||!this.root.contains(node))return;
  const action=node.dataset.action;
  if(action==='latest')this.scrollBottom();
  if(action==='emoji')this.toggleEmoji(this.refs.emoji.hidden);
  if(action==='insert-emoji')this.insertEmoji(node.dataset.emoji);
  if(action==='close-overlay')this.closeOverlay();
  if(action==='members')void this.openMembers();
  if(action==='message-actions')this.openMessage(node.dataset.messageId,node);
  if(action==='retry'){const id=this.gameId;this.gameId='';void this.setGame(id);}
  if(action==='delete-message')void this.deleteMessage(node.dataset.messageId);
  if(action==='mute-member')void this.muteMember(node.dataset.memberId,Number(node.parentElement.querySelector('select')?.value||300));
  if(action==='unmute-member')void this.muteMember(node.dataset.memberId,0);
  if(action==='role-member')void this.changeRole(node.dataset.memberId,node.dataset.role);
  if(action==='vlampie'){const message=this.messages.get(node.dataset.messageId);if(message&&this.canVlampie()){this.closeOverlay();Promise.resolve(this.onVlampie(message)).catch(()=>this.notice(bt('De reactie van Vlampie kon niet worden gestart.'),true));}}
 }
 toggleEmoji(open){this.refs.emoji.hidden=!open;this.refs.emojiButton.setAttribute('aria-expanded',String(open));if(open)this.refs.emoji.querySelector('button')?.focus();}
 insertEmoji(emoji){const input=this.refs.input;if(input.disabled)return;const start=input.selectionStart??input.value.length,end=input.selectionEnd??start,next=input.value.slice(0,start)+emoji+input.value.slice(end);if([...next].length>500){this.notice('Je bericht mag maximaal 500 tekens bevatten.',true);return;}input.value=next;this.toggleEmoji(false);input.focus();input.setSelectionRange?.(start+emoji.length,start+emoji.length);this.updateComposer();}
 openOverlay(title,mode){this.overlayMode=mode;this.overlayReturnFocus=document.activeElement;this.refs.overlayTitle.textContent=title;this.refs.overlayContent.replaceChildren();this.refs.overlay.hidden=false;this.root.querySelector('[data-action="close-overlay"]').focus();}
 closeOverlay(){if(!this.refs?.overlay)return;const wasOpen=!this.refs.overlay.hidden;this.refs.overlay.hidden=true;this.overlayMode='';if(wasOpen&&this.overlayReturnFocus?.isConnected)this.overlayReturnFocus.focus();}
 async openMembers(){
  if(!['host','moderator'].includes(this.self?.role))return;this.openOverlay('Deelnemers & moderatie','members');this.refs.overlayContent.append(el('p','lc-panel-description','Deelnemers laden…'));const epoch=this.epoch;
  try{const data=await this.api('/members',{},epoch);if(!this.current(epoch)||this.overlayMode!=='members')return;this.members=new Map((data.members||[]).map(member=>[member.memberId,member]));this.renderMembers();}catch(error){if(this.current(epoch)&&this.overlayMode==='members')this.refs.overlayContent.replaceChildren(el('p','lc-panel-description',error.message));}
 }
 renderMembers(){
  if(this.overlayMode!=='members')return;const content=this.refs.overlayContent;content.replaceChildren();content.append(el('p','lc-panel-description',this.self?.role==='host'?'Beheer chatrechten per account. Een mute geldt voor alle namen binnen dat account.':'Een mute geldt voor alle namen binnen een account. Host en moderators worden door de host beheerd.'));
  const sorted=[...this.members.values()].sort((a,b)=>(a.name||'').localeCompare(b.name||'','nl'));
  if(!sorted.length)content.append(el('p','lc-panel-description','Zodra spelers deelnemen, verschijnen hun accounts hier.'));
  for(const member of sorted){const box=el('article','lc-member'),heading=el('div','lc-member-heading');heading.append(el('strong','',member.name||member.names?.[0]||'Speler'));if(member.role!=='player')heading.append(el('span',`lc-role lc-role-${member.role}`,ROLES[member.role]||'Speler'));box.append(heading);
   if(member.names?.length>1)box.append(el('p','lc-member-names',member.names.join(' · ')));
   this.addMemberActions(box,member);content.append(box);}
 }
 addMemberActions(container,member){
  if(member.role==='host'||member.memberId===this.self?.memberId||!this.canModerate(member))return;
  const actions=el('div','lc-member-actions');
  if(Number(member.mutedUntil)>Date.now()+this.serverOffset){const until=new Date(Number(member.mutedUntil));container.append(el('p','lc-muted-label',`Gemutet tot ${until.toLocaleString('nl-NL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`));const unmute=button('Mute opheffen','unmute-member');unmute.dataset.memberId=member.memberId;actions.append(unmute);}
  else{const select=el('select','lc-mute-duration');select.setAttribute('aria-label',`Muteduur voor ${member.name||'dit account'}`);for(const [value,label]of MUTE_OPTIONS){const option=el('option','',label);option.value=String(value);if(value===300)option.selected=true;select.append(option);}const mute=button('Mute account','mute-member');mute.dataset.memberId=member.memberId;actions.append(select,mute);}
  if(this.self?.role==='host'){const role=button(member.role==='moderator'?'Moderator verwijderen':'Maak moderator','role-member','lc-button lc-button-subtle');role.dataset.memberId=member.memberId;role.dataset.role=member.role==='moderator'?'player':'moderator';actions.append(role);}
  container.append(actions);
 }
 openMessage(id,trigger){
  const message=this.messages.get(id);if(!message||message.deleted)return;this.openOverlay('Berichtacties','message');this.overlayReturnFocus=trigger;this.overlayMessageId=id;
  const content=this.refs.overlayContent;content.append(el('strong','lc-selected-name',message.name||'Host'),el('blockquote','lc-selected-message',message.text));
  if(this.canVlampie()){const respond=button(bt('✦ Laat Vlampie reageren'),'vlampie','lc-button lc-button-gold');respond.dataset.messageId=id;content.append(respond);}
  if(this.canModerate(message)){const remove=button('Bericht verwijderen','delete-message','lc-button lc-button-danger');remove.dataset.messageId=id;content.append(remove);const member={...message,...this.members.get(message.memberId)};this.addMemberActions(content,member);}
 }
 async moderate(path,body,success){
  const epoch=this.epoch;const controls=[...this.refs.overlayContent.querySelectorAll('button,select')];controls.forEach(control=>control.disabled=true);this.notice('');
  try{const data=await this.api(path,{method:'POST',body:{...body,requestId:uuid()}},epoch);if(!this.current(epoch))return null;if(data.member)this.applyMember(data.member);if(data.message?.id)this.setMessage(data.message);this.acceptSelf(data);if(data.events||data.messages)this.apply(data);this.notice(success);this.beginPolling(0);return data;}
  catch(error){if(this.current(epoch)&&error.name!=='AbortError')this.notice(error.message||'De wijziging is niet bevestigd.',true);return null;}
  finally{if(this.current(epoch))controls.forEach(control=>control.disabled=false);}
 }
 async deleteMessage(id){const result=await this.moderate(`/messages/${encodeURIComponent(id)}/delete`,{},'Bericht verwijderd.');if(result){this.deletedIds.add(id);const message=this.messages.get(id);if(message)this.setMessage({...message,text:'',deleted:true});this.renderMessages();this.closeOverlay();}}
 async muteMember(id,seconds){const result=await this.moderate(`/members/${encodeURIComponent(id)}/mute`,{seconds},seconds?'Account tijdelijk gemutet.':'Mute opgeheven.');if(result){if(result.member)this.applyMember(result.member);if(this.overlayMode==='message')this.closeOverlay();else if(this.overlayMode==='members')void this.openMembers();}}
 async changeRole(id,role){const result=await this.moderate(`/members/${encodeURIComponent(id)}/role`,{role},role==='moderator'?'Account is nu moderator.':'Moderatorrechten verwijderd.');if(result){if(result.member)this.applyMember(result.member);if(this.overlayMode==='message')this.closeOverlay();else if(this.overlayMode==='members')void this.openMembers();}}
 revoke(message){this.stopTransport();this.epoch++;this.terminalError=true;this.self=null;this.sending=false;this.updateIdentity();this.status('offline','Chat niet beschikbaar',message);this.notice(message,true);this.refs.notice.append(button('Opnieuw verbinden','retry','lc-retry-inline'));}
 stopTransport(){this.controller?.abort();this.stream?.close();this.stream=null;clearTimeout(this.reconnectTimer);clearTimeout(this.initialRetryTimer);clearInterval(this.watchdog);this.stopPolling();this.pollBusy=false;this.initialized=false;}
 dispose(){if(this.disposed)return;document.removeEventListener('show-brand-changed',this.brandListener);this.stopTransport();this.epoch++;this.disposed=true;this.listenerController.abort();this.self=null;this.updateComposer();this.closeOverlay();this.status('offline','Chat gesloten','Deze chat is gesloten.');}
}
