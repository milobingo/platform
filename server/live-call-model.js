import {livekitError,callIdentities} from './livekit.js';
export const LIVE_CALL_PHASES=Object.freeze(['preparing','ringing','backstage','staged','live','returning','returned','completed']);
export const liveCallActive=c=>!!c&&c.transport==='livekit'&&c.phase!=='completed';
const clean=(value,max,label,{empty=true}={})=>{if(typeof value!=='string'||value.length>max||!empty&&!value.trim())throw livekitError('Controleer '+label+'.',400);return value.trim();};
export function confirmedCallFacts(game,entry){return (game.results||[]).filter(r=>r.acknowledged===true&&r.winner?.accountId===entry.accountId&&(r.winner.profileId===entry.profileId||game.books.some(b=>b.id===r.winner.bookId&&b.profileId===entry.profileId&&b.accountId===entry.accountId))).slice(-5).map(r=>({confirmed:true,resultId:r.id,type:r.type==='lottery'?'lottery':'bingo',prize:r.prize?.title||'',round:game.plan.blocks.filter(b=>b.type==='round')[r.roundIndex]?.title||'',at:r.createdAt}));}
export function callContext(input={},entry,game){return {callName:clean(input.callName??entry.name,60,'de roepnaam',{empty:false}),pronunciation:clean(input.pronunciation??'',120,'de uitspraakhulp'),reason:clean(input.reason??'Even gezellig kennismaken',180,'de reden van het gesprek',{empty:false}),note:clean(input.note??'',400,'de regienotitie'),confirmedFacts:confirmedCallFacts(game,entry)};}
export function makeLiveCall(game,entry,{clientId,outputId,character,presenter,context,maxSeconds=90},now=Date.now()){
 if(!Number.isInteger(maxSeconds)||maxSeconds<30||maxSeconds>180)throw livekitError('Kies een gespreksduur van 30 tot 180 seconden.',400);
 return {id:crypto.randomUUID(),transport:'livekit',gameId:game.id,brandId:game.brandId,entryId:entry.id,accountId:entry.accountId,profileId:entry.profileId,name:entry.name,hostId:clientId,outputId,presenter,characterId:character.id,characterName:character.name,realtimeVoice:character.realtimeVoice,context:callContext(context,entry,game),phase:'preparing',outcome:null,reason:'',createdAt:now,updatedAt:now,maxSeconds,muted:false,drawHeld:true,checkpoint:{id:crypto.randomUUID(),...(game.brandId==='milo'?{paused:game.state.paused===true}:{}),epoch:game.state.epoch,drawnCount:game.state.drawn.length,lastNumber:game.state.drawn.at(-1)??null,drawn:[...game.state.drawn]},checks:{hostConnected:false,playerConnected:false,outputConnected:false,soundChecked:false,explanationGiven:false},media:{host:{connected:false,micReady:false},player:{connected:false,micReady:false},output:{connected:false,audioReady:false}},returnState:{playerConfirmedAt:null,hostConfirmedAt:null,method:null,note:''},seen:{host:now,output:now},ops:[]};
}
export function returnLiveCall(c,outcome='ended',reason='',now=Date.now()){
 if(c.phase==='completed')return c;
 c.neverEnteredCall=!c.heardCheckpointAt;const cueId=crypto.randomUUID(),cueCode=cueId.slice(0,4).toUpperCase();
 c.phase='returning';c.voiceLevel=0;c.outcome=outcome;c.reason=reason;c.endedAt=now;c.updatedAt=now;c.drawHeld=true;c.returnState={playerConfirmedAt:null,hostConfirmedAt:null,method:null,note:'',...(c.brandId==='milo'?{}:{cue:{id:cueId,lastNumber:c.checkpoint.lastNumber,text:`Terug bij de show, controlewoord ${cueCode}. Het laatste officiële nummer is ${c.checkpoint.lastNumber??'nog niet getrokken'}.`}})};return c;
}
export function transitionLiveCall(c,action,role,body={},now=Date.now()){
 if(c.brandId!=='milo'&&['agree-live','magic-ready','magic-choice','magic-played','thank'].includes(action))throw livekitError('Deze belstap hoort bij Milo.');
 const need=(roles,phases)=>{if(!roles.includes(role)||!phases.includes(c.phase))throw livekitError('Deze belstap kan nu niet.');};
 if(action==='ring'){need(['host'],['preparing']);c.phase='ringing';c.ringUntil=now+90000;}
 else if(action==='answer'){
  need(['player'],['ringing']);if(c.ringUntil<=now)throw livekitError('Deze oproep is verlopen.');
  if(body.checkpointId!==c.checkpoint.id||c.brandId!=='milo'&&(body.heardLastNumber!==c.checkpoint.lastNumber||body.cardsUpdated!==true||body.youtubeMuted!==true))throw livekitError('Hoor eerst het laatste getrokken nummer, werk de kaart bij en demp YouTube voordat je opneemt.');
  if(c.playerClientId&&c.playerClientId!==body.clientId)throw livekitError('Deze oproep is al op een ander apparaat opgenomen.');
  c.playerClientId=body.clientId;c.seen.player=now;c.phase='backstage';c.heardCheckpointAt=now;
 }
 else if(action==='backstage-ready'){
  need(['host'],['backstage']);if(c.brandId==='milo'){if(!c.media.player.connected||!c.media.player.micReady||!c.media.host.connected||!c.media.host.playerTrackReceived)throw livekitError('De microfoonverbinding van het gezin is nog niet ontvangen. Herstel de verbinding of sla het belmoment over.');c.checks.soundChecked=true;c.checks.explanationGiven=true;}else if(body.soundChecked!==true||body.explanationGiven!==true||!c.media.host.connected||!c.media.host.micReady||!c.media.player.connected||!c.media.player.micReady)throw livekitError('Controleer eerst beide verbindingen, het geluid en de uitleg achter de schermen.');
  c.checks.soundChecked=true;c.checks.explanationGiven=true;
 }
 else if(action==='stage'){need(['host'],['backstage']);if(!c.checks.soundChecked||!c.checks.explanationGiven)throw livekitError('Rond eerst het privé-voorgesprek af.');c.phase='staged';}
 else if(action==='agree-live'){need(['player'],['backstage','staged']);if(body.agreed!==true)throw livekitError('Bevestig eerst dat dit kind hoorbaar in de uitzending mag.');c.liveAgreement={agreedAt:now,profileId:c.profileId};}
 else if(action==='magic-ready'){need(['host','output'],['live']);c.magicReadyAt??=now;}
 else if(action==='magic-choice'){need(['host','player'],['live']);if(!c.magicReadyAt||!['stars','bubbles'].includes(body.choice))throw livekitError('Wacht op de begroeting en kies sterren of bellen.');if(!c.magic)c.magic={id:crypto.randomUUID(),choice:body.choice,chosenAt:now,effectId:'call-'+body.choice};}
 else if(action==='magic-played'){need(['output'],['live']);if(!c.magic||body.magicId!==c.magic.id||body.effectId!==c.magic.effectId||!c.magic.effectClaim)throw livekitError('Deze toverkeuze hoort niet bij dit gesprek.');c.magic.playedAt??=now;}
 else if(action==='go-live'){
  need(['host'],['staged']);if(c.brandId==='milo'&&!c.liveAgreement?.agreedAt)throw livekitError('Het gezin moet eerst afzonderlijk toestemming voor live in de uitzending geven.');if(body.contextConfirmed!==true||!c.checks.soundChecked||!c.checks.explanationGiven||!c.media.host.connected||!c.media.player.connected||c.mediaRevokedAt)throw livekitError('Controleer de gastkaart en de verbinding vóór Live met de presentator.');
  c.phase='live';c.voiceLevel=0;c.liveAt=now;c.liveUntil=now+c.maxSeconds*1000;c.activeContext=structuredClone(c.context);c.media.host={connected:false,micReady:false};c.media.player={connected:false,micReady:false};c.media.output={connected:false,audioReady:false};
 }
 else if(action==='mute'){need(['host'],['live']);c.muted=body.muted===true;}
 else if(action==='ai-mute'){need(['host'],['live']);c.aiMuted=body.muted===true;}
 else if(action==='thank'){need(['host'],['live']);if(c.mode!=='prepared')throw livekitError('Rond dit spontane gesprek via de regie af.');c.outroRequestedAt??=now;}
 else if(action==='finish'){need(c.outroRequestedAt?['host','player','output']:['host','player'],['backstage','staged','live']);returnLiveCall(c,'ended','Het gesprek is afgerond. Controleer nu de terugkeer naar YouTube.',now);}
 else if(action==='decline'){need(['player'],['preparing','ringing']);returnLiveCall(c,'declined','De deelnemer heeft de oproep geweigerd.',now);}
 else if(action==='cancel'){need(['host','player'],['preparing','ringing','backstage','staged','live']);returnLiveCall(c,'cancelled','Het belmoment is geannuleerd. De trekking blijft geblokkeerd.',now);}
 else if(action==='fail'){need(['host','player','output'],['preparing','ringing','backstage','staged','live']);returnLiveCall(c,'failed',clean(body.reason||'De verbinding is onderbroken.',200,'de foutmelding'),now);}
 else if(action==='player-returned'){
  need(['player'],['returning']);if(c.brandId==='milo'){if(body.confirmed!==true||!c.resourcesClosed)throw livekitError('Wacht tot het gespreksgeluid veilig is afgesloten.');c.returnState.playerConfirmedAt=now;c.returnState.method='call-audio-closed';c.updatedAt=now;return c;}const info=body.playbackInfo||{},ready=body.youtubeReady===true||info.ready===true,audible=body.youtubeAudible===true||info.audible===true;
  if(body.checkpointId!==c.checkpoint.id||body.confirmed!==true||!ready||!audible)throw livekitError('Controleer dat de YouTube-uitzending weer zichtbaar en hoorbaar is.');
  const neverLeft=c.brandId==='milo'&&c.neverEnteredCall===true&&body.neverLeftViewing===true&&info.source==='never-left-viewing-and-parent-confirmation'&&info.neverLeftViewing===true&&info.heardLastNumber===c.checkpoint.lastNumber&&info.cardsUpdated===true&&info.apiAvailable===true&&info.playerState===1&&info.muted===false&&info.volume>0&&info.normalShowConfirmed===true&&info.observedAt>=c.endedAt&&info.observedAt<=now+5000&&now-info.observedAt<=15000;
  const measured=Number.isFinite(info.currentTime)&&Number.isFinite(info.duration)&&info.duration>0;
  if(measured&&!neverLeft&&info.duration-info.currentTime>5)throw livekitError('Je kijkt nog achter het livepunt. Spring eerst naar live en controleer de actuele terugkeercue.');
  const seek=info.liveSeek,livePoint=info.source==='youtube-live-seek-and-parent-confirmation'&&measured&&seek&&Number.isFinite(seek.target)&&Math.abs(info.duration-seek.target)<=5&&Math.abs(info.currentTime-seek.target)<=5&&seek.requestedAt>=c.endedAt&&info.observedAt>=seek.requestedAt&&info.observedAt<=now+5000&&now-info.observedAt<=15000;
  const cue=c.returnState.cue,confirmedCue=info.source==='current-cue-and-parent-confirmation'&&info.normalShowConfirmed===true&&info.heardCurrentCue===true&&cue?.publishedAt>=c.endedAt&&cue?.id===info.cueId&&cue.lastNumber===info.cueLastNumber;
  if(!livePoint&&!confirmedCue&&!neverLeft)throw livekitError('Afspelen en geluid bewijzen het livepunt niet. Controleer de actuele terugkeercue of laat de regie gericht controleren.');
  c.returnState.playerConfirmedAt=now;c.returnState.method=neverLeft?'player-never-left':livePoint?'player-live-seek':'player-current-cue';
 }
 else if(action==='confirm-return'){
  need(['host'],['returning']);if(body.confirmed!==true)throw livekitError('Bevestig de terugkeer naar de uitzending.');
  if(c.brandId==='milo'){if(!c.resourcesClosed)throw livekitError('Wacht tot alle gespreksverbindingen veilig gesloten zijn.');c.returnState.method='host-audio-closed';}else if(!c.returnState.playerConfirmedAt){if(body.manual!==true||typeof body.note!=='string'||body.note.trim().length<10||body.note.length>300)throw livekitError('Wacht op bevestiging van de deelnemer, of noteer hoe je de terugkeer handmatig hebt gecontroleerd.');c.returnState.method='host-manual';c.returnState.note=body.note.trim();}
  c.returnState.hostConfirmedAt=now;c.phase='returned';
 }
 else if(action==='resume-draw'){need(['host'],['returned']);if(!c.returnState.hostConfirmedAt)throw livekitError('Controleer eerst de terugkeer.');c.phase='completed';c.drawHeld=false;c.completedAt=now;}
 else if(action==='heartbeat'){
  if(c.phase==='completed')return c;
  c.seen[role]=now;
  if(['backstage','staged','live'].includes(c.phase)){
   const target=c.phase==='live'?'live':'backstage';if(body.target===target){c.media[role]={connected:body.connected===true,micReady:body.micReady===true,audioReady:body.audioReady===true,...(role==='host'&&c.brandId==='milo'?{playerTrackReceived:body.playerTrackReceived===true}:{})};c.checks[role+'Connected']=body.connected===true;if(role==='output')c.voiceLevel=Number.isFinite(body.voiceLevel)?Math.max(0,Math.min(1,body.voiceLevel)):0;}
   if(body.failed===true&&!c.switchingLive)returnLiveCall(c,'failed','De audioverbinding is weggevallen. Controleer de terugkeer; de trekking blijft geblokkeerd.',now);
  }
 }
 else throw livekitError('Onbekende belactie.',400);
 c.updatedAt=now;return c;
}
export function expireLiveCall(c,now=Date.now()){
 if(!liveCallActive(c)||['returning','returned'].includes(c.phase))return false;
 if(c.phase==='ringing'&&now>=c.ringUntil){returnLiveCall(c,'missed','Er is niet opgenomen. Controleer de terugkeer voordat je hervat.',now);return true;}
 if(c.phase==='live'&&now>=c.liveUntil){returnLiveCall(c,'ended','De ingestelde gespreksduur is verstreken.',now);return true;}
 if(now-c.createdAt>600000||now-(c.seen.host||c.createdAt)>20000||['backstage','staged','live'].includes(c.phase)&&now-(c.seen.player||c.createdAt)>20000||c.phase==='live'&&now-(c.seen.output||c.createdAt)>20000){returnLiveCall(c,'failed','Een verbinding of de voorbereiding is verlopen. De trekking blijft geblokkeerd.',now);return true;}
 return false;
}
export function publicLiveCall(c,role){
 if(!c||c.transport!=='livekit')return null;
 const fields=['id','version','transport','gameId','brandId','entryId','profileId','name','characterId','characterName','realtimeVoice','speechEngine','phase','outcome','reason','createdAt','updatedAt','maxSeconds','ringUntil','liveUntil','muted','aiMuted','drawHeld','checkpoint','checks','returnState','media','completedAt','liveAt','endedAt','realtimeStatus','realtimeStopped','voiceLevel','source','cueId','mode','resumeTarget','liveAgreement','magicReadyAt','magic','neverEnteredCall','outroRequestedAt','heardCheckpointAt','sourceBlockId','preparedLines','mediaRevokedAt','emergencyRecovery'];
 const out=Object.fromEntries(fields.filter(k=>c[k]!==undefined).map(k=>[k,structuredClone(c[k])])),context=structuredClone(c.activeContext||c.context);if(role!=='host'){delete context.note;if(out.returnState)delete out.returnState.note;}out.context=context;return {...out,...callIdentities(c)};
}
