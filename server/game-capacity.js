// Bounded document storage is the native port's explicit alternative to moving
// existing game history. No record is trimmed, rewritten or silently discarded.
export const GAME_DOCUMENT_BYTES=32*1024*1024;
export const GAME_EVENT_LIMIT=20000;
export const GAME_CORE_EVENT_RESERVE=1000;
export const GAME_CONTROL_BYTES=256*1024;
const KiB=1024;
const failure=message=>{throw Object.assign(new Error(message),{status:409,code:'game_capacity'});};
export const documentBytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const books=game=>game.books?.length||0;
const goals=game=>(game.plan?.blocks||[]).filter(block=>block.type==='round').reduce((count,round)=>count+round.goals.length,0);
const rounds=game=>(game.plan?.blocks||[]).filter(block=>block.type==='round').length;
// A complete window can duplicate each claim into immutable history, a saved
// finalist or consolation and a bounded receipt. Names may contain UTF-8 text.
export function windowClosureReserve(game){return GAME_CONTROL_BYTES+128*KiB+books(game)*3000;}
export function gameCapacity(game){
 const bytes=documentBytes(game),goalCount=goals(game),roundCount=rounds(game);
 const liveReserveBytes=1024*KiB+books(game)*goalCount*1500+roundCount*75*512;
 const availableBytes=GAME_DOCUMENT_BYTES-bytes;
 return {strategy:'bounded-document-v1',bytes,maximumBytes:GAME_DOCUMENT_BYTES,availableBytes,bookCount:books(game),cardCount:(game.books||[]).reduce((count,book)=>count+(book.cards?.length||0),0),goalCount,eventCount:game.events?.length||0,eventLimit:GAME_EVENT_LIMIT,coreEventReserve:GAME_CORE_EVENT_RESERVE,liveReserveBytes,windowReserveBytes:windowClosureReserve(game),projectedBytes:bytes+liveReserveBytes,startReady:availableBytes>=Math.max(liveReserveBytes,windowClosureReserve(game))&&(game.events?.length||0)<GAME_EVENT_LIMIT-GAME_CORE_EVENT_RESERVE};
}
export function assertStartCapacity(game){
 const capacity=gameCapacity(game);if(!capacity.startReady)failure('Deze show heeft onvoldoende opslagmarge voor meldingen, uitslagen en veilig herstel. Verklein het concept of maak een volgende show; bestaande gegevens blijven behouden.');return capacity;
}
export function assertWindowCapacity(game){
 const capacity=gameCapacity(game);if(capacity.availableBytes<capacity.windowReserveBytes||(game.events?.length||0)>=GAME_EVENT_LIMIT-GAME_CORE_EVENT_RESERVE)failure('Er is onvoldoende gereserveerde ruimte voor een nieuw meldvenster. De regie moet de showcapaciteit controleren.');return capacity;
}
const coreEvents=new Set(['ball-committed','window-closed','result-announced','show-finished','block-activated','call-draw-held','call-draw-released','draw-held','draw-resumed','call-consent-withdrawn','call-draw-resumed','recovery-reviewed','paused']);
export function assertGameMutationCapacity(before,after){
 const bytes=documentBytes(after);if(bytes>GAME_DOCUMENT_BYTES)failure('Deze wijziging past niet binnen de showcapaciteit. Er is niets opgeslagen; bestaande gegevens blijven behouden.');
 const count=after.events?.length||0,added=(after.events||[]).slice(before.events?.length||0);
 if(count>GAME_EVENT_LIMIT||count>GAME_EVENT_LIMIT-GAME_CORE_EVENT_RESERVE&&added.some(event=>!coreEvents.has(event.type)))failure('De showhistorie heeft haar grens bereikt. Er is niets verwijderd; vraag de beheerder om controle.');
 // Once a window opens, unrelated settings/mail/call writes cannot consume the
 // bytes required to close it and publish its already accepted claims.
 if(after.state?.window?.status==='open'&&GAME_DOCUMENT_BYTES-bytes<windowClosureReserve(after))failure('Deze wijziging zou de ruimte voor de lopende bingocontrole innemen. Rond eerst het meldvenster af.');
 const controlChange=before.state?.drawHold!==after.state?.drawHold&&JSON.stringify(before.state?.drawHold)!==JSON.stringify(after.state?.drawHold)||before.state?.callId!==after.state?.callId;
 if(after.status==='running'&&GAME_DOCUMENT_BYTES-bytes<GAME_CONTROL_BYTES&&!controlChange&&!(added.length&&added.every(event=>coreEvents.has(event.type))))failure('De resterende opslagruimte is gereserveerd voor uitslagen en veilig herstel.');
 return bytes;
}
