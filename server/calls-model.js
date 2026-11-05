export const CALL_TERMINAL = ['ended','declined','missed','failed'];
export const CALL_ON_AIR = ['announcing','ringing','live','wrapping','closing','unanswered'];
export const callActive = c => !!c && !CALL_TERMINAL.includes(c.phase);
export const callError = (message,status=409) => Object.assign(new Error(message),{status,code:'call_state'});
export function transitionCall(c,action,role,body={},now=Date.now()) {
 const need=(roles,phases)=>{if(!roles.includes(role)||!phases.includes(c.phase))throw callError('Deze belactie kan nu niet.');};
 if(action==='connect') {need(['player'],['checking']);if(c.playerClientId&&c.playerClientId!==body.clientId)throw callError('Het gesprek is al op een ander apparaat geopend.');c.playerClientId=body.clientId;c.playerSeen=now;}
 else if(action==='heard') {need(['player'],['checking']);c.heard=true;}
 else if(action==='ready') {need(['host'],['checking']);if(!c.peerConnected||!c.heard||!c.micDetected)throw callError('Wacht op de verbinding, microfoonsignaal en de bevestigde testtoon.');c.phase='ready';}
 else if(action==='ring') {need(['host'],['ready']);c.phase='announcing';c.announceAt=now;}
 else if(action==='intro-done') {need(['output'],['announcing']);c.phase='ringing';c.ringUntil=now+30000;}
 else if(action==='answer') {need(['player'],['ringing']);if(c.ringUntil<=now)throw callError('Deze oproep is verlopen.');if(!c.peerConnected)throw callError('De geluidsverbinding is weggevallen.');c.phase='live';c.liveAt=now;c.liveUntil=now+c.maxSeconds*1000;}
 else if(action==='finish') {need(['host'],['live','wrapping']);if(c.phase==='live'){c.phase='wrapping';c.wrapUntil=now+15000;}}
 else if(action==='goodbye-done') {need(['output'],['wrapping']);c.phase='closing';c.closeAt=Math.min(now+2500,c.wrapUntil);}
 else if(action==='missed-done') {need(['output'],['unanswered']);c.phase=c.outcome||'missed';c.endedAt=now;c.outroDone=true;}
 else if(action==='mute') {need(['host'],['live']);c.muted=!!body.muted;}
 else if(action==='stop-voice') {need(['host'],['live']);c.stopVoice=(c.stopVoice||0)+1;}
 else if(action==='decline') {need(['player'],['checking','ready','announcing','ringing']);const onAir=['announcing','ringing'].includes(c.phase);c.phase=onAir?'unanswered':'declined';c.outcome='declined';c.outroUntil=now+10000;c.endedAt=now;c.reason='De speler neemt deze oproep niet aan.';}
 else if(action==='stop') {need(['host','player','output'],['checking','ready',...CALL_ON_AIR]);c.phase=body.failed?'failed':'ended';c.endedAt=now;c.reason=body.failed?'De verbinding is onderbroken. Controleer het geluid voordat je opnieuw belt.':'Het gesprek is beëindigd.';}
 else throw callError('Onbekende belactie.',400);
 c.updatedAt=now;return c;
}
export function expireCall(c,{now=Date.now(),allowed=true,outputAlive=true,hostAlive=true}={}) {
 if(!callActive(c))return false;
 let reason='';
 if(!allowed)reason='De aanmelding is ingetrokken of de show is afgelopen.';
 else if(!outputAlive||!hostAlive)reason='De regie- of uitzendverbinding is weggevallen.';
 else if(c.playerSeen&&now-c.playerSeen>12000)reason='De verbinding met de speler is weggevallen.';
 else if(now-c.createdAt>600000)reason='De voorbereiding is verlopen.';
 else if(c.phase==='announcing'&&now-c.announceAt>45000)reason='Vlampie kon de oproep niet starten.';
 if(reason){Object.assign(c,{phase:'failed',reason,endedAt:now,updatedAt:now});return true;}
 if(c.phase==='ringing'&&now>=c.ringUntil){Object.assign(c,{phase:'unanswered',outcome:'missed',outroUntil:now+10000,reason:'Er is niet opgenomen.',updatedAt:now});return true;}
 if(c.phase==='unanswered'&&now>=c.outroUntil){Object.assign(c,{phase:c.outcome||'missed',endedAt:now,updatedAt:now});return true;}
 if(c.phase==='live'&&now>=c.liveUntil){Object.assign(c,{phase:'wrapping',wrapUntil:now+15000,updatedAt:now});return true;}
 if(c.phase==='wrapping'&&now>=c.wrapUntil||c.phase==='closing'&&now>=c.closeAt){Object.assign(c,{phase:'ended',reason:'Vlampie heeft afscheid genomen.',endedAt:now,updatedAt:now});return true;}
 return false;
}
export function publicCall(c,role) {
 if(!c)return null;
 const fields=['version','id','brandId','characterId','characterName','characterRevision','realtimeVoice','gameId','entryId','profileId','name','phase','createdAt','updatedAt','maxSeconds','liveAt','liveUntil','ringUntil','wrapUntil','closeAt','endedAt','reason','outroUntil','heard','peerConnected','micDetected','micLevel','voiceLevel','muted','stopVoice','outroDone'];
 const out=Object.fromEntries(fields.filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));
 if(role==='output'){out.offer=c.offer||null;out.playerClientId=c.playerClientId||null;}
 if(role==='player')out.answer=c.answer||null;
 return out;
}
