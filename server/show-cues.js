// One cue library for the planner, live regie and broadcast renderer. Times are seconds.
export const SHOW_CUES=Object.freeze([
 {id:'welcome-wave',title:'Welkom op het Sterrenplein',description:'Een warme zwaai in een zacht fonkelende spotlight.',duration:6,motion:'wave',camera:'host',sound:'friendly',effect:'starlight',color:'#f7cf76',shots:[{at:0,camera:'establish'},{at:1.4,camera:'host'}]},
 {id:'applause',title:'Een groot klein applaus',description:'De presentator klapt mee terwijl gouden confetti langs het podium dwarrelt.',duration:7,motion:'clap',camera:'wide',sound:'applause',effect:'confetti',color:'#f7cf76'},
 {id:'dance',title:'Het Sterrenplein-dansje',description:'Een vrolijk ritme, dansende schouders en zwevende muzieknoten.',duration:8,motion:'dance',camera:'wide',sound:'round',effect:'notes',color:'#82e3dc',shots:[{at:0,camera:'wide'},{at:2.2,camera:'duo'}]},
 {id:'wonder',title:'Oeps… bubbels!',description:'Een verbaasde blik: lichtgevende bubbels stijgen op rond de desk.',duration:6,motion:'surprise',camera:'host',sound:'friendly',effect:'bubbles',color:'#ad8be8'},
 {id:'star-shower',title:'De sterrenregen',description:'Een sierlijk magisch gebaar laat een gouden sterrenregen verschijnen.',duration:9,motion:'magic',camera:'wide',sound:'prize',effect:'stars',color:'#f7cf76',shots:[{at:0,camera:'wide'},{at:6.7,camera:'host'}]},
 {id:'magic-orbit',title:'De sterrenwervel',description:'Een zwevende ster draait in gouden en turquoise banen naast de presentator.',duration:12,motion:'magic',camera:'magic',sound:'prize',effect:'orbit',color:'#82e3dc',shots:[{at:0,camera:'wide'},{at:2,camera:'magic'},{at:8.7,camera:'wide'}]},
 {id:'curtain-call',title:'Het grote slotapplaus',description:'Een buiging, warme podiumlichten en een feestelijke confettifinale.',duration:10,motion:'bow',camera:'wide',sound:'finale',effect:'confetti',color:'#d5a9ff',shots:[{at:0,camera:'host'},{at:2.5,camera:'wide'}]},
 {id:'portal-arrival',title:'Een teken uit de sterrenpoort',description:'De sterrenpoort licht op: de presentator begroet een magische verrassing.',duration:8,motion:'welcome',camera:'guest',sound:'friendly',effect:'portal',color:'#82e3dc',shots:[{at:0,camera:'wide'},{at:1.5,camera:'guest'},{at:5.8,camera:'wide'}]},
].map(cue=>Object.freeze({...cue,...(cue.shots?{shots:Object.freeze(cue.shots.map(shot=>Object.freeze(shot)))}:{})})));
export const SHOW_CUE_IDS=Object.freeze(SHOW_CUES.map(cue=>cue.id));
export const getShowCue=id=>SHOW_CUES.find(cue=>cue.id===id)||null;
export const MOTION_CUES=Object.freeze([
 {id:'wave',title:'Zwaaien',duration:4.8},{id:'point',title:'Aanwijzen',duration:3.6},
 {id:'think',title:'Even nadenken',duration:4},{id:'cheer',title:'Juichen',duration:4.5},
 {id:'bow',title:'Een buiging',duration:4.2},{id:'clap',title:'Applaudisseren',duration:5},
 {id:'dance',title:'Dansje',duration:6},{id:'surprise',title:'Verbaasd',duration:3.5},
 {id:'listen',title:'Aandachtig luisteren',duration:4.5},
].map(cue=>Object.freeze(cue)));
