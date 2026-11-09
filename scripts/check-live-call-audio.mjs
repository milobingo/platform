import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveCallAudio} from '../frontend/live-call-audio.js';
import {createShowAudio} from '../public/show-audio.js';
import {Context,Stream,Track,reaches,call} from './live-call-audio-fixtures.mjs';

test('private/unknown sources cannot reach programme or AI; live graph is strictly mix-minus',async()=>{
 const context=new Context(),audio=new LiveCallAudio({context,Stream});await audio.unlock();const c=call();
 audio.setSession({...c,phase:'backstage'});assert.equal(audio.attachGuest(new Track('private-host'),{identity:'host-a',target:'backstage'}),false);
 audio.setSession(c);assert.equal(audio.attachGuest(new Track('forged'),{identity:'host-a',target:'live'}),false);
 assert.equal(audio.attachGuest(new Track('guest'),{identity:c.guestIdentity,target:'live'}),true);
 const guest=audio.guestSource;assert(reaches(guest,audio.programDestination));assert(reaches(guest,context.destination));assert(!reaches(guest,audio.aiInputDestination),'greeting has not finished');
 audio.setListening(true);assert(reaches(guest,audio.aiInputDestination));assert(!reaches(guest,audio.presenterDestination),'guest must never hear delayed own voice');
 audio.attachPresenter(new Track('milo'));const presenter=audio.presenterSource;
 assert(reaches(presenter,audio.programDestination));assert(reaches(presenter,audio.presenterDestination));assert(!reaches(presenter,audio.aiInputDestination),'presenter must not feed their own AI input');
 const show=new Stream([new Track('music')]);audio.addShowStream(show,{id:'show'});const source=audio.showSources.get('show').source;
 assert(reaches(source,audio.programDestination));assert(!reaches(source,context.destination),'normal show already monitors once');assert(!reaches(source,audio.aiInputDestination));assert(!reaches(source,audio.presenterDestination));
 await audio.dispose();assert.equal(context.state,'running','the shared output context belongs to its existing bridge');
});

test('mute, failed phase and changing guest close audio synchronously without mutating game state',async()=>{
 const audio=new LiveCallAudio({context:new Context(),Stream});await audio.unlock();const c=call();audio.setSession(c);audio.setListening(true);audio.attachGuest(new Track('sophie'),{identity:c.guestIdentity});const source=audio.guestSource;audio.attachPresenter(new Track('milo'));
 audio.setSession({...c,muted:true});assert(!reaches(source,audio.programDestination));assert(!reaches(source,audio.aiInputDestination));assert(reaches(audio.presenterSource,audio.presenterDestination));
 audio.setSession({...c,phase:'returning'});assert(!reaches(audio.presenterSource,audio.programDestination));assert(!reaches(source,audio.programDestination));
 const next=call('call-b','Daan');audio.setSession(next);assert.equal(source.edges.size,0);assert.equal(audio.guestTrack,null);assert.equal(audio.attachGuest(new Track('late-sophie'),{identity:c.guestIdentity}),false);assert.equal(audio.attachGuest(new Track('daan'),{identity:next.guestIdentity}),true);
 assert.equal(c.name,'Sophie');assert.equal(next.name,'Daan');await audio.dispose();
});

test('canvas programme stream contains explicit mix and isolated video; unsupported capture stays unavailable',async()=>{
 const audio=new LiveCallAudio({context:new Context(),Stream});await audio.unlock();assert.equal(audio.composeProgramStream({}),null);
 const video=new Track('studio-picture','video'),canvas={captureStream:rate=>{assert.equal(rate,30);return new Stream([video]);}},combined=audio.composeProgramStream(canvas);
 assert.equal(combined.getVideoTracks()[0],video);assert.equal(combined.getAudioTracks().length,1);assert.notEqual(combined.getAudioTracks()[0],audio.programAudioStream.getAudioTracks()[0]);
 combined.getAudioTracks()[0].stop();assert.equal(audio.programAudioStream.getAudioTracks()[0].readyState,'live','recording cleanup cannot stop live programme');
 await audio.dispose();assert.equal(audio.programAudioStream.getAudioTracks()[0].readyState,'ended');
});

test('AI mute cuts presenter programme/guest return and AI input while preserving the live guest programme track',async()=>{
 const audio=new LiveCallAudio({context:new Context(),Stream});await audio.unlock();const c=call();audio.setSession(c);audio.setListening(true);audio.attachGuest(new Track('guest'),{identity:c.guestIdentity});audio.attachPresenter(new Track('presenter'));
 audio.setSession({...c,aiMuted:true});assert(reaches(audio.guestSource,audio.programDestination));assert(!reaches(audio.guestSource,audio.aiInputDestination));assert(!reaches(audio.presenterSource,audio.programDestination));assert(!reaches(audio.presenterSource,audio.presenterDestination));
 audio.setSession({...c,aiMuted:false});assert(reaches(audio.presenterSource,audio.programDestination));assert(reaches(audio.presenterSource,audio.presenterDestination));await audio.dispose();
});

test('existing show sound exposes its actual effects/music export and disposes its tracks',async()=>{
 const show=createShowAudio({Context});assert.equal(show.programStream,null);assert.equal(await show.unlock(),true);const stream=show.programStream;assert(stream.getAudioTracks().length);show.dispose();assert.equal(stream.getAudioTracks()[0].readyState,'ended');
});
