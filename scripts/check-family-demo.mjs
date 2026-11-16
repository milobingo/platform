// Explicit family demo: real React/transport behavior with all external network
// and device access rejected. This does not verify real media/provider connections.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';

const root=fileURLToPath(new URL('..',import.meta.url));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bundle(contents){return (await build({stdin:{contents,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning'})).outputFiles[0].text;}

function harness(pathname,{network=false}={}){
 const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>'),{document}=window;
 const timers=new Set(),intervals=new Set(),errors=[],requests=[],streams=[],devices=[];
 const timeout=(fn,ms,...args)=>{const timer=setTimeout(()=>{timers.delete(timer);fn(...args);},ms);timers.add(timer);return timer;};
 const interval=(fn,ms)=>{const timer=setInterval(fn,ms);intervals.add(timer);return timer;};
 const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),keys:()=>[...map.keys()]};};
 const localStorage=storage(),sessionStorage=storage(),url=new URL(pathname,'https://bingo.example');
 const location={get href(){return url.href},set href(value){url.href=value},get pathname(){return url.pathname},get search(){return url.search},get hash(){return url.hash},get origin(){return url.origin},reload(){}};
 const gradient={addColorStop(){}};
 const canvas=new Proxy({measureText:text=>({width:String(text).length*8}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(obj,key)=>obj[key]??(()=>{})});
 window.HTMLCanvasElement.prototype.getContext=()=>canvas;
 window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:390,bottom:844,width:390,height:844});
 window.HTMLElement.prototype.focus=function(){document._active=this;};
 Object.defineProperty(document,'activeElement',{get:()=>document._active||document.body});
 window.HTMLElement.prototype.scrollIntoView=()=>{};window.HTMLElement.prototype.scrollTo=()=>{};window.scrollTo=()=>{};
 class ImageStub{constructor(){this.width=this.naturalWidth=800;this.height=this.naturalHeight=1200;}set src(value){this._src=value}get src(){return this._src}}
 class Observer{observe(){}unobserve(){}disconnect(){}}
 class Channel{postMessage(){}close(){}}
 class Stream{constructor(url){streams.push(String(url));throw Error('EventSource is forbidden in the demo');}}
 const computed=()=>new Proxy({getPropertyValue:()=>'',fontSize:'14px',display:'block',visibility:'visible',position:'static',transform:'none',opacity:'1'},{get:(obj,key)=>obj[key]??''});
 const fetch=async(url,opts={})=>{requests.push({url:String(url),method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null,headers:opts.headers});if(!network)throw Error('Real fetch is forbidden in the demo');return Response.json({normal:true,games:[]});};
 const raf=fn=>timeout(()=>fn(performance.now()),16),matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
 const navigator={userAgent:'family-demo-qa',clipboard:{writeText:async()=>{}},mediaDevices:{getUserMedia:async options=>{devices.push(options);throw Error('Real device access is forbidden in the demo');}}};
 const context={__MILO_LOCAL_PREVIEW_AVAILABLE__:true,window,document,location,history:{replaceState(_state,_title,value){if(value)url.href=new URL(value,url).href;}},navigator,localStorage,sessionStorage,
  console:{...console,error:(...args)=>{errors.push(args.map(String).join(' '));console.error(...args);}},setTimeout:timeout,clearTimeout,setInterval:interval,clearInterval,requestAnimationFrame:raf,cancelAnimationFrame:clearTimeout,performance,crypto:globalThis.crypto,queueMicrotask,structuredClone,fetch,EventSource:Stream,Headers,Response,Request,AbortController,AbortSignal,DOMException,URL,URLSearchParams,TextEncoder,TextDecoder,Blob,File,atob,btoa,
  Image:ImageStub,ResizeObserver:Observer,IntersectionObserver:Observer,MutationObserver:window.MutationObserver,BroadcastChannel:Channel,Event:window.Event,CustomEvent:window.CustomEvent,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,SVGElement:window.SVGElement,Element:window.Element,Node:window.Node,NodeFilter:window.NodeFilter,getComputedStyle:computed,matchMedia,
  FormData:class{constructor(form){this.values=new Map([...form.querySelectorAll('input,select,textarea')].filter(node=>node.name).map(node=>[node.name,node.value??node.getAttribute('value')??'']));}get(key){return this.values.get(key)||null;}}};
 Object.assign(window,{location,localStorage,sessionStorage,matchMedia,getComputedStyle:computed,requestAnimationFrame:raf,cancelAnimationFrame:clearTimeout,Image:ImageStub,ResizeObserver:Observer,IntersectionObserver:Observer,BroadcastChannel:Channel,fetch,EventSource:Stream});
 Object.defineProperty(window,'navigator',{value:navigator,configurable:true});
 for(const name of ['addEventListener','removeEventListener','dispatchEvent'])context[name]=window[name].bind(window);
 context.globalThis=context;context.self=context;context.global=context;
 const rejection=error=>errors.push(String(error?.stack||error));process.on('unhandledRejection',rejection);
 const event=(node,type)=>{assert(node,'Missing '+type+' control');node.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}));};
 const click=text=>{const buttons=[...document.querySelectorAll('button')],node=buttons.find(item=>item.textContent.trim()===text)||buttons.find(item=>item.textContent.includes(text));assert(node,'Missing button '+text);event(node,'click');return node;};
 return {window,document,context,requests,streams,devices,errors,localStorage,sessionStorage,event,click,body:()=>document.body.textContent,run:js=>vm.runInNewContext(js,context,{filename:'family-demo-regression.js'}),close(){for(const timer of timers)clearTimeout(timer);for(const timer of intervals)clearInterval(timer);process.off('unhandledRejection',rejection);}};
}

