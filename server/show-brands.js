import {CHARACTERS} from './characters.js';
// The sole registry of trusted identities. IDs never change account or game ownership.
export const SHOW_BRANDS=Object.freeze({
 vlampie:{id:'vlampie',name:'Vlampie',short:'Vlampie',title:'Vlampie’s Bingo',studio:'Grand Show',theme:'showtime',logo:'/assets/studio-logo.png',mascot:'/assets/vlampie-illustrated-v10.png',palette:{base:'#08152d',surface:'#112644',accent:'#edc77f',secondary:'#82b4ee',ink:'#fff8eb'},persona:'Je bent Vlampie, een warme, enthousiaste jonge digitale bingopresentator. Je bent vrolijk, spontaan en speels.',voiceStyle:'Warm, jong, levendig en enthousiast, met een glimlach in je stem.',intro:'Hallo allemaal! Ik ben Vlampie. Welkom bij onze gezellige bingoavond!',signature:'Samen spelen. Samen vieren.',mention:'@Vlampie'},
 rocco:{id:'rocco',archived:true,name:'Rocco Royale',short:'Rocco',title:'Rocco Royale Bingo',studio:'The Royale Theatre',theme:'royale',logo:'/assets/hosts/rocco-logo.png',mascot:'/assets/hosts/rocco-mascot.png',palette:{base:'#07151c',surface:'#122c36',accent:'#e6c98e',secondary:'#8ac5ca',ink:'#fff9ed'},persona:'Je bent Rocco Royale, een stijlvolle oranje vos en digitale bingohost van het Royale Theatre. Je bent charmant en zelfverzekerd, met warme droge humor en een ondeugende knipoog. Gebruik af en toe een korte theaterverwijzing. Je geeft iedereen het gevoel een eregast te zijn. Geen casino- of gokverkooptaal.',voiceStyle:'Een soepele, warme mannelijke showstem. Charmant, ontspannen en trefzeker; een lichte ondeugende glimlach, elegante pauzes en een energieke finale.',intro:'Goedenavond, eregasten! Rocco Royale hier. Het doek gaat open, de kaarten liggen klaar. Tijd voor een schitterende show!',signature:'Jouw avond in de spotlights.',mention:'@Rocco'},
 milo:{id:'milo',name:'Milo Magico',short:'Milo',title:'Milo & Friends BingoShow',studio:'Sterrenplein',theme:'magico',logo:'/assets/milo-friends/logo.png',mascot:'/assets/milo-friends/characters/milo.png',palette:{base:'#160c29',surface:'#2c1841',accent:'#eed198',secondary:'#77ded6',ink:'#fff5ef'},persona:'Je bent Milo Magico, een nieuwsgierige wasbeer-goochelaar en digitale bingohost van Milo & Friends BingoShow op het Sterrenplein. Je bent warm, speels, verwonderd en grappig. Gebruik af en toe een korte magische beeldspraak, zonder steeds dezelfde spreuk. Je goocheltrucs zijn show; je beweert nooit de loting of uitslag te kunnen beïnvloeden.',voiceStyle:'Een warme, sprankelende jonge mannelijke stem. Nieuwsgierig en verwonderd, met speelse timing, een zacht geheimzinnig begin en heldere enthousiaste onthullingen.',intro:'Hallo lieve spelers! Ik ben Milo Magico. De sterren staan klaar en mijn hoge hoed ook. Welke mooie momenten toveren we vandaag tevoorschijn?',signature:'Een avond vol verwondering.',mention:'@Milo'}
});
export const BRAND_IDS=Object.freeze(Object.keys(SHOW_BRANDS));
export function brandId(value){const id=typeof value==='string'?value:value?.brandId||value?.presentationSnapshot?.profile?.brandId||value?.id;return BRAND_IDS.includes(id)?id:'vlampie';}
export function showBrand(value){return SHOW_BRANDS[brandId(value)];}
export function validBrand(value){if(!BRAND_IDS.includes(value))throw Object.assign(new Error('Kies Vlampie, Rocco Royale of Milo Magico.'),{status:400,code:'brand'});return value;}
export function brandText(value,identity){const b=showBrand(identity);value=String(value??'').replace(/Rocco Royale Bingo|Milo Magico Bingo/g,'Vlampie’s Bingo').replace(/ROCCO ROYALE BINGO|MILO MAGICO BINGO/g,'VLAMPIE’S BINGO').replace(/Rocco Royale|Milo Magico/g,'Vlampie').replace(/ROCCO ROYALE|MILO MAGICO/g,'VLAMPIE').replace(/@Rocco(?:\s+Royale)?\b|@Milo(?:\s+Magico)?\b/gi,'@Vlampie');if(b.id==='vlampie')return value;return value.replace(/VLAMPIE[’']?S BINGOSHOW/g,b.title.toUpperCase()).replace(/Vlampie[’']?s (?:Bingoshow|Bingo)/g,b.title).replace(/VLAMPIE[’']?S BINGO/g,b.title.toUpperCase()).replace(/Vlampie[’']s/g,b.short+'s').replace(/VLAMPIE[’']?S/g,b.short.toUpperCase()+'S').replace(/Vlampie/g,b.name).replace(/VLAMPIE/g,b.name.toUpperCase());}
export function brandProfile(profile,identity){const b=showBrand(identity??profile);return {...profile,name:b.id==='milo'&&['Vlampie Grand Show','Vlampies Sinterklaasfeest'].includes(profile?.name)?'Milo & Friends · Sterrenplein':profile?.name,prompt:b.id!=='vlampie'&&['Maak er een gezellige pakjesavond van, met warme humor over pakjes, kruidnoten en de vrolijke drukte in de studio.','Presenteer een feestelijke familieshow. Wees spontaan, opgewekt en speels. Geef verschillende deelnemers aandacht.'].includes(profile?.prompt)?b.persona:profile?.prompt,brandId:b.id,theme:b.id==='vlampie'?(['showtime','sinterklaas'].includes(profile?.theme)?profile.theme:'showtime'):b.theme};}
export function gameTheme(game){return brandProfile(game?.presentationSnapshot?.profile,game).theme;}
export function brandMention(text,identity){const b=showBrand(identity);return new RegExp('@(?:'+(b.id==='vlampie'?'vlampie':b.id==='rocco'?'rocco(?:\\s*royale)?':'milo(?:\\s*magico)?')+'|host)\\b','i').test(String(text));}
const gameTitles={rocco:['Het Royale Rad','De Prijzenparade','De Gouden Bingobal','De Royale Derby','De Bonbonrace','Naar de Sterren','De Grand Regatta','Het Prijzenparcours','De Ballonnenrevue','De Royale Flipperkast','De Gouden Dansvloer','Plingo Royale'],milo:['Het Magische Rad','De Wonderdozen','De Gouden Toverbal','De Betoverde Derby','De Tovertruffelrace','Naar de Maan','De Maanlichtregatta','De Geheime Doorgangen','De Zwevende Ballonnen','De Magische Flipperkast','De Sterrenvloer','Milo’s Sterrenplingo','Het Lintenlabyrint','Het Spiegelpaleis','De Bruisende Toverdrank','De Keuze van de Sterrenvlinder']};
const gameIds=['wheel','gifts','gold','horses','cookies','rockets','boats','chimneys','balloons','pinball','disco','plingo','ribbons','mirrors','potion','butterfly'];
export function brandGameName(game,identity){const b=showBrand(identity),i=gameIds.indexOf(game.id);return gameTitles[b.id]?.[i]||game.name;}
const miloGameDescriptions={gifts:'Volg jouw wonderdoos tijdens de wissels. Eén deksel opent voor de winnaar.',cookies:'Rollende tovertruffels springen over schansen en laten een magisch spoor achter.',boats:'Maanlichtbootjes zoeken de snelle stroming en varen naar de sterrenhaven.',chimneys:'Lichtgevende verrassingen volgen geheime doorgangen naar de gouden schatkist.'};
export function brandGameDescription(game,identity){return brandId(identity)==='milo'?(miloGameDescriptions[game.id]||game.description):game.description;}
const baseWelcome='Hallo allemaal! Welkom bij Vlampie’s pakjesavondbingo! Leg je kaarten klaar en speel gezellig mee.';
export function switchPlanBrand(plan,previous,next){const old=showBrand(previous),b=showBrand(next),copy=structuredClone(plan);if(copy.title===old.title||copy.title==='Vlampie’s Bingo')copy.title=b.title;for(const block of copy.blocks||[]){if(block.type==='welcome'&&[old.intro,baseWelcome,'Hallo allemaal! Welkom bij Vlampie’s Bingo. Pak je kaart erbij, we maken er een gezellige show van!'].includes(block.text))block.text=b.id==='vlampie'?baseWelcome:b.intro;if(block.title==='Welkom bij '+old.name||block.title==='Welkom bij Vlampie')block.title='Welkom bij '+b.name;if(block.type==='pause'&&['Pakjespauze','Theaterpauze','Magische pauze'].includes(block.title))block.title=b.id==='rocco'?'Theaterpauze':b.id==='milo'?'Magische pauze':'Pakjespauze';if(block.type==='call'&&block.text==='Tijd voor een gezellig moment met '+old.name+'!')block.text='Tijd voor een gezellig moment met '+b.name+'!';}return copy;}
// Compatibility for pre-cast Milo shows. Change only recognized stock copy;
// never insert/remove cues or rewrite a custom story, guest visit or round.
export function repairLegacyPlanBrand(plan,identity){
 const copy=structuredClone(plan);
 if(brandId(identity)!=='milo')return copy;
 const stockWelcome=[baseWelcome,'Hallo allemaal! Welkom bij Vlampie’s Bingo. Pak je kaart erbij, we maken er een gezellige show van!'];
 const inherited=copy.blocks?.some(b=>b.type==='welcome'&&b.title==='Welkom bij Vlampie'&&stockWelcome.includes(b.text));
 if(copy.title==='Vlampie’s Bingo')copy.title=SHOW_BRANDS.milo.title;
 if(!copy.leadId||copy.leadId==='vlampie'&&inherited)copy.leadId='milo';
 if(!copy.studioId||copy.studioId==='magico'||inherited&&['showtime','sinterklaas'].includes(copy.studioId))copy.studioId='sterrenplein';
 for(const b of copy.blocks||[]){
  // An explicitly assigned Vlampie cue is an intentional special guest.
  if(b.speakerId==='vlampie')continue;
  if(b.type==='welcome'){
   if(b.title==='Welkom bij Vlampie'&&stockWelcome.includes(b.text))b.title='Welkom bij Milo & Friends';
   if(stockWelcome.includes(b.text))b.text=copy.leadId==='milo'?SHOW_BRANDS.milo.intro:'Hallo allemaal! Welkom bij Milo & Friends BingoShow op het Sterrenplein. Pak je kaart erbij, we maken er een gezellige show van!';
  }
  if(b.type==='pause'&&b.title==='Pakjespauze')b.title='Magische pauze';
  if(b.type==='call'&&b.text==='Tijd voor een gezellig moment met Vlampie!')b.text=`Tijd voor een gezellig moment met ${CHARACTERS[copy.leadId]?.short||'Milo'}!`;
 }
 return copy;
}
export function brandDefaults(plan,identity){
 const copy=switchPlanBrand(plan,'vlampie',identity);if(brandId(identity)!=='milo')return copy;
 // Called only while making a new show. Existing persisted plans are never rewritten.
 copy.leadId='milo';copy.studioId='sterrenplein';
 const magic=[
  {id:'milo-magic-star-hat',type:'magic',title:'De ster uit Milo’s hoed',speakerId:'milo',magicId:'star-hat',camera:'magic',animation:'magic',duration:14,hold:2,text:'Mijn hoed heeft vandaag een ster verstopt. Kijk goed mee! Daar is hij! Een beetje magie, speciaal voor jullie.'},
  {id:'milo-magic-silk-stars',type:'magic',title:'De dansende sterrenlinten',speakerId:'milo',magicId:'silk-stars',camera:'orbit',animation:'magic',duration:16,hold:2,text:'Mijn sterrenlinten willen even dansen! Eén draai met mijn toverstaf… en daar verschijnen de sterren. De echte bingonummers blijven natuurlijk een verrassing.'},
 ];
 let seen=0;const blocks=[];for(const block of copy.blocks){blocks.push({...block});if(block.type==='round'&&seen<magic.length)blocks.push(magic[seen++]);}
 if(!seen)blocks.splice(Math.min(3,blocks.length),0,...magic);else if(seen===1)blocks.splice(Math.max(0,blocks.length-1),0,magic[1]);
 copy.blocks=blocks;return copy;
}
