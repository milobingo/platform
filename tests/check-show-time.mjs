import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeShowTime,showTimeParts} from '../server/show-time.js';
import {orderingAvailable,orderingConfig} from '../server/bingo-order-model.js';

test('ORD-01 Amsterdam wall time is canonical UTC in winter and summer, independent of the process zone',()=>{
 const previous=process.env.TZ;try{for(const zone of ['UTC','America/New_York','Asia/Tokyo']){process.env.TZ=zone;assert.equal(normalizeShowTime('2026-11-18T13:30',{timeZone:'Europe/Amsterdam'}).date,'2026-11-18T12:30:00.000Z');assert.equal(normalizeShowTime('2026-07-18T13:30',{timeZone:'Europe/Amsterdam'}).date,'2026-07-18T11:30:00.000Z');assert.equal(showTimeParts('2026-11-18T12:30:00Z').time,'13:30');}}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('ORD-01 missing zone, DST gap/fold and invalid calendars are rejected; explicit fold offsets stay distinguishable',()=>{
 assert.throws(()=>normalizeShowTime('2026-11-18T13:30'),e=>e.code==='show_time_zone_required');
 assert.throws(()=>normalizeShowTime('2026-03-29T02:30',{timeZone:'Europe/Amsterdam'}),e=>e.code==='show_time_gap');
 assert.throws(()=>normalizeShowTime('2026-10-25T02:30',{timeZone:'Europe/Amsterdam'}),e=>e.code==='show_time_ambiguous');
 for(const value of ['2026-02-31T13:30Z','2026-02-31T13:30','2026-13-01T13:30Z'])assert.throws(()=>normalizeShowTime(value,{timeZone:'Europe/Amsterdam'}));
 assert.notEqual(normalizeShowTime('2026-10-25T02:30+01:00').date,normalizeShowTime('2026-10-25T02:30+02:00').date);
});
test('ORD-01 explicit ordering cutoff closes exactly on the server boundary and never silently interprets old zone-free shows',()=>{
 const game={status:'draft',date:'2026-11-18T14:30:00Z',ordering:orderingConfig({enabled:true,deadline:'2026-11-18T13:30',timeZone:'Europe/Amsterdam'})};
 assert(orderingAvailable(game,Date.parse('2026-11-18T12:29:59.999Z')));assert(!orderingAvailable(game,Date.parse('2026-11-18T12:30:00Z')));assert(!orderingAvailable(game,Date.parse('2026-11-18T12:31:00Z')));
 assert(!orderingAvailable({...game,date:'2026-11-18T13:30'},0));assert.equal(showTimeParts('2026-11-18T13:30').reviewRequired,true);
});