async function checkTransport(){
 const h=harness('/spelen?demo=1');
 try{
  h.run(await bundle(`import * as demo from './frontend/family-demo.js';window.qaDemo=demo;`));
  const d=h.window.qaDemo;
  assert.equal(d.isFamilyDemo(),true);
  const session=await d.requestFamilyDemo('/api/player','/session',{});
  assert.equal(session.authenticated,true);assert.equal(session.method,'demo');assert.equal(session.family.profiles.length,2);
  const list=await d.requestFamilyDemo('/api/bingo','/games',{}),selected=list.games.find(game=>game.status==='running'&&game.brandId==='milo');assert(selected);
  const read=()=>d.requestFamilyDemo('/api/bingo','/games/'+selected.id+'?player=1',{});
  const snapshot=await read(),game=snapshot.game;
  assert.equal(game.status,'running');assert.equal(game.rounds.length,4);assert.equal(game.books.length,2);
  assert(game.books.every(book=>book.admitted&&book.cards.length===4));assert(game.state.drawn.length>=20);assert(game.state.goal);
  assert(game.results.some(result=>result.mine),'At least one confirmed sample prize belongs to the demo family');
  const chatUrl='/api/bingo/games/'+selected.id+'/chat';
  const chat=await (await d.familyDemoFetch(chatUrl,{})).json();assert(chat.messages.length>=6);assert.equal(chat.self.profiles.length,2);
  const text='Alleen in de demo ⭐',sent=await d.familyDemoFetch(chatUrl,{method:'POST',body:JSON.stringify({text,profileId:session.family.profiles[1].id,requestId:'qa-demo-message'})});assert(sent.ok);
  const after=await (await d.familyDemoFetch(chatUrl,{})).json();assert(after.messages.some(message=>message.text===text&&message.name===session.family.profiles[1].name));
  await assert.rejects(d.requestFamilyDemo('/api/bingo','/games/'+selected.id+'/begin',{method:'POST',body:{epoch:'wrong-demo-epoch'}}));
  const opened=await d.requestFamilyDemo('/api/bingo','/games/'+selected.id+'/begin',{method:'POST',body:{epoch:game.state.epoch}});assert(opened.game.state.window.id);
  const book=game.books.find(item=>item.name==='Noor');assert(book);
  const claimed=await d.requestFamilyDemo('/api/bingo','/games/'+selected.id+'/claim',{method:'POST',body:{bookId:book.id,windowId:opened.game.state.window.id}});assert.equal(claimed.claim.status,'valid');assert.equal(claimed.claim.simulated,true);
  assert.deepEqual((await read()).game.state.drawn,game.state.drawn,'A local demo claim must not invent or draw extra numbers');
  const profile=await d.requestFamilyDemo('/api/bingo','/profiles',{method:'POST',body:{name:'Lotte',dateOfBirth:'2017-03-01'}});assert.equal(profile.family.profiles.length,3);
  const aborted=new AbortController();aborted.abort();await assert.rejects(d.requestFamilyDemo('/api/bingo','/games',{signal:aborted.signal}),error=>error.name==='AbortError');
  const provider=await d.familyDemoFetch('/api/livekit/token',{method:'POST',body:'{}'}).then(response=>({response}),error=>({error}));
  if(provider.error)assert.match(provider.error.message,/demo|voorbeeld/i);else{assert.equal(provider.response.ok,false);assert.match(JSON.stringify(await provider.response.json()),/demo|voorbeeld/i);}
  await d.resetFamilyDemo();const fresh=await d.requestFamilyDemo('/api/player','/session',{});assert.equal(fresh.family.profiles.length,2);
  assert.equal(h.requests.length,0);assert.equal(h.devices.length,0);assert.equal(h.streams.length,0);assert.deepEqual(h.errors,[]);
  console.log('✓ Demo data: running Milo show, 2 children, 4-round books, drawn balls, prizes, local chat/profiles, abort and reset; no real network/device/provider access');
 }finally{h.close();}
}

