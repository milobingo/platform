import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {initDashboard,dashboardPage,DASHBOARD_PAGES,fitProgramWidth} from '../public/dashboard.js';
import {ShowDirector} from '../public/show-director.js';

function harness({width=1366,stored,hash=''}={}){
 class Element{
  constructor(dataset={}){this.dataset=dataset;this.attrs={};this.handlers={};this.hidden=false;this.inert=false;this.clientHeight=600;this.scrollHeight=600;const classes=new Set();this.classList={contains:x=>classes.has(x),remove:x=>classes.delete(x),toggle:(x,v)=>{const active=v??!classes.has(x);if(active)classes.add(x);else classes.delete(x);return active;}};}
  setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}addEventListener(k,fn){this.handlers[k]=fn;}focus(){this.focused=true;}click(){this.handlers.click?.();}
 }
 const body=new Element(),panels=Object.keys(DASHBOARD_PAGES).map(key=>new Element({dashboardPage:key})),links=Object.keys(DASHBOARD_PAGES).map(key=>{const e=new Element({pageLink:key});e.hash='#'+key;return e;}),monitors=['program','chat'].map(key=>new Element({monitorView:key}));
 const nodes=Object.fromEntries(['dashboard-sidebar','sidebar-toggle','sidebar-backdrop','tuning-open','tuning-close','toggle-number-grid','close-number-grid','dashboard-page-title','live-tuning'].map(id=>['#'+id,new Element()]));nodes['.live-console']=new Element();nodes['.controlroom-layout']=new Element();nodes['.ballboard-card']=new Element();
 const windowEvents={},media=[],store=new Map(stored===undefined?[]:[['vlampie-sidebar-collapsed',String(stored)]]),frames=new Map();let frameId=0;
 globalThis.document={body,querySelector:s=>nodes[s],querySelectorAll:s=>s==='[data-dashboard-page]'?panels:s==='[data-page-link]'?links:s==='[data-monitor-view]'?monitors:[]};
 globalThis.window={addEventListener:(name,fn)=>windowEvents[name]=fn};globalThis.location={hash};globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 globalThis.matchMedia=query=>{const m={matches:width<=Number(query.match(/max-width:\s*(\d+)/)?.[1]||0),addEventListener:(event,fn)=>m.change=fn};media.push(m);return m;};
 globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId;};globalThis.cancelAnimationFrame=id=>frames.delete(id);globalThis.getComputedStyle=()=>({display:body.classList.contains('regie-options-popup')?'none':'flex'});
 const flush=()=>{const run=[...frames.values()];frames.clear();run.forEach(fn=>fn());};
 return {body,panels,links,nodes,media,store,monitors,flush,key(value){const event={key:value,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};windowEvents.keydown?.(event);return event;},hash(value){location.hash=value;windowEvents.hashchange?.();}};
}
test('nine valid routes, with unknown and inherited keys returning to regie',()=>{
 for(const key of Object.keys(DASHBOARD_PAGES))assert.equal(dashboardPage('#'+key),key);
 for(const key of ['','#missing','#__proto__','#toString'])assert.equal(dashboardPage(key),'regie');
});
test('page changes reveal exactly one page and preserve an in-progress draw',()=>{
 const h=harness(),director=new ShowDirector({config:{voice:false}});director.draw();director.tick(1.2);director.tick(1);const pending=director.pending,age=director.flow.age;const dashboard=initDashboard();h.flush();
 for(const key of Object.keys(DASHBOARD_PAGES)){h.hash('#'+key);h.flush();assert.equal(dashboard.page,key);assert.deepEqual(h.panels.filter(p=>!p.hidden).map(p=>p.dataset.dashboardPage),[key]);assert.equal(h.links.find(l=>l.attrs['aria-current']==='page').dataset.pageLink,key);assert.equal(director.pending,pending);assert.equal(director.flow.age,age);assert.equal(director.paused,false);}
 dashboard.dispose();
});
test('collapsed menu is persisted and its navigation remains available',()=>{
 const h=harness({stored:false}),dashboard=initDashboard();h.flush();h.nodes['#sidebar-toggle'].click();h.flush();assert(h.body.classList.contains('sidebar-collapsed'));assert.equal(h.store.get('vlampie-sidebar-collapsed'),'true');assert.equal(h.nodes['#dashboard-sidebar'].inert,false);h.nodes['#sidebar-toggle'].click();h.flush();assert.equal(h.store.get('vlampie-sidebar-collapsed'),'false');dashboard.dispose();
});
test('small screens use an accessible menu and independent monitor selection',()=>{
 const h=harness({width:390}),dashboard=initDashboard();h.flush();assert(h.nodes['#dashboard-sidebar'].inert);h.nodes['#sidebar-toggle'].click();h.flush();assert(!h.nodes['#dashboard-sidebar'].inert);assert(!h.nodes['#sidebar-backdrop'].hidden);h.monitors[1].click();h.flush();assert.equal(h.body.dataset.monitor,'chat');assert.equal(h.monitors[1].attrs['aria-pressed'],'true');h.hash('#studio');h.flush();assert(h.nodes['#dashboard-sidebar'].inert);dashboard.dispose();
});
test('regie options remain available as an independent popup during live games',()=>{
 const h=harness(),dashboard=initDashboard();h.body.classList.toggle('live-game',true);h.flush();assert(h.body.classList.contains('regie-options-popup'));assert(h.nodes['#live-tuning'].hidden);h.nodes['#tuning-open'].click();assert(h.body.classList.contains('tuning-open'));assert(!h.nodes['#live-tuning'].hidden);h.nodes['#tuning-close'].click();assert(!h.body.classList.contains('tuning-open'));h.hash('#voorbereiding');h.flush();assert(!h.body.classList.contains('regie-options-popup'));dashboard.dispose();
});
test('compact number board can open and close without changing the show or page',()=>{
 const h=harness({width:390}),director=new ShowDirector({config:{voice:false}});director.draw();director.tick(1.2);director.tick(1);const pending=director.pending,age=director.flow.age,dashboard=initDashboard();h.flush();
 h.nodes['#toggle-number-grid'].click();h.flush();assert(h.body.classList.contains('number-grid-open'));assert.equal(h.nodes['#toggle-number-grid'].attrs['aria-expanded'],'true');assert.equal(h.nodes['.ballboard-card'].attrs.role,'dialog');assert(h.nodes['#close-number-grid'].focused);
 assert(h.key('Escape').defaultPrevented);assert(!h.body.classList.contains('number-grid-open'));assert.equal(h.nodes['#toggle-number-grid'].attrs['aria-expanded'],'false');assert.equal(h.nodes['.ballboard-card'].attrs.role,undefined);assert(h.nodes['#toggle-number-grid'].focused);
 h.nodes['#toggle-number-grid'].click();h.nodes['#close-number-grid'].click();assert(!h.body.classList.contains('number-grid-open'));
 h.nodes['#toggle-number-grid'].click();h.nodes['#tuning-open'].click();assert(!h.body.classList.contains('number-grid-open'));assert(h.body.classList.contains('tuning-open'));assert(h.key('Escape').defaultPrevented);
 h.nodes['#toggle-number-grid'].click();h.hash('#studio');h.flush();assert(!h.body.classList.contains('number-grid-open'));assert.equal(dashboard.page,'studio');assert.equal(director.pending,pending);assert.equal(director.flow.age,age);assert.equal(director.paused,false);dashboard.dispose();
});
test('show output always retains the program page, even with a dashboard hash',()=>{
 const h=harness({hash:'#koppeling'});
 // Show/overlay output must never be measured or resized as a dashboard monitor.
 h.nodes['.regie-broadcast']={getBoundingClientRect(){throw Error('Show output was measured as a regie monitor');}};
 h.nodes['.program-monitor']={};
 const dashboard=initDashboard({isShow:true});h.flush();assert.equal(dashboard.page,'regie');assert.deepEqual(h.panels.filter(p=>!p.hidden).map(p=>p.dataset.dashboardPage),['regie']);assert(h.nodes['#dashboard-sidebar'].inert);
});

