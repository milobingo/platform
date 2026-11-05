import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {BingoHost} from '../public/bingo-host.js';
import {setConsoleView} from '../public/dashboard.js';
const html=await fs.readFile(new URL('./fixtures/legacy-studio.html',import.meta.url),'utf8');
function setup(){
 const {document,window}=parseHTML(html);globalThis.document=document;
 let active=null;Object.defineProperty(document,'activeElement',{get:()=>active,configurable:true});
 window.HTMLElement.prototype.focus=function(){active=this;};
 const host=Object.create(BingoHost.prototype);Object.assign(host,{game:null,families:[],busy:false,clockOffset:0,director:{},onNotice:()=>{}});host.mount();
 return {host,document,$:id=>document.getElementById(id)};
}
test('empty game list provides guidance and an open creation form in the exposed regie panel',async()=>{
 const h=setup();globalThis.localStorage={getItem:()=>null};globalThis.fetch=async url=>Response.json(String(url).endsWith('/me')?{host:true}:{games:[]});
 await h.host.load();setConsoleView('bingo');assert.equal(h.$('bingo-live-title').textContent,'Geen spel geselecteerd');
 assert.match(h.$('bingo-live-status').textContent,/Kies een spel/);assert(h.$('bingo-live-start').disabled);assert(h.document.querySelector('.game-create').open);
 assert.match(h.$('bingo-claims-list').textContent,/Nog geen bingomeldingen/);assert.equal(h.$('bingo-regie').hidden,false);
});
test('a new bingo reveals its controls once, restores hidden-panel focus, and keeps typed roster search',()=>{
 const h=setup();setConsoleView('books');h.$('bingo-participant-search').value='Sanne';h.$('bingo-participant-search').focus();
 h.host.game={id:'show-1',title:'Pakjesavond',status:'running',books:[{id:'book-1',accountId:'account-1',admitted:true,name:'Sanne',code:'12345678',ticket:'5678'}],state:{phase:'window',window:{id:'window-1',status:'open',endsAt:Date.now()+30000,announcements:[{name:'Sanne',accountId:'account-1'}],claims:[]}}};
 h.host.renderLive();assert.equal(h.document.body.dataset.console,'bingo');assert.equal(h.document.activeElement.dataset.consoleView,'bingo');assert.equal(h.document.querySelector('.bingo-live-claims').hidden,false);assert.equal(h.document.querySelector('.bingo-live-participants').hidden,true);assert.equal(h.$('console-book-count').textContent,'1');assert.equal(h.$('bingo-participant-search').value,'Sanne');assert.match(h.$('bingo-claims-list').textContent,/kiest boekje/);
 setConsoleView('monitor');h.host.renderLive();assert.equal(h.document.body.dataset.console,'monitor');assert.equal(h.$('console-monitor').hidden,false);assert.equal(h.$('bingo-regie').hidden,true);
 const speech=h.$('speech-text');speech.focus();h.host.game.state.window.id='window-2';h.host.renderLive();assert.equal(h.document.body.dataset.console,'bingo');assert.equal(h.document.activeElement,speech,'Do not steal focus from work on another page');
 setConsoleView('books');assert.equal(h.$('bingo-participant-search').value,'Sanne');assert.equal(h.document.querySelector('.bingo-live-claims').hidden,true);assert.equal(h.document.querySelector('.bingo-live-participants').hidden,false);
});