async function checkRegularApi(){
 const h=harness('/spelen',{network:true});
 try{
  h.run(await bundle(`import {playerApi,authApi} from './frontend/player-api.js';window.qaApi={playerApi,authApi};`));
  const result=await h.window.qaApi.playerApi('/games');assert.equal(result.normal,true);assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/bingo/games');
  await h.window.qaApi.playerApi('/profiles',{method:'POST',body:{name:'Echte route'}});assert.equal(h.requests[1].body.name,'Echte route');assert(h.requests[1].body.requestId);assert.equal(h.requests[1].headers['X-Vlampie-Player'],'1');
  assert.deepEqual(h.errors,[]);console.log('✓ Regular family API keeps its real fetch route, player headers and request ID behavior');
 }finally{h.close();}
}

async function checkReactDemo(){
 const h=harness('/spelen?demo=1');
 const realOtp=JSON.stringify({challengeId:'real-otp',email:'real@example.test',expiresAt:Date.now()+600000}),realPending=JSON.stringify({gameId:'real-show',token:'a'.repeat(72)});
 h.sessionStorage.setItem('vlampie-otp',realOtp);h.sessionStorage.setItem('vlampie-pending-book',realPending);h.localStorage.setItem('mf-player-marks:real-account','{"keep":[3]}');
 try{
  h.run(await bundle(`import React from 'react';import {createRoot} from 'react-dom/client';import FamilyApp from './frontend/FamilyApp.jsx';const root=createRoot(document.getElementById('root'));root.render(React.createElement(FamilyApp));window.qaUnmount=()=>root.unmount();`));await wait(1000);
  assert(h.document.querySelector('.fam-demo-banner'),'The active demo must be visibly marked');assert(h.document.querySelector('.fam-demo-video'),'A sample show stage replaces real media in demo');
  assert.equal(h.document.querySelector('.fam-youtube-frame iframe'),null);
  const broadcast=h.document.querySelector('.fam-broadcast-persistent'),stage=h.document.querySelector('.fam-demo-video');assert(broadcast);assert.equal(h.document.querySelectorAll('.fam-number-ball').length,75);assert(h.document.querySelectorAll('.fam-number-ball.is-drawn').length>=20);
  assert(h.document.querySelectorAll('.lc-message').length>=6,'The show chat is filled');
  const composer=h.document.querySelector('.live-chat textarea');composer.value='Hallo vanuit de demo 🌟';h.event(composer,'input');h.event(h.document.querySelector('.lc-composer'),'submit');await wait(120);assert(h.document.querySelector('.lc-messages').textContent.includes('Hallo vanuit de demo 🌟'),'The actual chat sends to the local demo transport');
  h.click('Boekjes');await wait(420);assert.equal(h.document.querySelectorAll('.fam-book').length,2);assert.equal(h.document.querySelectorAll('.fam-round-tabs button').length,4);assert.equal(h.document.querySelectorAll('.fam-card-numbers button').length,50);
  assert([...h.document.querySelectorAll('.fam-book-actions a')].every(link=>!link.getAttribute('href').startsWith('/api/')),'Demo PDF links must not reach real account routes');
  const numbers=[...h.document.querySelectorAll('.fam-card-numbers button')],seeded=numbers.find(node=>!node.classList.contains('free')&&node.getAttribute('aria-pressed')==='true');assert(seeded,'An ongoing demo starts with previously called numbers marked');
  const seedNumber=seeded.textContent;h.event(seeded,'click');await wait(30);assert.equal(seeded.getAttribute('aria-pressed'),'false');
  const mark=numbers.find(node=>node!==seeded&&!node.classList.contains('free')&&node.getAttribute('aria-pressed')!=='true');assert(mark);h.event(mark,'click');await wait(30);assert.equal(mark.getAttribute('aria-pressed'),'true');
  h.click('Gezin');await wait(420);assert.equal(h.document.querySelectorAll('.fam-profile-card').length,2);assert(h.body().includes('Noor'));assert(h.body().includes('Sem'));
  h.click('Meedoen');await wait(420);assert(h.body().includes('Noor'));assert.match(h.body(),/demo|voorbeeld/i);
  const mic=[...h.document.querySelectorAll('button')].find(button=>/microfoon|verbinding controleren/i.test(button.textContent));if(mic&&!mic.disabled){h.event(mic,'click');await wait(80);}assert.equal(h.devices.length,0,'Demo must never open a microphone');
  h.click('Prijzen');await wait(420);assert(h.document.querySelectorAll('.fam-prize').length>=1);assert(h.document.querySelector('.fam-results'));
  h.click('Boekjes');await wait(420);const firstBook=h.document.querySelector('.fam-book');assert.equal([...firstBook.querySelectorAll('.fam-card-numbers button')].find(node=>node.textContent===seedNumber)?.getAttribute('aria-pressed'),'false','Refreshing a demo must not restore a seeded mark the player removed');
  h.click('Kijken');await wait(420);assert.equal(h.document.querySelector('.fam-broadcast-persistent'),broadcast);assert.equal(h.document.querySelector('.fam-demo-video'),stage);
  assert.equal(h.requests.length,0,'No demo family view may reach real APIs');assert.equal(h.streams.length,0,'No demo chat may open a real EventSource');
  assert.equal(h.sessionStorage.getItem('vlampie-otp'),realOtp);assert.equal(h.sessionStorage.getItem('vlampie-pending-book'),realPending);assert.equal(h.localStorage.getItem('mf-player-marks:real-account'),'{"keep":[3]}');
  assert.deepEqual(h.errors,[]);h.window.qaUnmount();console.log('✓ React demo: all 5 filled tabs, unique books/marks, sample prizes, persistent mock stage, isolated real session/storage and no real media/API connections');
 }finally{h.close();}
}

await checkTransport();
await checkRegularApi();
await checkReactDemo();
