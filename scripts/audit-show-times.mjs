import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalizeShowTime,SHOW_TIME_ZONE} from '../server/show-time.js';

const MAX_INPUT_BYTES=2*1024*1024,MAX_SHOWS=1000;
const localDate=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;
const explicitDate=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
class ShowTimeAuditError extends Error{constructor(code){super('De tijdsinventarisatie is gestopt. Controleer het beperkte JSON-contract; invoerwaarden worden niet in fouten herhaald.');this.code=code;}}
const fail=code=>{throw new ShowTimeAuditError(code);};
function fields(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('input_fields');}
function opaqueId(value){if(typeof value!=='string'||!/^[-_a-zA-Z0-9]{1,100}$/.test(value))fail('opaque_show_id_required');return value;}
function count(value){if(!Number.isSafeInteger(value)||value<0)fail('invalid_count');return value;}
function source(show){
 fields(show,['id','revision','date','timeZone','bookCount','orderCount']);
 const id=opaqueId(show.id);if(!Number.isSafeInteger(show.revision)||show.revision<0)fail('invalid_revision');
 if(typeof show.date!=='string'||show.date.length>64||!/^[0-9TtZz:.+\-]*$/.test(show.date))fail('invalid_date_literal');
 if(show.timeZone!==undefined&&show.timeZone!==null&&(typeof show.timeZone!=='string'||show.timeZone.length>100||/[\x00-\x1f\x7f]/.test(show.timeZone)))fail('invalid_zone_literal');
 return {id,revision:show.revision,date:show.date,timeZone:show.timeZone??null,bookCount:count(show.bookCount??0),orderCount:count(show.orderCount??0)};
}
export function showTimeFingerprint(show){return createHash('sha256').update(JSON.stringify(source(show))).digest('hex');}

/** Pure inventory/proposal only: no database, environment, provider or writes. */
export function auditShowTimes(input){
 fields(input,['schemaVersion','shows','reviews']);
 if(input.schemaVersion!==1||!Array.isArray(input.shows)||input.shows.length>MAX_SHOWS||input.reviews!==undefined&&!Array.isArray(input.reviews)||input.reviews?.length>MAX_SHOWS)fail('input_contract');
 const shows=input.shows.map(source),ids=new Set();for(const show of shows){if(ids.has(show.id))fail('duplicate_show');ids.add(show.id);}
 const reviews=new Map();
 for(const review of input.reviews||[]){
  fields(review,['id','fingerprint','intendedZone','evidenceReference']);const id=opaqueId(review.id);
  if(!ids.has(id)||reviews.has(id))fail('review_binding');
  if(typeof review.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(review.fingerprint)||review.intendedZone!==SHOW_TIME_ZONE||typeof review.evidenceReference!=='string'||!/^[-_a-zA-Z0-9./:#]{1,160}$/.test(review.evidenceReference))fail('explicit_intent_required');
  reviews.set(id,review);
 }
 const records=shows.map(show=>{
  const fingerprint=showTimeFingerprint(show),review=reviews.get(show.id);
  const result={id:show.id,revision:show.revision,fingerprint,before:{date:show.date,timeZone:show.timeZone},bookCount:show.bookCount,orderCount:show.orderCount,classification:localDate.test(show.date)?'zone-free':explicitDate.test(show.date)?'explicit-instant':'invalid',status:'blocked',blocker:null,proposal:null};
  if(review&&review.fingerprint!==fingerprint)return {...result,blocker:'stale_review_fingerprint'};
  let normalized;
  try{normalized=normalizeShowTime(show.date,{timeZone:SHOW_TIME_ZONE});}
  catch(error){return {...result,blocker:['show_time_gap','show_time_ambiguous'].includes(error.code)?error.code:'invalid_calendar_or_time'};}
  if(result.classification==='explicit-instant')return {...result,status:'already_explicit',blocker:null};
  if(!review)return {...result,status:'review_required',blocker:'explicit_intent_required'};
  return {...result,status:'proposal',blocker:null,proposal:{date:normalized.date,timeZone:SHOW_TIME_ZONE,intentEvidenceReference:review.evidenceReference}};
 });
 return {schemaVersion:1,mode:'read_only_show_time_inventory',databaseWrites:false,automaticApply:false,summary:{shows:records.length,zoneFree:records.filter(r=>r.classification==='zone-free').length,alreadyExplicit:records.filter(r=>r.status==='already_explicit').length,reviewRequired:records.filter(r=>r.status==='review_required').length,proposed:records.filter(r=>r.status==='proposal').length,blocked:records.filter(r=>r.status==='blocked').length},records};
}

export async function main(argv=process.argv.slice(2),input=process.stdin,output=process.stdout){
 if(argv.length)fail('unknown_option');const chunks=[];let bytes=0;
 for await(const chunk of input){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;if(bytes>MAX_INPUT_BYTES)fail('input_too_large');chunks.push(buffer);}
 let parsed;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('invalid_json');}
 const result=auditShowTimes(parsed);output.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await main();}catch(error){process.stderr.write(JSON.stringify({ok:false,code:error instanceof ShowTimeAuditError?error.code:'show_time_audit_failed',message:'De tijdsinventarisatie is gestopt. Er zijn geen databasewijzigingen uitgevoerd; controleer het beperkte JSON-contract.'})+'\n');process.exitCode=1;}
}
