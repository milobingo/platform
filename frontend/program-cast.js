// Google Cast Web Sender, Default Media Receiver: no receiver account or paid
// service is required. Actual receiver playback, not loadMedia(), mutes local sound.
const sdkLoads=new WeakMap();
export function loadCastSDK(win=globalThis.window,doc=globalThis.document){
 if(win?.cast?.framework&&win?.chrome?.cast)return Promise.resolve({framework:win.cast.framework,cast:win.chrome.cast});
 if(!win||!doc||!win.isSecureContext)return Promise.reject(Error('Cast is op dit apparaat niet beschikbaar. Gebruik scherm spiegelen.'));
 if(sdkLoads.has(win))return sdkLoads.get(win);
 const promise=new Promise((resolve,reject)=>{
  let done=false;const previous=win.__onGCastApiAvailable;
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(error){sdkLoads.delete(win);reject(error);}else resolve({framework:win.cast.framework,cast:win.chrome.cast});};
  const timer=setTimeout(()=>finish(Error('Geen Cast-bediening gevonden. Gebruik Chrome of kies scherm spiegelen.')),12000);
  win.__onGCastApiAvailable=available=>{try{previous?.(available);}finally{finish(available&&win.cast?.framework?null:Error('Geen Cast-apparaat beschikbaar via deze browser.'));}};
  let script=doc.querySelector('script[data-milo-cast-sdk]');
  if(!script){script=doc.createElement('script');script.async=true;script.src='https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';script.dataset.miloCastSdk='true';script.addEventListener('error',()=>finish(Error('Cast-bediening kon niet laden. Gebruik scherm spiegelen.')),{once:true});doc.head.append(script);}
 });sdkLoads.set(win,promise);return promise;
}

