import {BingoError,cleanText,makeGame} from './bingo-model.js';
import {brandId} from './show-brands.js';
import {normalizeShowTime} from './show-time.js';
import {normalizeProduction,productionSettings} from './production-model.js';
import {prepareAutomaticRules} from './game-rules.js';
import {automaticRules} from './standard-show.js';
import {orderingConfig} from './bingo-order-model.js';

const conflict=()=>new BingoError('Dit verzoek is al voor een andere show of andere invoer gebruikt. Maak een nieuw duplicatieverzoek.',409,'request_conflict');
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;

export async function showCreateBinding(body){
 const schedule=normalizeShowTime(body.date,{timeZone:body.timeZone});
 return digest(JSON.stringify(canonical({title:body.title??null,...schedule,brandId:body.brandId??'vlampie',roundCount:body.roundCount??4,plan:body.plan??null,settings:body.settings??null,production:body.production??null,ordering:body.ordering??null,presentationSelection:body.presentationSelection??null})));
}

function relativeTime(value,{sourceDate,date,timeZone='Europe/Amsterdam'}){
 const source=normalizeShowTime(sourceDate||date,{timeZone}),target=normalizeShowTime(date,{timeZone}),shifted=Date.parse(target.date)+Date.parse(value)-Date.parse(source.date);
 if(!Number.isFinite(shifted)||Math.abs(shifted)>8.64e15)throw new BingoError('De ingestelde tijd past niet bij de nieuwe showdatum.',400,'show_time_invalid');
 return new Date(shifted).toISOString();
}

export function freshOrdering(input,options){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new BingoError('Kies geldige bestelinstellingen.',400,'ordering_invalid');
 const ordering=orderingConfig(input);if(ordering.deadline)ordering.deadline=relativeTime(ordering.deadline,options);return ordering;
}

// Configuration only. A new show has no equipment-test receipts or old clock.
// Lobby timing moves by the same interval relative to the new scheduled show.
export function freshProduction(input,{identity,sourceDate,date,timeZone='Europe/Amsterdam'}={}){
 if(input!==undefined&&(!input||typeof input!=='object'||Array.isArray(input)))throw new BingoError('Kies geldige productie-instellingen.',400,'production_invalid');
 const production=normalizeProduction(productionSettings(input||{},identity));
 production.revision=0;for(const key of Object.keys(production.checks))production.checks[key]=false;
 for(const key of Object.keys(production.calls.requirements))production.calls.requirements[key]=false;
 if(production.lobby.startAt){
  production.lobby.startAt=relativeTime(production.lobby.startAt,{sourceDate,date,timeZone});
 }
 return production;
}

// A deleted account profile can be replaced in the new draft. Do not carry the
// frozen old profile or weaken the normal start-time profile/rule validation.
function copySelection(input){
 if(input===undefined||input===null)return undefined;
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.profileId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(input.profileId)||!Array.isArray(input.ruleIds)||input.ruleIds.length>40||input.ruleIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id))||new Set(input.ruleIds).size!==input.ruleIds.length)throw new BingoError('De presentatiekeuze van deze show heeft een ongeldig formaat.',400,'presentation_choice');
 return {profileId:input.profileId,ruleIds:[...input.ruleIds]};
}

export async function duplicateShowDraft({store,source,ownerId,origin,now,body,id}){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['title','date','timeZone','requestId','expectedPreparationRevision'].includes(key)))throw new BingoError('Geef alleen de naam en datum van de nieuwe show op.',400,'duplicate_fields');
 if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId))throw new BingoError('Gebruik een geldig uniek duplicatieverzoek.',400,'duplicate_request');
 if(body.expectedPreparationRevision!==undefined&&(!Number.isSafeInteger(body.expectedPreparationRevision)||body.expectedPreparationRevision<0))throw new BingoError('Controleer eerst de actuele voorbereiding.',400,'preparation_revision');
 if(source.ownerId!==ownerId)throw new BingoError('Dit spel hoort bij een andere host.',403);
 const title=cleanText(body.title,60,'showtitel'),schedule=normalizeShowTime(body.date,{timeZone:body.timeZone}),binding=await digest(JSON.stringify(['show-duplicate-v1',source.id,title,schedule.date,schedule.timeZone,body.expectedPreparationRevision??null]));
 const replay=row=>{
  if(!row)return null;
  const receipt=row.data.duplication;
  if(row.owner_id!==ownerId||receipt?.requestId!==body.requestId||receipt.sourceId!==source.id||receipt.binding!==binding)throw conflict();
  return {game:row.data,sourceId:source.id,replayed:true};
 };
 const existing=replay(await store.game(id));if(existing)return existing;
 if(body.expectedPreparationRevision!==undefined&&body.expectedPreparationRevision!==(source.preparationRevision||0))throw new BingoError('Het draaiboek is intussen gewijzigd. Laad de bronshow opnieuw voordat je dupliceert.',409,'preparation_conflict');
 // makeGame is the allowlist for identity, plan, settings and all empty state.
 const plan=structuredClone(source.plan);plan.title=title;
 const game=makeGame({title,...schedule,brandId:brandId(source),roundCount:plan.blocks.filter(block=>block.type==='round').length,plan,settings:structuredClone(source.settings)},ownerId,origin,now);
 game.id=id;game.production=freshProduction(source.production,{identity:source,sourceDate:source.date,date:game.date,timeZone:source.timeZone||'Europe/Amsterdam'});
 if(source.ordering!==undefined)game.ordering=freshOrdering(source.ordering,{sourceDate:source.date,date:game.date,timeZone:source.timeZone||'Europe/Amsterdam'});
 const selection=copySelection(source.presentationSelection);if(selection)game.presentationSelection=selection;
 game.duplication={sourceId:source.id,sourcePreparationRevision:source.preparationRevision||0,requestId:body.requestId,binding};
 if(automaticRules(game))prepareAutomaticRules(game,now);
 game.revision=1;
 // An optional source-revision guard lives in the INSERT itself, so an edit
 // racing the copy cannot silently bypass expectedPreparationRevision.
 const revisionGuard=body.expectedPreparationRevision===undefined?'':' AND CAST(COALESCE(json_extract(document,\'$.preparationRevision\'),\'0\') AS INTEGER) = ?',args=[game.id,ownerId,store.serialize(game),now,source.id,ownerId,...(body.expectedPreparationRevision===undefined?[]:[body.expectedPreparationRevision])];
 const saved=await store.db.prepare('INSERT INTO bingo_games (id,owner_id,revision,document,updated_at) SELECT ?,?,1,?,? WHERE EXISTS (SELECT 1 FROM bingo_games WHERE id = ? AND owner_id = ?'+revisionGuard+') ON CONFLICT(id) DO NOTHING RETURNING id').bind(...args).first();
 if(saved)return {game,sourceId:source.id,replayed:false};
 const winner=replay(await store.game(id));if(winner)return winner;
 const current=await store.game(source.id);if(!current)throw new BingoError('De bronshow bestaat niet meer.',404);if(current.owner_id!==ownerId)throw new BingoError('Dit spel hoort bij een andere host.',403);
 throw new BingoError('Het draaiboek is intussen gewijzigd. Laad de bronshow opnieuw voordat je dupliceert.',409,'preparation_conflict');
}
