// Only player-control acknowledgements establish muted/playing. Video time is
// supplemental information and is never treated as proof that a ball was heard.
let apiPromise;
export function loadYouTubeAPI(win=globalThis.window,doc=globalThis.document){
 if(win?.YT?.Player)return Promise.resolve(win.YT);
 if(!win||!doc)return Promise.reject(Error('De YouTube-afspeler is op dit apparaat niet beschikbaar.'));
 if(apiPromise)return apiPromise;
 apiPromise=new Promise((resolve,reject)=>{const prior=win.onYouTubeIframeAPIReady;let settled=false;
  const done=error=>{if(settled)return;settled=true;clearTimeout(timer);if(error){apiPromise=null;reject(error);}else resolve(win.YT);};
  const timer=setTimeout(()=>done(Error('YouTube-bediening kon niet laden. Je kunt de afspeler zelf bedienen.')),12000);
  win.onYouTubeIframeAPIReady=()=>{try{prior?.();}finally{done();}};
  let script=doc.querySelector('script[data-mf-youtube-api]');if(!script){script=doc.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;script.dataset.mfYoutubeApi='true';script.addEventListener('error',()=>done(Error('YouTube-bediening werd geblokkeerd.')),{once:true});doc.head.append(script);}
 });return apiPromise;
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class YouTubeController{
 constructor({loadAPI=loadYouTubeAPI,document=globalThis.document,window=globalThis.window,pauseCheckMs=600}={}){Object.assign(this,{loadAPI,document,window,pauseCheckMs});this.listeners=new Set();this.generation=0;this.player=null;this.frame=null;this.container=null;this.suspended=false;this.disposed=false;this.captions=false;this.state={ready:false,state:null,playing:false,muted:null,volume:null,currentTime:null,duration:null,suspended:false,framePresent:false,autoplayBlocked:false,error:'',simulated:false,captionsApplied:null};}
 setCaptionPreference(enabled){this.captions=enabled===true;}
 applyCaptionPreference(){if(this.disposed||this.suspended||!this.container)return false;this.removeFrame();this.createFrame();return true;}
 subscribe=fn=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
 getSnapshot=()=>this.state;
 update(patch={}){this.state={...this.state,...patch};for(const fn of this.listeners)fn(this.state);return this.state;}
 info(){const p=this.player;const read=fn=>{try{return p&&typeof p[fn]==='function'?p[fn]():null;}catch{return null;}};const state=read('getPlayerState'),muted=read('isMuted'),volume=read('getVolume'),currentTime=read('getCurrentTime'),duration=read('getDuration');return this.update({ready:!!p&&this.state.ready,state:Number.isFinite(state)?state:null,playing:state===1,muted:typeof muted==='boolean'?muted:null,volume:Number.isFinite(volume)?volume:null,currentTime:Number.isFinite(currentTime)?currentTime:null,duration:Number.isFinite(duration)?duration:null,suspended:this.suspended,framePresent:!!this.frame?.isConnected});}
 mount(container,{videoId,title='Live-uitzending'}={}){this.unmount();this.disposed=false;this.container=container;this.videoId=videoId;this.title=title;if(!/^[a-zA-Z0-9_-]{11}$/.test(videoId||'')){this.update({error:'De regie heeft nog geen YouTube-uitzending ingesteld.',framePresent:false});return()=>this.unmount();}if(!this.suspended)this.createFrame();else this.update({suspended:true});return()=>this.unmount();}
 createFrame(){if(this.disposed||!this.container||!this.videoId||this.frame?.isConnected)return;const token=++this.generation,frame=this.document.createElement('iframe');frame.title=this.title;frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';frame.src=`https://www.youtube-nocookie.com/embed/${this.videoId}?enablejsapi=1&playsinline=1&rel=0&cc_lang_pref=nl${this.captions?'&cc_load_policy=1':''}&origin=${encodeURIComponent(this.window?.location?.origin||globalThis.location?.origin||'')}`;this.frame=frame;this.container.append(frame);this.update({ready:false,framePresent:true,suspended:false,autoplayBlocked:false,error:'',captionsApplied:this.captions});
  void this.loadAPI(this.window,this.document).then(YT=>{if(this.disposed||token!==this.generation||!frame.isConnected)return;this.player=new YT.Player(frame,{events:{onReady:()=>{if(token!==this.generation)return;this.update({ready:true});this.info();},onStateChange:()=>{if(token===this.generation)this.info();},onAutoplayBlocked:()=>{if(token===this.generation)this.update({autoplayBlocked:true,playing:false,error:'Druk op Afspelen in de YouTube-video om verder te kijken.'});},onError:()=>{if(token===this.generation)this.update({error:'De uitzending kan niet worden afgespeeld. Controleer de YouTube-video of vraag de regie om hulp.'});}}});}).catch(error=>{if(token===this.generation&&!this.disposed)this.update({error:error.message});});
 }
 removeFrame(){this.liveSeek=null;this.generation++;const p=this.player;this.player=null;try{p?.destroy?.();}catch{}this.frame?.remove();this.frame=null;this.update({ready:false,framePresent:false,playing:false,muted:true});}
 async suspend(){this.liveSeek=null;this.suspended=true;this.update({suspended:true});if(!this.frame?.isConnected){this.removeFrame();return{silenced:true,method:'no-player',simulated:false};}
  try{this.player?.mute?.();this.player?.pauseVideo?.();}catch{}
  // This bounded wait checks an API acknowledgement; it is not a stream-delay timer.
  const end=Date.now()+this.pauseCheckMs;while(this.player&&Date.now()<end){const info=this.info();if(info.muted===true||[0,2,5].includes(info.state)){this.update({suspended:true});return{silenced:true,method:'youtube-api',simulated:false};}await wait(40);}
  this.removeFrame();this.update({suspended:true,error:''});return{silenced:true,method:'iframe-removed',simulated:false};
 }
 async restore({play=false}={}){this.suspended=false;this.update({suspended:false});if(!this.frame?.isConnected)this.createFrame();if(play){try{this.player?.unMute?.();this.player?.setVolume?.(100);this.player?.playVideo?.();}catch{}await wait(100);}return this.info();}
 async resume(){const restored=await this.restore({play:true});if(restored.ready&&Number.isFinite(restored.duration)&&restored.duration>0&&typeof this.player?.seekTo==='function'){this.liveSeek={target:restored.duration,requestedAt:Date.now()};try{this.player.seekTo(restored.duration,true);}catch{this.liveSeek=null;}}return this.getInfo();}
 getInfo(){return {...this.info(),liveSeek:this.liveSeek||null,observedAt:Date.now()};}
 unmount(){this.removeFrame();this.container=null;}
 dispose(){this.disposed=true;this.unmount();this.listeners.clear();}
}
