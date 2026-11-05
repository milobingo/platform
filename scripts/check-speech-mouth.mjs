import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Import as ESM regardless of the surrounding workspace package type.
const source = await readFile(new URL('../public/speech-mouth.js', import.meta.url), 'utf8');
const {speechMouthAt} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const state = (text, overrides = {}) => ({speaking: true, stopped: false,
  speechText: text, speechStart: 100, speechDuration: 1000, speed: 1,
  speechChar: -1, lastBoundary: 0, word: '', ...overrides});
const closed = {open: 0, round: 0};

test('silence, pending start, end, explicit stop and canceled speech close immediately', () => {
  assert.deepEqual(speechMouthAt(state('...'), 600), closed);
  assert.deepEqual(speechMouthAt(state('aa'), 99), closed);
  assert.deepEqual(speechMouthAt(state('aa'), 1100), closed);
  assert.deepEqual(speechMouthAt(state('aa'), 5000), closed);
  assert.deepEqual(speechMouthAt(state('aa', {stopped: true}), 600), closed);
  assert.deepEqual(speechMouthAt(state('aa', {speaking: false}), 600), closed);
});

test('bilabial consonants close; open and round Dutch vowel cues differ', () => {
  for (const text of ['p', 'b', 'm']) assert.deepEqual(speechMouthAt(state(text), 600), closed);
  const aa = speechMouthAt(state('aa'), 600);
  const oe = speechMouthAt(state('oe'), 600);
  assert.ok(aa.open > .8 && aa.round < .2);
  assert.ok(oe.open > .4 && oe.round > .8);
});

test('an actual word boundary corrects an early estimated ending, then closes', () => {
  const anchored = state('aa oe', {speechChar: 3, word: 'oe', lastBoundary: 1050});
  assert.ok(speechMouthAt(anchored, 1150).round > .8);
  assert.deepEqual(speechMouthAt(anchored, 2000), closed);
  assert.deepEqual(speechMouthAt({...anchored, stopped: true}, 1150), closed);
});

test('a stale boundary from a previous utterance cannot keep the mouth moving', () => {
  assert.deepEqual(speechMouthAt(state('aa', {speechChar: 0, lastBoundary: 99}), 1500), closed);
});

test('live voices without word events keep moving beyond the text estimate, then close on stop', () => {
  const live=state('Welkom bij de pakjesavond!',{speechLive:true});
  const samples=Array.from({length:40},(_,i)=>speechMouthAt(live,1600+i*35));
  assert.ok(samples.some(cue=>cue.open>.6));
  assert.ok(samples.some(cue=>cue.open<.2));
  assert.ok(samples.some(cue=>cue.round>.7));
  assert.deepEqual(speechMouthAt({...live,speaking:false},3000),closed);
  assert.deepEqual(speechMouthAt({...live,stopped:true},3000),closed);
  assert.deepEqual(speechMouthAt({...live,speechLive:false},3000),closed);
});

test('sampled motion is bounded, continuous and closes at punctuation', () => {
  const s = state('aa, oe.', {speechDuration: 2200});
  let previous = closed;
  let foundRest = false;
  for (let t = 100; t <= 2300; t += 2) {
    const current = speechMouthAt(s, t);
    assert.ok(current.open >= 0 && current.open <= 1);
    assert.ok(current.round >= 0 && current.round <= 1);
    assert.ok(Math.abs(current.open - previous.open) < .08, `opening jumped at ${t}`);
    if (t > 450 && t < 1100 && current.open === 0) foundRest = true;
    previous = current;
  }
  assert.ok(foundRest);
});