export class ProgramCast{
 constructor({gameId,getAccess,onChange=()=>{},loadSDK=loadCastSDK,stopTimeoutMs=7000}={}){Object.assign(this,{gameId,getAccess,onChange,loadSDK,stopTimeoutMs});this.listeners=[];this.active=false;this.disposed=false;this.attempt=0;this.operations=new Set();this.sessions=new Map();this.ended=new Set();this.endListeners=new Set();}
 emit(patch){if(!this.disposed)this.onChange(patch);}
 async initialize(){
  if(this.sdk)return this.sdk;
  if(this.initializing)return this.initializing;
  this.initializing=this.initializeOnce();
  try{return await this.initializing;}finally{this.initializing=null;}
 }
 async initializeOnce(){
  const sdk=await this.loadSDK();if(this.disposed)throw Error('De uitzendspeler is gesloten.');
  this.sdk=sdk;const {framework,cast}=sdk,context=framework.CastContext.getInstance();this.context=context;
  context.setOptions({receiverApplicationId:cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,autoJoinPolicy:cast.AutoJoinPolicy.ORIGIN_SCOPED,resumeSavedSession:true});
  this.remote=new framework.RemotePlayer();this.remoteController=new framework.RemotePlayerController(this.remote);
  const bind=(object,type,fn)=>{if(!type)return;object.addEventListener(type,fn);this.listeners.push(()=>object.removeEventListener(type,fn));};
  bind(context,framework.CastContextEventType.SESSION_STATE_CHANGED,event=>{
   // A disconnected RemotePlayer, a failed launch, or a load acknowledgement
   // does not prove that the receiver app stopped. Bind proof to its session.
   if(event.sessionState===framework.SessionState.SESSION_ENDED&&event.session){const key=this.sessionKey(event.session);this.ended.add(key);this.sessions.delete(key);for(const listener of this.endListeners)listener();}
   if([framework.SessionState.SESSION_ENDED,framework.SessionState.SESSION_START_FAILED].includes(event.sessionState)){this.setActive(false);this.emit({castPhase:'idle'});}
   else this.observe();
  });
  for(const type of ['IS_CONNECTED_CHANGED','IS_MEDIA_LOADED_CHANGED','PLAYER_STATE_CHANGED'])bind(this.remoteController,framework.RemotePlayerEventType[type],()=>this.observe());
  bind(context,framework.CastContextEventType.CAST_STATE_CHANGED,event=>this.emit({castAvailable:event.castState!==framework.CastState.NO_DEVICES_AVAILABLE}));
  this.emit({castAvailable:context.getCastState?.()!==framework.CastState.NO_DEVICES_AVAILABLE});this.observe();return sdk;
 }
 sessionKey(session){return session?.getSessionId?.()||session;}
 remember(session){if(session&&!this.ended.has(this.sessionKey(session)))this.sessions.set(this.sessionKey(session),session);return session;}
 operation(run){const pending=Promise.resolve().then(run);this.operations.add(pending);void pending.finally(()=>this.operations.delete(pending)).catch(()=>{});return pending;}
 requestEnd(session,{fresh=false}={}){if(!session)return;const key=this.sessionKey(session);if(fresh)this.ended.delete(key);this.remember(session);if(!this.ended.has(key))session.endSession(true);}
 async bounded(promise,deadline){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Stoppen op de tv is nog niet bevestigd. Stop de Cast-sessie op de tv en probeer opnieuw.')),Math.max(1,deadline-Date.now()));})]);}finally{clearTimeout(timer);}}
 async waitEnded(session,deadline){const key=this.sessionKey(session);if(this.ended.has(key))return;let listener;try{await this.bounded(new Promise(resolve=>{listener=()=>{if(this.ended.has(key))resolve();};this.endListeners.add(listener);listener();}),deadline);}finally{this.endListeners.delete(listener);}}
 setActive(active){if(this.active===active)return;this.active=active;this.emit({castActive:active,castPhase:active?'playing':'idle'});}
 observe(){
  const media=this.context?.getCurrentSession()?.getMediaSession?.(),ours=media?.media?.customData?.miloBroadcastGameId===this.gameId;
  if(!ours||this.remote?.isConnected===false||this.remote?.isMediaLoaded===false){this.setActive(false);return;}
  const state=media.playerState||this.remote.playerState,states=this.sdk.cast.media.PlayerState;
  if(state===states.PLAYING){this.setActive(true);this.emit({castPhase:'playing'});}
  else if(this.active&&state===states.BUFFERING)this.emit({castPhase:'buffering'});
  else if(this.active&&state===states.PAUSED)this.emit({castPhase:'paused'});
  else if(state===states.IDLE){this.setActive(false);this.emit({castPhase:'idle'});}
 }
 async start(){
  if(this.stopPromise)throw Error('Wacht tot het stoppen op de tv is bevestigd.');
  if(this.startPromise)return this.startPromise;
  this.startPromise=this.startOnce();try{return await this.startPromise;}finally{this.startPromise=null;}
 }
 async startOnce(){
  const attempt=++this.attempt;this.emit({castPhase:'connecting',castError:''});
  let session;
  try{
   const {cast}=await this.initialize();if(this.disposed||attempt!==this.attempt)return;
   await this.operation(async()=>{try{await this.context.requestSession();}finally{const created=this.remember(this.context.getCurrentSession());if(created&&(this.disposed||attempt!==this.attempt)){try{this.requestEnd(created,{fresh:true});}catch{}}}});if(this.disposed||attempt!==this.attempt)return;
   const access=await this.getAccess();if(this.disposed||attempt!==this.attempt)return;
   session=this.remember(this.context.getCurrentSession());if(!session)throw Error('Er is nog geen tv verbonden.');
   const info=new cast.media.MediaInfo(access.url,access.mimeType||'application/x-mpegURL');info.streamType=cast.media.StreamType.LIVE;info.customData={miloBroadcastGameId:this.gameId};
   const request=new cast.media.LoadRequest(info);request.autoplay=true;
   // Leaving currentTime unset makes a LIVE load start at the receiver live edge.
   this.ended.delete(this.sessionKey(session));this.remember(session);
   await this.operation(()=>session.loadMedia(request));if(this.disposed||attempt!==this.attempt)return;this.observe();
   if(!this.active)this.emit({castPhase:'waiting'});
  }catch(error){if(!this.disposed&&attempt===this.attempt)this.emit({castPhase:'error',castError:error?.message||'Casten is niet gestart. Kies opnieuw een tv of gebruik scherm spiegelen.'});throw error;}
  finally{if(session&&(this.disposed||attempt!==this.attempt)){try{this.requestEnd(session,{fresh:true});}catch{}}}
 }
 async stop(){
  if(this.stopPromise)return this.stopPromise;
  this.stopPromise=this.stopOnce();try{return await this.stopPromise;}finally{this.stopPromise=null;}
 }
 async stopOnce(){
  this.attempt++;const deadline=Date.now()+this.stopTimeoutMs,pending=[...this.operations],initial=this.remember(this.context?.getCurrentSession());
  if(!initial&&!this.sessions.size&&!pending.length&&!this.active)return;
  this.emit({castPhase:'stopping'});
  // End immediately, then wait for every already-issued request/load to settle.
  // A late load response can otherwise follow an earlier SESSION_ENDED event.
  for(const session of this.sessions.values())this.requestEnd(session);
  if(pending.length)await this.bounded(Promise.allSettled(pending),deadline);
  this.remember(this.context?.getCurrentSession());
  const sessions=[...this.sessions.values()];
  if(pending.length&&initial&&!sessions.includes(initial))sessions.push(initial);
  for(const session of sessions)this.requestEnd(session,{fresh:pending.length>0});
  if(this.active&&!sessions.length)throw Error('De actieve tv-sessie kon niet worden vastgesteld. Stop Cast op de tv en probeer opnieuw.');
  await Promise.all(sessions.map(session=>this.waitEnded(session,deadline)));
  this.setActive(false);this.emit({castPhase:'idle'});
 }
 dispose(){this.disposed=true;this.attempt++;for(const remove of this.listeners)remove();this.listeners=[];}
}
