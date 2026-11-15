import {normalizeBingoPlan,assertBookAccountsReady} from '../server/bingo-model.js';
import {assertRulesCurrent} from '../server/game-rules.js';
import {assertOrderStartReady} from '../server/bingo-order-model.js';
import {gameCapacity} from '../server/game-capacity.js';
import {normalizeShowTime} from '../server/show-time.js';
import {automaticRules} from '../server/standard-show.js';

const mib=bytes=>Number.isFinite(bytes)?(bytes/1048576).toLocaleString('nl-NL',{maximumFractionDigits:2})+' MiB':'onbekend';
const checked=(id,label,check,detail)=>{try{check();return {id,label,status:'ready',detail};}catch(error){return {id,label,status:'blocked',code:error.code||id,detail:error.message};}};

// These are the same pure guards as the draft-to-running server transition.
// A browser snapshot is advisory: the server repeats them in its atomic write.
export function startReadiness(s,live={}){
 const game=s.game,draft=game.status==='draft',native=!s.demo,rows=[];
 const add=(id,label,status,detail,code)=>rows.push({id,label,status,detail,...(code?{code}:{})});
 const automatic=automaticRules(game),saveError=s.preparation?.status==='error';
 add('saved','Draaiboek',s.dirty?'warning':'ready',saveError?'Niet opgeslagen — Opnieuw proberen. Je invoer blijft bewaard; Start show probeert eerst opnieuw op te slaan.':s.dirty?'Opslaan… Start show bewaart eerst je laatste wijzigingen.':'Opgeslagen.');
 if(native&&game.status==='finished')add('finished','Showstatus','blocked','Deze show is afgelopen. Maak een nieuwe show.');
 if(draft){
  rows.push(checked('plan','Rondes, patronen en prijzen',()=>normalizeBingoPlan(game.plan),'Het draaiboek bevat geldige rondes, patronen en prijzen.'));
  if(native){
   const rules=automatic?{id:'rules',label:'Spelregels',status:'ready',detail:game.rulesPublication?.finalizedAt?'De spelregels liggen vast voor deze show.':game.rulesPublication?`Versie ${game.rulesPublication.version} is vóór deelname beschikbaar. Bij Start show legt de server de regels automatisch vast.`:'De spelers zien de regels vóór deelname. Bij Start show legt de server de regels automatisch vast.'}:checked('rules','Bindende spelregels',()=>assertRulesCurrent(game),'');
   if(!automatic){if(rules.status==='ready')rules.detail=`Versie ${game.rulesPublication.version} is gepubliceerd en hoort bij deze voorbereiding.`;
   else if(!game.rulesPublication)rules.detail='De spelregels voor deze show zijn nog niet gepubliceerd. Bekijk ze en kies Publiceer spelregels.';
   else rules.detail=`De voorbereiding wijkt af van de gepubliceerde regelsversie ${game.rulesPublication.version}. Controleer de gewijzigde regels hieronder.`;}
   rows.push(rules);
   rows.push(checked('schedule','Showtijd',()=>normalizeShowTime(game.date,{timeZone:game.timeZone}),'De showtijd heeft een vastgelegde tijdzone.'));
   rows.push(checked('accounts','Boekjes en deelname',()=>{assertBookAccountsReady(game);if(!game.books.some(book=>book.accountId&&book.admitted&&!book.revokedAt))throw new Error('Koppel minstens één toegelaten boekje voordat de show begint.');},`${game.books.filter(book=>book.accountId&&book.admitted&&!book.revokedAt).length} toegelaten boekjes; maximaal 150 per gezin.`));
  }
  const orders=game.orders||[],reported=orders.filter(order=>order.status==='payment_reported').length,unissued=orders.filter(order=>order.payment?.state==='verified'&&order.status!=='fulfilled'&&order.refund?.state!=='verified').length,reconciliation=orders.filter(order=>['required','processing'].includes(order.reconciliation?.state)).length,refunds=orders.filter(order=>['required','processing','failed'].includes(order.refund?.state)).length;
  const orderRow=checked('orders','Betaling, terugbetaling en uitgifte',()=>assertOrderStartReady(game),`${orders.filter(order=>order.status==='fulfilled').length} bestellingen compleet uitgegeven. Onbetaalde aanvragen blokkeren de start niet.`);
  if(orderRow.status==='blocked')orderRow.detail+=` Betaalcontrole: ${reported}; betaald zonder uitgifte: ${unissued}; herbeoordeling: ${reconciliation}; terugbetaling: ${refunds}.`;
  rows.push(orderRow);
  const capacity=game.capacity||gameCapacity(game);
  add('capacity','Opslag en herstelreserve',capacity.startReady?'ready':'blocked',`${game.capacity?'Servermeting':'Lokale inschatting'}: ${mib(capacity.bytes)} van ${mib(capacity.maximumBytes)}; showreserve ${mib(capacity.liveReserveBytes)}, meldvensterreserve ${mib(capacity.windowReserveBytes)}. ${capacity.startReady?'De startreserve past.':'Onvoldoende marge; verklein het concept of laat de capaciteit beoordelen.'}`,'game_capacity');
 }else if(native)add('admission','Eerder toegelaten show','ready','Bestaande deelname en uitgifte worden bij hervatten niet opnieuw ingetrokken.');
 const call=live.call,held=!!game.state.drawHold||!!game.state.callId||!!s.drawHeld||!!live.drawHeld;
 const active=!!call&&call.phase!=='completed',cleanup=!!call&&(call.phase==='completed'&&call.resourcesClosed!==true||!!call.cleanupError||['manual-reconciliation','unclosed','pending'].includes(call.recoveryStatus));
 if(held||active||cleanup||live.mismatchedGame)add('calls','Belmoment en veilig hervatten','blocked',held?'De trekking is geblokkeerd voor een belmoment. Bevestig terugkeer en hervatten bij Publiek & bellen.':cleanup?'De afsluiting van het belmoment is nog niet bevestigd. Controleer herstel en cleanup bij Publiek & bellen.':live.mismatchedGame?'Er staat nog een belmoment van een andere show. Rond dit eerst gecontroleerd af.':`Belmoment actief (${call.phase}). Rond terugkeer en hervatten eerst af.`,'call_draw_hold');
 else add('calls','Belmoment en veilig hervatten',live.error?'warning':'ready',live.error?'Belstatus kon niet worden ververst. Controleer Publiek & bellen; de server blijft beslissend.':'Geen belmoment of onbevestigde afsluiting in de huidige status.');
 if(game.state.window?.status==='open'||game.state.resultId)add('result','Bingocontrole en uitslag','blocked',game.state.window?.status==='open'?'Er staat nog een meldvenster open.':'Werk eerst de vastgelegde uitslag af.');
 if(native&&(s.voiceMode!=='ai'||!s.apiStatus?.configured))add('voice','Personagestem','blocked','Een opgeslagen show vraagt de ingestelde centrale stemkoppeling en AI-stemmodus. Gebruik de oefenstudio voor een browserrepetitie.');
 else add('voice','Personagestem',s.demo?'off':'warning',s.demo?'Browserrepetitie: externe personagestemmen zijn niet vereist.':'Koppeling ingesteld. Hoorbaarheid en de gekozen stemmen moeten nog in de uitzending worden gerepeteerd.');
 if(native&&(game.brandId||s.production)==='milo'&&s.audioPreparation)add('audio','Vaste showaudio',s.audioPreparation.complete?'ready':'warning',s.audioPreparation.complete?`Alle ${s.audioPreparation.total} vaste stemfragmenten zijn ingeladen.`:s.audioPreparation.phase==='error'?s.audioPreparation.error:'De vaste stemfragmenten worden automatisch voorbereid. Start show wacht tot alle audio klaarstaat.');
 const callsEnabled=game.production?.calls?.enabled===true;
 add('media','Live bellen',s.demo||!callsEnabled?'off':live.settings?.configured?'warning':'off',s.demo?'Belmomenten worden lokaal geoefend; er wordt geen echte verbinding gemaakt.':!callsEnabled?'Uitgeschakeld voor deze show; LiveKit is geen startvoorwaarde.':live.settings?.configured?'Media-instellingen beschikbaar. Een echte gast-, audio- en terugkeerrepetitie blijft nodig.':'Geen bevestigde mediaconfiguratie. Echt bellen is niet beschikbaar; repeteer zonder deze feature.');
 add('output','Program, uitvoer en geluid',s.outputConnected?'warning':'off',s.outputConnected?'Het uitzendvenster is verbonden. Controleer hoorbaar geluid, beeldopname en reservebediening in een praktijkrepetitie.':'Geen bevestigd uitzendvenster. Lokale regie/repetitie blijft beschikbaar; de uitzending is niet gecontroleerd.');
 const blockers=rows.filter(row=>row.status==='blocked');
 return {rows,blockers,canStart:!s.working&&!s.runner?.active&&!blockers.length};
}