test('native 16:9 program and readable chat fit the inferred desktop working areas',()=>{
 // Available sizes account for the current sidebar, header, gutters, scene rack,
 // action bar and right console. This verifies both constraints without a browser.
 const cases=[
  {viewport:'1366×768',width:1366-238-40-340-12,height:768-76-34-40-12-124-70-24},
  {viewport:'1440×900',width:(1440-238-40)*.69-12,height:900-76-34-40-12-124-70-24},
  {viewport:'1920×1080',width:1920-238-40-405-12,height:1080-76-34-40-12-144-76-24},
 ];
 for(const area of cases){
  const monitorWidth=fitProgramWidth(area),stageWidth=monitorWidth-2,stageHeight=stageWidth*9/16;
  assert.ok(monitorWidth>350,`${area.viewport}: program remains usable`);
  assert.ok(area.width-monitorWidth-12>=260,`${area.viewport}: at least 260px remain for chat`);
  assert.ok(stageHeight+76<=area.height,`${area.viewport}: complete monitor fits the available row`);
  assert.ok(Math.abs(stageWidth/stageHeight-16/9)<1e-12,`${area.viewport}: stage has no stretch`);
 }
});
test('height-limited, compact and mobile monitors use the available dimensions safely',()=>{
 const short=fitProgramWidth({width:1200,height:200});
 assert.ok(short*9/16+76<=200);
 assert.ok(short>0);
 const compact=fitProgramWidth({width:640,height:500,compact:true});
 assert.equal(compact,640,'compact mode can use the chat pane width while chat is hidden');
 const compactShort=fitProgramWidth({width:640,height:240,compact:true});
 assert.ok(compactShort*9/16+76<=240);
 for(const width of [296,366,696])assert.equal(fitProgramWidth({width,height:50,mobile:true}),width,'stacked mobile stage uses the full width without being squashed by row height');
 assert.equal(fitProgramWidth({width:800,height:50}),0,'a hidden/too-short row never produces a negative dimension');
 assert.equal(fitProgramWidth({width:0,height:400}),0);
});
test('real HTML places chat beside one stable broadcast stage and preserves operator controls',()=>{
 const {document:html}=parseHTML(readFileSync(new URL('./fixtures/legacy-studio.html',import.meta.url),'utf8'));
 const layout=html.querySelector('.controlroom-layout'),broadcast=layout.querySelector(':scope > .regie-broadcast');
 assert.ok(broadcast);
 assert.equal(broadcast.firstElementChild.id,'regie-live-chat');
 assert.equal(broadcast.children.length,2);
 assert.equal(html.querySelectorAll('#stage').length,1);
 const program=broadcast.querySelector(':scope > .program-monitor'),stage=program.querySelector(':scope > #stage');
 assert.ok(stage);
 for(const id of ['puppet','puppet-3d','stage-caption','loading'])assert.ok(stage.querySelector('#'+id),`${id} stays inside the unchanged stage`);
 for(const id of ['fullscreen','program-scene-label','show-step-status','show-clock'])assert.ok(program.querySelector('#'+id),`${id} stays attached to the program monitor`);
 for(const selector of ['.scene-switcher','.show-actionbar','.live-console'])assert.equal(layout.querySelector(':scope > '+selector)?.parentElement,layout);
 assert.equal(layout.querySelector('.live-console #scene-preview')?.id,'scene-preview');
 assert.equal(html.querySelectorAll('#chat-page-live').length,1);
 assert.equal(html.querySelector('#chat-page-live').closest('[data-dashboard-page]').dataset.dashboardPage,'chat');
 assert.deepEqual([...html.querySelectorAll('[data-monitor-view]')].map(node=>node.dataset.monitorView),['program','chat']);
 const styles=[...html.querySelectorAll('link[rel=stylesheet]')].map(node=>node.getAttribute('href'));
 assert.ok(styles.findIndex(path=>path.includes('studio-redesign.css'))>styles.findIndex(path=>path.includes('show-brands.css')),'the consolidated shell is applied after the feature styles');
});
