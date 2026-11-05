import test from 'node:test';
import assert from 'node:assert/strict';
import {miloBlinkAt,miloAttentionAt} from '../public/milo-life.js';

test('irregular blinks are deterministic, smooth and bounded across schedule edges',()=>{
 let previous=miloBlinkAt(0),peaks=0,lastPeak=-1;
 for(let t=.002;t<80;t+=.002){
  const b=miloBlinkAt(t);assert.equal(b,miloBlinkAt(t));assert(b>=0&&b<=1);
  assert(Math.abs(b-previous)<.075,'Blink should not snap at a schedule boundary');
  if(b>.99&&previous<=.99){assert(t-lastPeak>.1);lastPeak=t;peaks++;}previous=b;
 }
 assert(peaks>20&&peaks<40,'The presenter must blink occasionally, including rare doubles');
 assert.equal(miloBlinkAt(NaN),miloBlinkAt(0));
});

test('attention follows the actual speaker and live listening takes priority over a board glance',()=>{
 assert(miloAttentionAt({speakerSide:1}).attentionX>0);
 assert(miloAttentionAt({speakerSide:-1}).attentionX<0);
 assert.equal(miloAttentionAt({speaking:true,speakerSide:1}).attentionX,0);
 assert.equal(miloAttentionAt({listening:true,numberAge:.8}).attentionY,0);
 assert.equal(miloAttentionAt({listening:true}).expression,'listening');
 assert.equal(miloAttentionAt({guestSide:1}).expression,'curious');
});

test('confirmed-number glance enters softly and returns to the camera without keeping stale reactions',()=>{
 assert.equal(miloAttentionAt({numberAge:0}).attentionY,0);
 assert(miloAttentionAt({numberAge:.8}).attentionY>.6);
 assert.equal(miloAttentionAt({numberAge:2.8}).attentionY,0);
 assert.equal(miloAttentionAt({numberAge:-1}).attentionY,0);
 assert.equal(miloAttentionAt({numberAge:Infinity}).attentionY,0);
 assert.equal(miloAttentionAt({numberAge:.8,speaking:true}).attentionY,0);
});
