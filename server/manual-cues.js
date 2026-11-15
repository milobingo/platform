// These checks only guard prepared announcements. Official game state remains
// the authority; playing a cue never opens, confirms or resumes a prize step.
export const MANUAL_CUE_CONDITIONS=Object.freeze({
 always:'Vrij moment of reserve',
 'window-open':'Meldvenster is nog open',
 checking:'Meldingen worden gecontroleerd',
 'no-valid-bingo':'Geen geldige bingo in het gesloten meldvenster',
 'confirmed-bingo':'Prijsstap officieel bevestigd; volgende opdracht volgt',
 'confirmed-tie':'Officiële gelijke vroegste bingo',
 'confirmed-consolation':'Troostprijs officieel bevestigd',
 'confirmed-finale':'Finaleprijs officieel bevestigd',
 'round-transition':'Volgende prijsstap binnen dezelfde ronde',
 'round-complete':'Volle kaart en ronde vóór de finale officieel afgerond',
 'call-held':'Trekking geblokkeerd voor een belmoment',
});

// Official bingo/result/call holds already stop drawing. They do not need a
// second manual pause in order to explain what is happening to the audience.
export const manualCuePlaybackHeld=game=>!!(game?.state?.paused||game?.state?.window?.status==='open'||game?.state?.resultId||game?.state?.drawHold);

const confirmedConditions=['confirmed-finale','round-complete','confirmed-bingo','confirmed-consolation'];
// Preview only the already selected server result's acknowledgement. This
// chooses a presentation route, never a winner, prize or replacement result.
export function resultSpeakingCues(game){
 const result=game?.results?.find(item=>item.id===game.state?.resultId);
 if(!result||result.type!=='bingo'||result.acknowledged||!game.state.goalWon||game.state.window?.status==='open')return [];
 const projected={...game,state:{...game.state,resultId:null},results:game.results.map(item=>item.id===result.id?{...item,acknowledged:true}:item)};
 return (game.plan.manualCues||[]).filter(cue=>confirmedConditions.includes(cue.condition)&&manualCueAvailability(cue,projected).allowed).sort((a,b)=>confirmedConditions.indexOf(a.condition)-confirmedConditions.indexOf(b.condition));
}

export function manualCueAvailability(cue,game,now=Date.now()){
 const denied=reason=>({allowed:false,reason}),allowed={allowed:true,reason:''};
 if(!game||!cue)return denied('Kies eerst een opgeslagen show en een microfoontekst.');
 if(game.cancelledAt||game.cancellation||game.status==='finished')return denied('Deze show is afgelopen. De presentator blijft stil.');
 const condition=cue.condition||'always';
 if(!Object.hasOwn(MANUAL_CUE_CONDITIONS,condition))return denied('Kies een beschikbare afspeelvoorwaarde.');
 const s=game.state||{},rounds=game.plan?.blocks?.filter(block=>block.type==='round')||[],round=rounds[s.roundIndex],lastGoal=!!round&&s.goalIndex===round.goals.length-1;
 if(cue.roundIndex!==undefined&&cue.roundIndex!==s.roundIndex)return denied('Deze tekst hoort bij een andere ronde.');
 if(cue.goalIndex!==undefined&&cue.goalIndex!==s.goalIndex)return denied('Deze tekst hoort bij een andere prijsstap.');
 if(condition==='always')return allowed;
 if(game.status!=='running')return denied('Start eerst de show; deze tekst volgt de officiële spelstand.');
 const window=s.window,currentWindow=!!window&&(!window.epoch||window.epoch===s.epoch),open=currentWindow&&window.status==='open'&&Number.isFinite(window.endsAt)&&now<window.endsAt;
 const results=(game.results||[]).filter(result=>result.type==='bingo'&&result.roundIndex===s.roundIndex&&result.goalIndex===s.goalIndex),result=results.find(result=>result.id===s.resultId)||results.findLast(result=>result.acknowledged===true),confirmed=!!result&&result.acknowledged===true&&s.goalWon===true;
 if(condition==='window-open')return open?allowed:denied('Het officiële meldvenster is niet meer open.');
 if(condition==='checking')return currentWindow&&(window.status==='open'||window.status==='closed')&&(open||!!s.resultId)?allowed:denied('Er is nu geen actieve bingocontrole.');
 if(condition==='no-valid-bingo')return currentWindow&&window.status==='closed'&&Array.isArray(window.claims)&&!window.claims.some(claim=>claim.status==='valid')&&!s.resultId&&!s.goalWon&&s.phase==='running'?allowed:denied('De server heeft geen gesloten meldvenster zonder geldige bingo bevestigd.');
 if(condition==='confirmed-bingo')return confirmed&&!lastGoal?allowed:denied('Bevestig eerst de officiële prijsstap. Gebruik na de volle kaart de tekst voor een afgeronde ronde.');
 if(condition==='confirmed-tie')return currentWindow&&window.status==='closed'&&!!s.resultId&&result?.id===s.resultId&&result.entrants?.length>1?allowed:denied('De server heeft nu geen gelijke vroegste bingo bevestigd.');
 if(condition==='confirmed-consolation')return confirmed&&game.settings?.consolationEnabled===true&&result.consolations?.length>0?allowed:denied('Er is bij deze prijsstap geen officieel bevestigde troostprijs.');
 if(condition==='confirmed-finale')return confirmed&&lastGoal&&s.roundIndex===rounds.length-1?allowed:denied('Bevestig eerst de officiële uitslag van de finalekaart.');
 if(condition==='round-complete')return confirmed&&lastGoal&&s.roundIndex<rounds.length-1?allowed:denied('Bevestig eerst de volle kaart van een gewone ronde. Gebruik na de finalekaart de finaletekst.');
 if(condition==='round-transition'){
  const previous=(game.results||[]).some(result=>result.type==='bingo'&&result.acknowledged===true&&result.roundIndex===s.roundIndex&&result.goalIndex===s.goalIndex-1);
  return !!round&&s.goalIndex>0&&previous&&!s.goalWon&&!s.resultId&&window?.status!=='open'?allowed:denied('Deze patroonwissel volgt pas na de bevestigde vorige prijsstap.');
 }
 if(condition==='call-held')return s.drawHold?allowed:denied('Blokkeer de trekking eerst via het belmoment.');
 return denied('Deze tekst is nu niet beschikbaar.');
}
