import {brandId} from './show-brands.js';
import {automaticRules,isStandardMiloGame,STANDARD_DRAW_INTERVAL_MS,patternRequirement} from './standard-show.js';

// The participation contract comes from the same values used by the game
// server. Editable presentation copy is supplementary and cannot remove it.
const fail=(message,code='rules_unpublished')=>{throw Object.assign(new Error(message),{status:409,code});};
export function rulesContract(game){
 const s=game.settings||{},p=game.production||{};
 return {format:1,gameId:game.id,brandId:brandId(game),
  claimSeconds:s.claimSeconds??30,retroBalls:s.retroBalls??3,cooldownSeconds:s.cooldownSeconds??60,falseLimit:s.falseLimit??3,
  emptyLimit:p.emptyLimit??3,emptyCooldownSeconds:p.emptyCooldownSeconds??120,
  chanceUnit:'book',maxBooksPerAccount:150,maxOrderQuantity:game.ordering?.maxQuantity??30,
  consolationEnabled:s.consolationEnabled===true,consolationPrizeTitle:s.consolationPrizeTitle||'Een kleine verrassing',
  ...(isStandardMiloGame(game)?{drawIntervalSeconds:STANDARD_DRAW_INTERVAL_MS/1000}:{}),
  rounds:(game.plan?.blocks||[]).filter(b=>b.type==='round').map(r=>({id:r.id,title:r.title,goals:r.goals.map(g=>{
   const pattern=game.plan.patterns.find(x=>x.id===g.patternId),prize=game.plan.prizes.find(x=>x.id===g.prizeId);
   return {id:g.id,pattern:pattern?{id:pattern.id,title:pattern.title,cells:[...pattern.cells].sort((a,b)=>a-b),freeCenter:true,variant:pattern.variant||'fixed'}:null,
    prize:prize?{id:prize.id,title:prize.title,description:prize.description||''}:null};
  })}))};
}
export function bindingRules(contract){
 const c=contract;
 return [
  {id:'core-card',title:'De originele kaart en officiële ballen',text:'Iedere ronde heeft een eigen kaart van 5 × 5 met een vrij middenvak. Alleen de 75 unieke, door de spelserver bevestigde ballen tellen. Een voorvertoning of digitaal vinkje telt niet. Binnen dezelfde ronde blijven de getrokken ballen staan tussen prijsstappen.'+(c.drawIntervalSeconds?` Een nieuwe officiële bal volgt na ${c.drawIntervalSeconds} seconden vanaf de vorige officieel getoonde bal. Tijdens meldingen, uitslagen, minigames, een pauze of belblokkade stopt de trekking. Na hervatten begint een nieuwe termijn; gemiste ballen worden niet ingehaald.`:'')},
  {id:'core-order',title:'Rondes, patronen en prijzen',text:c.rounds.map(r=>r.title+': '+r.goals.map(g=>(g.pattern?.title||'Ongeldig patroon')+' → '+(g.prize?.title||'Ontbrekende prijs')+(patternRequirement(g.pattern).startsWith('De bovenste')?' ('+patternRequirement(g.pattern)+')':'')).join('; ')).join('. ')},
  {id:'core-window',title:'Melden en terugkijken',text:`De eerste bevestigde melding stopt de trekking. Het meldvenster duurt ${c.claimSeconds} seconden; op de server-eindtijd is het gesloten. De terugkijkmarge is ${c.retroBalls} trekkingen, inclusief de grens. Kies en bevestig zelf ieder geldig boekje.`},
  {id:'core-priority',title:'Voorrang en eenmalige loting',text:'De vroegste geldige voltooiing wint. Alleen boekjes die op dezelfde vroegste index compleet waren doen mee aan de eenmalig opgeslagen loting: één kans per geldig boekje. Het minigame onthult die winnaar. Verversen geeft geen nieuwe loting. Een boekje mag verschillende prijsstappen winnen; een eerder afgeronde stap wordt niet heropend.'},
  {id:'core-consolation',title:'Troostprijs',text:c.consolationEnabled?`Een latere geldige bingo binnen venster en terugkijkmarge kan ${c.consolationPrizeTitle} krijgen, maximaal één per kind per uitslag. Vroegste finalisten, ook verliezers van de loting, en valse of te late meldingen vallen erbuiten.`:'Er is voor deze show geen troostprijs ingeschakeld.'},
  {id:'core-limits',title:'Boekjes en deelname',text:`Maximaal ${c.maxOrderQuantity} bladen per bestelling en ${c.maxBooksPerAccount} per gezinsaccount. Alleen gekoppelde, toegelaten en niet ingetrokken boekjes doen mee. Een betaalmelding geeft op zichzelf geen speelrecht. Een aparte lotnummerprijs heeft één kans per toegelaten boekje van een niet geblokkeerd account.`},
  {id:'core-sanctions',title:'Valse en onvolledige meldingen',text:`Een inhoudelijk valse bingo geeft ${c.cooldownSeconds} seconden afkoeling voor het hele gezinsaccount; na ${c.falseLimit} valse meldingen blokkeert het account voor deze show tot de regie dit opheft. Na ${c.emptyLimit} bevestigde vensters zonder ingediend boekje geldt ${c.emptyCooldownSeconds} seconden wachten. Een te late kaart, verouderde dialoog, ongeldige autorisatie of identieke retry geeft geen nieuwe valse-bingosanctie.`},
  {id:'core-connection',title:'Verbinding en storingen',text:'Het officiële ballenbord kan vóór de vertraagde video lopen. Bij een storing blijven bevestigde nummers en uitslagen behouden. Bij een belmoment blijft de trekking geblokkeerd tot de terugkeer gecontroleerd is en de regie bewust hervat. Herlaad de familieplek om opnieuw te verbinden; een lokale klok verandert de serverdeadline niet.'},
  {id:'core-objection',title:'Vragen en bezwaar',text:'Meld een probleem bij de organisatie via de familieplek of het bij de show vermelde organisatieadres. Vermeld show, ronde, prijsstap en boekjesnummer. Een gewone regieactie verandert geen definitieve winnaar of eerder uitgereikte prijs; een eventuele correctie vraagt een afzonderlijk vastgelegde beslissing.'},
 ];
}
export function rulesCurrent(game){return !!game.rulesPublication&&JSON.stringify(game.rulesPublication.contract)===JSON.stringify(rulesContract(game));}
export function assertRulesCurrent(game){if(!rulesCurrent(game))fail('De organisatie moet eerst de actuele bindende spelregels publiceren. Deelname en starten wachten daarop.');return game.rulesPublication;}
export function prepareAutomaticRules(game,now=Date.now()){
 if(automaticRules(game)){
  const previous=game.rulesPublication;
  if(previous?.automatic===true&&!previous.finalizedAt&&!rulesCurrent(game)&&!(game.orders||[]).length&&!game.books?.some(book=>book.accountId)){
   const contract=rulesContract(game);game.rulesPublication={...previous,publishedAt:now,contract,rules:bindingRules(contract)};return game.rulesPublication;
  }
  return publishGameRules(game,now,{automatic:true});
 }
 return assertRulesCurrent(game);
}
export function finalizeGameRules(game,now=Date.now()){
 const publication=prepareAutomaticRules(game,now);
 if(automaticRules(game))publication.finalizedAt??=now;
 return publication;
}
export function publishGameRules(game,now=Date.now(),{automatic=false}={}){
 if(game.status!=='draft')fail('Publiceer de spelregels vóór de show start.','rules_locked');
 if(rulesCurrent(game)){if(!automatic)delete game.rulesPublication.automatic;return game.rulesPublication;}
 if(game.rulesPublication&&((game.orders||[]).length||game.books?.some(b=>b.accountId)))fail('Er zijn al deelnemers aan deze regels gekoppeld. Wijzig de kernregels alleen via een afzonderlijk gecontroleerde correctie.','rules_locked');
 const previous=game.rulesPublication;
 if(previous){game.rulesHistory??=[];if(game.rulesHistory.length>=20)fail('De regelhistorie is vol. Vraag de beheerder om controle.','rules_history_full');game.rulesHistory.push(structuredClone(previous));}
 const contract=rulesContract(game);
 game.rulesPublication={id:crypto.randomUUID(),version:(previous?.version||0)+1,publishedAt:now,...(automatic?{automatic:true}:{}),contract,rules:bindingRules(contract)};
 return game.rulesPublication;
}
export function projectedGameRules(game){
 const publication=game.rulesPublication;
 if(!publication){const contract=automaticRules(game)?rulesContract(game):null;return {published:false,current:false,version:null,publishedAt:null,...(contract?{provisional:true,contract}:{}),rules:contract?bindingRules(contract):[]};}
 return {published:true,current:rulesCurrent(game),id:publication.id,version:publication.version,publishedAt:publication.publishedAt,finalizedAt:publication.finalizedAt??null,provisional:publication.automatic===true&&!publication.finalizedAt,contract:publication.contract,rules:publication.rules};
}
