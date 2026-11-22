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
 constructor({gameId,getAccess,onChange=()=>{},loadSDK=loadCastSDK}={}){Object.assign(this,{gameId,getAccess,onChange,loadSDK});this.listeners=[];this.active=false;this.disposed=false;this.attempt=0;}
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
   if([framework.SessionState.SESSION_ENDED,framework.SessionState.SESSION_START_FAILED].includes(event.sessionState)){this.setActive(false);this.emit({castPhase:'idle'});}
   else this.observe();
  });
  for(const type of ['IS_CONNECTED_CHANGED','IS_MEDIA_LOADED_CHANGED','PLAYER_STATE_CHANGED'])bind(this.remoteController,framework.RemotePlayerEventType[type],()=>this.observe());
  bind(context,framework.CastContextEventType.CAST_STATE_CHANGED,event=>this.emit({castAvailable:event.castState!==framework.CastState.NO_DEVICES_AVAILABLE}));
  this.emit({castAvailable:context.getCastState?.()!==framework.CastState.NO_DEVICES_AVAILABLE});this.observe();return sdk;
 }
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
  const attempt=++this.attempt;this.emit({castPhase:'connecting',castError:''});
  try{
   const {cast}=await this.initialize();if(this.disposed||attempt!==this.attempt)return;
   await this.context.requestSession();if(this.disposed||attempt!==this.attempt)return;
   const access=await this.getAccess();if(this.disposed||attempt!==this.attempt)return;
   const session=this.context.getCurrentSession();if(!session)throw Error('Er is nog geen tv verbonden.');
   const info=new cast.media.MediaInfo(access.url,access.mimeType||'application/x-mpegURL');info.streamType=cast.media.StreamType.LIVE;info.customData={miloBroadcastGameId:this.gameId};
   const request=new cast.media.LoadRequest(info);request.autoplay=true;
   // Leaving currentTime unset makes a LIVE load start at the receiver live edge.
   await session.loadMedia(request);if(this.disposed||attempt!==this.attempt)return;this.observe();
   if(!this.active)this.emit({castPhase:'waiting'});
  }catch(error){if(!this.disposed&&attempt===this.attempt)this.emit({castPhase:'error',castError:error?.message||'Casten is niet gestart. Kies opnieuw een tv of gebruik scherm spiegelen.'});throw error;}
 }
 async stop(){
  this.attempt++;const session=this.context?.getCurrentSession();if(!session&&!this.active)return;
  this.emit({castPhase:'stopping'});session?.endSession(true);
  if(!this.active)return;
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{clearInterval(timer);reject(Error('Stoppen op de tv is nog niet bevestigd. Stop de Cast-sessie op de tv en probeer opnieuw.'));},7000);
   const timer=setInterval(()=>{if(!this.active){clearInterval(timer);clearTimeout(timeout);resolve();}},50);
  });
 }
 dispose(){this.disposed=true;this.attempt++;for(const remove of this.listeners)remove();this.listeners=[];}
}
