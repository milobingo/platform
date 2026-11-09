import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {auditShowTimes,showTimeFingerprint} from '../scripts/audit-show-times.mjs';

const winter={id:'show-winter-01',revision:7,date:'2026-11-18T13:30',timeZone:null,bookCount:12,orderCount:4};
const summer={id:'show-summer-02',revision:3,date:'2026-07-18T13:30',bookCount:0,orderCount:0};
const intent=show=>({id:show.id,fingerprint:showTimeFingerprint(show),intendedZone:'Europe/Amsterdam',evidenceReference:'review-ticket-42'});

test('ORD-01 inventory preserves literal source and proposes no timezone interpretation until explicit bound intent is supplied',()=>{
 const input={schemaVersion:1,shows:[winter,summer,{id:'show-explicit-03',revision:2,date:'2026-11-18T12:30:00Z'}]},before=structuredClone(input),inventory=auditShowTimes(input);
 assert.deepEqual(input,before);assert.deepEqual(auditShowTimes(input),inventory,'identical input has byte-stable data and fingerprints');assert.equal(inventory.databaseWrites,false);assert.equal(inventory.automaticApply,false);
 assert.equal(inventory.summary.reviewRequired,2);assert.equal(inventory.summary.alreadyExplicit,1);assert.equal(inventory.summary.proposed,0);assert.equal(inventory.records[0].before.date,winter.date);assert.equal(inventory.records[0].proposal,null);
 const reviewed=auditShowTimes({...input,reviews:[intent(winter),intent(summer)]});assert.equal(reviewed.summary.proposed,2);assert.equal(reviewed.records[0].proposal.date,'2026-11-18T12:30:00.000Z');assert.equal(reviewed.records[1].proposal.date,'2026-07-18T11:30:00.000Z');assert.equal(reviewed.records[2].proposal,null);assert.equal(reviewed.records[0].before.date,winter.date);
 const stale=auditShowTimes({...input,shows:[{...winter,revision:8}],reviews:[intent(winter)]});assert.equal(stale.records[0].blocker,'stale_review_fingerprint');assert.equal(stale.records[0].proposal,null);
});

test('ORD-01 even explicit Amsterdam intent leaves nonexistent, ambiguous and invalid legacy dates blocked',()=>{
 const shows=['2026-03-29T02:30','2026-10-25T02:30','2026-02-31T13:30'].map((date,i)=>({id:'legacy-dst-'+i,revision:1,date}));
 const result=auditShowTimes({schemaVersion:1,shows,reviews:shows.map(intent)});assert.equal(result.summary.blocked,3);assert.deepEqual(result.records.map(r=>r.blocker),['show_time_gap','show_time_ambiguous','invalid_calendar_or_time']);assert(result.records.every(r=>r.proposal===null));
 assert.throws(()=>auditShowTimes({schemaVersion:1,shows:[winter],reviews:[{...intent(winter),intendedZone:'UTC'}]}),e=>e.code==='explicit_intent_required');
});

test('ORD-01 restricted inventory rejects personal-data fields, duplicate/rebound shows and malformed input without echoing source values',async()=>{
 assert.throws(()=>auditShowTimes({schemaVersion:1,shows:[{...winter,email:'private-account@example.test'}]}),e=>e.code==='input_fields');
 assert.throws(()=>auditShowTimes({schemaVersion:1,shows:[winter,winter]}),e=>e.code==='duplicate_show');
 assert.throws(()=>auditShowTimes({schemaVersion:1,shows:[winter],reviews:[{...intent(winter),id:'another-show'}]}),e=>e.code==='review_binding');
 const child=spawn(process.execPath,['scripts/audit-show-times.mjs'],{cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','pipe']}),stdout=[],stderr=[];
 child.stdout.on('data',x=>stdout.push(x));child.stderr.on('data',x=>stderr.push(x));child.stdin.end('{"unexpected_private_value":"DO-NOT-ECHO-THIS"}');
 assert.equal(await new Promise(resolve=>child.once('exit',resolve)),1);assert.equal(Buffer.concat(stdout).length,0);assert(!Buffer.concat(stderr).toString().includes('DO-NOT-ECHO-THIS'));assert.equal(JSON.parse(Buffer.concat(stderr)).code,'input_fields');
});
