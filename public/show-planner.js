import {bt} from './brand-ui.js?v=37';
import {BLOCK_TYPES,normalizePlan,planIssues,newId,createBlock,moveBlock,blockSummary,formatDuration} from './plan-model.js?v=36';

const $=selector=>document.querySelector(selector),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#${name}"/></svg>`;
const clone=value=>structuredClone(value);
async function api(path,options={}){
 const response=await fetch('/api/planner/'+path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000),...options,headers:{'X-Vlampie-Planner':'1',...options.headers}});
 let body;try{body=await response.json();}catch{throw new Error('De showopslag geeft geen antwoord. Probeer het opnieuw.');}
 if(!response.ok){const error=new Error(body.error?.message||'De voorbereiding kon niet worden opgeslagen.');error.code=body.error?.code;throw error;}return body;
}
const options=(rows,value,placeholder)=>`<option value="">${placeholder}</option>`+rows.map(row=>`<option value="${esc(row.id)}" ${row.id===value?'selected':''}>${esc(row.title||'Naamloos')}</option>`).join('');
const patternPreview=pattern=>`<div class="pattern-mini" aria-hidden="true">${Array.from({length:25},(_,i)=>`<i class="${pattern.cells.includes(i)?'marked':''} ${i===12&&pattern.freeCenter?'free':''}"></i>`).join('')}</div>`;

export class ShowPlanner{
 constructor({onChange=()=>{},onStart=()=>{},onNotice=()=>{}}={}){
  this.document=null;this.revision=0;this.dirty=false;this.generation=0;this.saving=null;this.timer=0;this.conflict=false;this.selected=null;this.patternDraft=null;this.prizeDraft=null;this.uploadSerial=0;this.uploading=false;this.onChange=onChange;this.onStart=onStart;this.onNotice=onNotice;for(const el of document.querySelectorAll('#pattern-form input,#pattern-form select,#pattern-form button,#prize-form input,#prize-form textarea,#prize-form button,#pattern-new,#prize-new'))el.disabled=true;this.bind();this.loading=this.load();
 }
 get ready(){return !!this.document&&!this.conflict;}
 status(message,phase='saved'){for(const el of document.querySelectorAll('#planner-load-state,[data-planner-status]')){el.textContent=message;el.dataset.phase=phase;}}
 alert(message='',action='save'){$('#planner-alert').hidden=!message;$('#planner-alert span').textContent=message;this.retryAction=action;$('#planner-retry').textContent=action==='reload'?'Opgeslagen versie laden':action==='load'?'Opnieuw laden':'Opslaan opnieuw';}
 async load(){
  this.status('Voorbereiding laden…','loading');
  try{const data=await api('document');this.document=normalizePlan(data.document);this.revision=data.revision;this.dirty=false;this.conflict=false;this.generation++;this.selected=this.document.blocks[0]?.id||null;this.patternDraft=clone(this.document.patterns[0]||{id:newId('patroon'),title:'',cells:[],freeCenter:true,variant:'fixed'});this.prizeDraft=clone(this.document.prizes[0]||{id:newId('prijs'),title:'',description:'',image:''});this.uploadSerial++;this.uploading=false;this.alert();this.status(this.revision?'Voorbereiding opgeslagen':'Voorbeeldshow · nog niet opgeslagen',this.revision?'saved':'draft');this.render();this.onChange(this.document);}
  catch(error){this.alert(error.message,'load');this.status('Laden niet gelukt','error');}
 }
 changed(){
  this.dirty=true;this.generation++;this.onChange(this.document);clearTimeout(this.timer);
  if(!this.conflict){this.status('Wijzigingen worden opgeslagen…','saving');this.timer=setTimeout(()=>this.flush().catch(()=>{}),800);}
 }
 async flush(){
  clearTimeout(this.timer);if(!this.document)throw new Error('De showvoorbereiding is nog niet geladen.');
  if(this.conflict)throw new Error('Laad eerst de opgeslagen versie of bewaar je wijzigingen in dit venster.');
  if(this.saving){await this.saving;return this.dirty?this.flush():this.document;}
  if(!this.dirty&&this.revision>0)return this.document;
  const generation=this.generation,document=clone(this.document),revision=this.revision;this.status('Voorbereiding opslaan…','saving');
  this.saving=(async()=>{
   try{const result=await api('document',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({document,revision})});this.revision=result.revision;this.dirty=this.generation!==generation;this.alert();this.status(this.dirty?'Laatste wijzigingen opslaan…':`Opgeslagen om ${new Date(result.updatedAt).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}`,this.dirty?'saving':'saved');}
   catch(error){this.dirty=true;this.conflict=error.code==='conflict';this.alert(error.message+(this.conflict?' Opgeslagen versie laden vervangt je wijzigingen in dit venster.':''),this.conflict?'reload':'save');this.status('Opslaan niet bevestigd','error');this.onChange(this.document);throw error;}
  })();
  try{await this.saving;}finally{this.saving=null;}
  return this.dirty?this.flush():this.document;
 }
 bind(){
  $('#planner-save').addEventListener('click',()=>this.flush().then(()=>this.onNotice('De showvoorbereiding is opgeslagen.')).catch(error=>this.onNotice(error.message)));
  $('#planner-retry').addEventListener('click',()=>this.retryAction==='save'?this.flush().catch(()=>{}):this.load());
  $('#planner-start').addEventListener('click',()=>this.onStart());
  $('#planner-title').addEventListener('input',event=>{if(!this.document)return;this.document.title=event.target.value;this.changed();});
  $('#planner-widgets').addEventListener('click',event=>{const button=event.target.closest('[data-widget]');if(button&&this.document)this.add(button.dataset.widget);});
  $('#planner-flow').addEventListener('click',event=>{
   const action=event.target.closest('[data-block-action]'),select=event.target.closest('[data-select-block]');
   if(action){const id=action.closest('[data-block-id]').dataset.blockId;this.blockAction(id,action.dataset.blockAction);}
   else if(select){this.selected=select.dataset.selectBlock;this.renderTimeline();this.renderInspector();this.revealInspector();}
  });
  $('#planner-inspector').addEventListener('input',event=>this.editBlock(event));
  $('#planner-inspector').addEventListener('change',event=>this.editBlock(event));
  $('#planner-inspector').addEventListener('click',event=>{
   const button=event.target.closest('[data-goal-action]');if(!button)return;const block=this.document?.blocks.find(b=>b.id===this.selected);if(!block)return;
   if(button.dataset.goalAction==='add'&&block.goals.length<10)block.goals.push({id:newId('doel'),patternId:this.document.patterns[0]?.id||'',prizeId:this.document.prizes[0]?.id||''});
   else if(['up','down'].includes(button.dataset.goalAction)){const i=Number(button.dataset.goal),j=i+(button.dataset.goalAction==='up'?-1:1);if(j>=0&&j<block.goals.length)[block.goals[i],block.goals[j]]=[block.goals[j],block.goals[i]];}
   else if(button.dataset.goalAction==='remove'&&block.goals.length>1)block.goals.splice(Number(button.dataset.goal),1);
   this.changed();this.renderTimeline();this.renderInspector();
  });
  this.bindDrag();this.bindPatterns();this.bindPrizes();
 }
 render(){
  const d=this.document;if(!d)return;for(const el of document.querySelectorAll('#pattern-form input,#pattern-form select,#pattern-form button,#prize-form input,#prize-form textarea,#prize-form button,#pattern-new,#prize-new'))el.disabled=false;$('#planner-title').disabled=false;$('#planner-title').value=d.title;$('#planner-save').disabled=false;$('#planner-start').disabled=false;
  this.renderTimeline();this.renderWidgets();this.renderInspector();this.renderPatterns();this.renderPatternEditor();this.renderPrizes();this.renderPrizeEditor();
 }
 renderWidgets(){$('#planner-widgets').innerHTML=Object.entries(BLOCK_TYPES).filter(([kind])=>kind!=='random-call').map(([kind,type])=>`<button type="button" class="widget-card" draggable="true" data-widget="${kind}" data-drag-kind="${kind}" title="${type.description}" aria-label="${type.name} toevoegen of verslepen"><span class="widget-icon">${icon(type.icon)}</span><span><strong>${type.name}</strong><small>${type.description}</small></span><span class="widget-add" aria-hidden="true">+</span></button>`).join('');}
 renderTimeline(){
  const d=this.document;if(!d)return;const rounds=d.blocks.filter(b=>b.type==='round').length,timed=d.blocks.reduce((sum,b)=>sum+(['countdown','pause','call'].includes(b.type)?b.seconds:0),0);
  $('#planner-block-count').textContent=`${d.blocks.length} ${d.blocks.length===1?'blok':'blokken'}`;
  $('#planner-summary').innerHTML=`<span><strong>${d.blocks.length}</strong> showblokken</span><span><strong>${rounds}</strong> bingorondes</span><span><strong>${formatDuration(timed)}</strong> timers</span>`;
  const issues=planIssues(d);$('#planner-validation').textContent=issues.length?issues[0]:'Klaar voor de show. Bingomeldingen worden door de regie gecontroleerd.';$('#planner-validation').dataset.valid=String(!issues.length);
  $('#planner-flow').innerHTML=d.blocks.map((b,i)=>`<div class="timeline-drop" data-before="${esc(b.id)}" aria-hidden="true"></div><article class="timeline-step ${this.selected===b.id?'selected':''}" data-block-id="${esc(b.id)}" data-kind="${b.type}" role="listitem"><button class="drag-grip" type="button" draggable="true" data-drag-id="${esc(b.id)}" aria-label="${esc(b.title)} verslepen" title="Versleep dit blok"><span aria-hidden="true">⠿</span></button><span class="step-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><button type="button" class="step-select" data-select-block="${esc(b.id)}"><span class="step-icon">${icon(BLOCK_TYPES[b.type].icon)}</span><span class="step-text"><span class="step-type">${BLOCK_TYPES[b.type].name}</span><strong>${esc(b.title||'Naamloos blok')}</strong><small>${esc(blockSummary(b,d))}</small></span></button><div class="step-actions"><button type="button" data-block-action="up" ${i===0?'disabled':''} aria-label="${esc(b.title)} hoger in de tijdlijn">Hoger</button><button type="button" data-block-action="down" ${i===d.blocks.length-1?'disabled':''} aria-label="${esc(b.title)} lager in de tijdlijn">Lager</button><button type="button" data-block-action="copy" aria-label="${esc(b.title)} kopiëren">Kopie</button><button type="button" data-block-action="remove" aria-label="${esc(b.title)} verwijderen">×</button></div></article>`).join('')+`<div class="timeline-drop timeline-drop-last" data-before="" aria-hidden="true"><span>${d.blocks.length?'Sleep hier het volgende showblok':'Sleep hier je eerste showblok'}</span></div>`;
  this.setRunState(this.runState);
 }
 renderInspector(){
  const b=this.document?.blocks.find(x=>x.id===this.selected);if(!b){$('#planner-inspector').innerHTML='<h3>Kies een showblok</h3><p class="field-help">Selecteer een blok in de tijdlijn of voeg een widget toe.</p>';return;}
  let fields=`<label>Titel<input data-field="title" maxlength="60" value="${esc(b.title)}"></label>`;
  if(['countdown','pause','call'].includes(b.type))fields+=`<label>Duur<div class="planner-field-pair"><input data-field="duration" type="number" min="${b.unit==='minutes'?'.02':'1'}" max="${b.unit==='minutes'?'1440':'86400'}" step="${b.unit==='minutes'?'.1':'1'}" value="${b.unit==='minutes'?Math.round(b.seconds/60*100)/100:b.seconds}"><select data-field="unit" aria-label="Eenheid van de timer"><option value="seconds" ${b.unit==='seconds'?'selected':''}>Seconden</option><option value="minutes" ${b.unit==='minutes'?'selected':''}>Minuten</option></select></div></label>`;
  if(['welcome','explanation','story','finale','call'].includes(b.type))fields+=`<label>Tekst voor ${bt("Vlampie")}<textarea data-field="text" maxlength="500" rows="6" placeholder="Wat moet ${bt("Vlampie")} vertellen?">${esc(b.text)}</textarea></label><div class="script-meta"><span>Wordt uitgesproken met je gekozen stem</span><span id="planner-script-count">${b.text.length}/500</span></div>`;
  if(['welcome','explanation','story','finale'].includes(b.type))fields+=`<label>Wachttijd na de tekst<div class="planner-field-pair"><input data-field="hold" type="number" min="0" max="60" value="${b.hold}"><span class="field-unit">seconden</span></div></label>`;
  if(b.type==='round')fields+=`<div class="round-goals"><div class="inspector-subheading"><h4>Patronen & prijzen</h4><span>Op volgorde</span></div>${b.goals.map((g,i)=>`<div class="round-goal"><div class="goal-heading"><strong>Stap ${i+1}</strong><button class="text-button" type="button" data-goal-action="up" data-goal="${i}" ${i===0?'disabled':''}>Hoger</button><button class="text-button" type="button" data-goal-action="down" data-goal="${i}" ${i===b.goals.length-1?'disabled':''}>Lager</button><button class="text-button" type="button" data-goal-action="remove" data-goal="${i}" ${b.goals.length===1?'disabled':''} aria-label="Combinatie ${i+1} verwijderen">×</button></div><label>Winnend patroon<select data-goal="${i}" data-goal-field="patternId">${options(this.document.patterns,g.patternId,'Kies een patroon')}</select></label><label>Prijs<select data-goal="${i}" data-goal-field="prizeId">${options(this.document.prizes,g.prizeId,'Kies een prijs')}</select></label></div>`).join('')}<button type="button" class="button quiet goal-add" data-goal-action="add" ${b.goals.length>=10?'disabled':''}>Combinatie toevoegen</button><div class="inspector-links"><a href="#patronen">Patronen beheren</a><a href="#prijzen">Prijzen beheren</a></div></div><label>Wachttijd tussen trekkingen<div class="planner-field-pair"><input data-field="interval" type="number" min="0" max="60" value="${b.interval}"><span class="field-unit">seconden</span></div></label><label class="planner-check"><input data-field="newBoard" type="checkbox" ${b.newBoard?'checked':''}>Nieuw bingobord aan het begin</label><p class="field-help">Na iedere gewonnen prijs volgt het volgende patroon met dezelfde kaart en ballen. Zet volle kaart als laatste stap; daarna eindigt de ronde.</p>`;
  if(b.type==='call')fields+=`<label>Verdergaan<select data-field="advance"><option value="manual" ${b.advance==='manual'?'selected':''}>Wanneer de regie verdergaat</option><option value="auto" ${b.advance==='auto'?'selected':''}>Automatisch na de timer</option></select></label><p class="inspector-note">Dit blok reserveert het belmoment in je draaiboek. Bereid de deelnemers en geluidscheck voor bij Shows → Uitzending → Belmomenten. De regie start de echte oproep.</p>`;
  $('#planner-inspector').innerHTML=`<div class="planner-panel-heading"><div><span class="eyebrow">BLOK INSTELLEN</span><h3>${BLOCK_TYPES[b.type].name}</h3></div><span class="inspector-icon">${icon(BLOCK_TYPES[b.type].icon)}</span></div><div class="inspector-fields">${fields}</div>`;
 }
 editBlock(event){
  const el=event.target,b=this.document?.blocks.find(x=>x.id===this.selected);if(!b)return;
  if(el.dataset.goalField){b.goals[Number(el.dataset.goal)][el.dataset.goalField]=el.value;}
  else if(el.dataset.field){const field=el.dataset.field;
   if(field==='duration'){if(el.value==='')return;b.seconds=Math.max(1,Math.min(86400,Number(el.value)*(b.unit==='minutes'?60:1)));}
   else if(field==='unit'){b.unit=el.value;this.renderInspector();}
   else if(['interval','hold'].includes(field)){if(el.value==='')return;b[field]=Math.max(0,Math.min(60,Number(el.value)));}
   else if(field==='newBoard')b.newBoard=el.checked;
   else b[field]=el.value;
  }else return;
  if(b.text!==undefined&&$('#planner-script-count'))$('#planner-script-count').textContent=`${b.text.length}/500`;
  this.changed();this.renderTimeline();
 }
 add(type,beforeId=null){
  if(!this.document||this.document.blocks.length>=100)return this.onNotice('Een tijdlijn kan maximaal 100 blokken bevatten.');
  const b=createBlock(type,this.document);if(b.text)b.text=bt(b.text);this.document.blocks.push(b);if(beforeId)moveBlock(this.document,b.id,beforeId);this.selected=b.id;this.changed();this.renderTimeline();this.renderInspector();this.revealInspector();
 }
 blockAction(id,action){
  const d=this.document,index=d.blocks.findIndex(b=>b.id===id);if(index<0)return;
  if(action==='remove'){d.blocks.splice(index,1);if(this.selected===id)this.selected=d.blocks[Math.min(index,d.blocks.length-1)]?.id||null;}
  if(action==='copy'){if(d.blocks.length>=100)return this.onNotice('De tijdlijn bevat al 100 blokken.');const b=clone(d.blocks[index]);b.id=newId('blok');if(b.goals)b.goals.forEach(g=>g.id=newId('doel'));d.blocks.splice(index+1,0,b);this.selected=b.id;}
  if(action==='up'&&index>0)moveBlock(d,id,d.blocks[index-1].id);
  if(action==='down'&&index<d.blocks.length-1)moveBlock(d,id,d.blocks[index+2]?.id||null);
  this.changed();this.renderTimeline();this.renderInspector();
 }
 revealInspector(){if(matchMedia('(max-width:720px)').matches)$('#planner-inspector').scrollIntoView?.({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}
 setRunState(state){this.runState=state;for(const row of document.querySelectorAll('#planner-flow [data-block-id]'))row.classList.toggle('running',!!state?.active&&row.dataset.blockId===state.blockId);}
 bindDrag(){
  const root=$('#page-voorbereiding');let drag=null,touch=null;
  const clear=()=>{document.body.classList.remove('planner-dragging');for(const slot of root.querySelectorAll('.drop-active'))slot.classList.remove('drop-active');drag=null;};
  const targetAt=(x,y)=>{
   const el=document.elementFromPoint(x,y),slot=el?.closest('.timeline-drop');if(slot)return slot;
   const row=el?.closest('.timeline-step');if(!row)return null;const rect=row.getBoundingClientRect();return y<rect.top+rect.height/2?row.previousElementSibling:row.nextElementSibling;
  };
  const mark=slot=>{for(const node of root.querySelectorAll('.drop-active'))node.classList.remove('drop-active');slot?.classList.add('drop-active');};
  const drop=slot=>{if(!drag||!slot||!this.document)return;const before=slot.dataset.before||null;if(drag.type==='widget')this.add(drag.value,before);else if(moveBlock(this.document,drag.value,before)){this.changed();this.renderTimeline();}};
  root.addEventListener('dragstart',event=>{const handle=event.target.closest('[data-drag-id],[data-drag-kind]');if(!handle||!this.document)return;drag={type:handle.dataset.dragId?'block':'widget',value:handle.dataset.dragId||handle.dataset.dragKind};event.dataTransfer.setData('application/x-vlampie-show',JSON.stringify(drag));event.dataTransfer.effectAllowed=drag.type==='block'?'move':'copy';document.body.classList.add('planner-dragging');});
  root.addEventListener('dragover',event=>{if(!drag)return;const slot=targetAt(event.clientX,event.clientY);if(slot){event.preventDefault();event.dataTransfer.dropEffect=drag.type==='block'?'move':'copy';mark(slot);}});
  root.addEventListener('drop',event=>{if(!drag)return;event.preventDefault();drop(targetAt(event.clientX,event.clientY));clear();});root.addEventListener('dragend',clear);
  root.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse')return;const handle=event.target.closest('[data-drag-id],[data-drag-kind]');if(!handle||!this.document)return;touch={id:event.pointerId,x:event.clientX,y:event.clientY,handle,active:false};handle.setPointerCapture?.(event.pointerId);});
  root.addEventListener('pointermove',event=>{
   if(!touch||touch.id!==event.pointerId)return;
   if(!touch.active&&Math.hypot(event.clientX-touch.x,event.clientY-touch.y)>8){touch.active=true;drag={type:touch.handle.dataset.dragId?'block':'widget',value:touch.handle.dataset.dragId||touch.handle.dataset.dragKind};document.body.classList.add('planner-dragging');}
   if(touch.active){event.preventDefault();mark(targetAt(event.clientX,event.clientY));const panel=$('#page-voorbereiding'),r=panel.getBoundingClientRect();if(event.clientY>r.bottom-70)panel.scrollTop+=18;if(event.clientY<r.top+70)panel.scrollTop-=18;}
  },{passive:false});
  root.addEventListener('pointerup',event=>{if(!touch||touch.id!==event.pointerId)return;const moved=touch.active;if(moved){event.preventDefault();drop(targetAt(event.clientX,event.clientY));this.suppressClickUntil=performance.now()+400;}touch=null;clear();});
  root.addEventListener('pointercancel',()=>{touch=null;clear();});root.addEventListener('click',event=>{if(performance.now()<this.suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
 }
 bindPatterns(){
  $('#pattern-new').addEventListener('click',()=>{if(!this.document)return;this.patternDraft={id:newId('patroon'),title:'',cells:[],freeCenter:true,variant:'fixed'};this.renderPatternEditor();this.renderPatterns();$('#pattern-name').focus();});
  $('#patterns-list').addEventListener('click',event=>{const el=event.target.closest('[data-pattern]');if(!el)return;this.patternDraft=clone(this.document.patterns.find(p=>p.id===el.dataset.pattern));this.renderPatterns();this.renderPatternEditor();});
  $('#pattern-name').addEventListener('input',event=>{if(this.patternDraft)this.patternDraft.title=event.target.value;});
  $('#pattern-free').addEventListener('change',event=>{if(!this.patternDraft)return;this.patternDraft.freeCenter=event.target.checked;this.renderPatternGrid();});
  $('#pattern-variant').addEventListener('change',event=>{if(!this.patternDraft)return;this.patternDraft.variant=event.target.value;if(['rows','doubleRows'].includes(event.target.value))this.patternDraft.cells=Array.from({length:event.target.value==='doubleRows'?10:5},(_,i)=>i);this.renderPatternGrid();});
  $('#pattern-grid').addEventListener('click',event=>{const el=event.target.closest('[data-cell]'),p=this.patternDraft;if(!el||!p||['rows','doubleRows'].includes(p.variant))return;const n=Number(el.dataset.cell);p.cells=p.cells.includes(n)?p.cells.filter(c=>c!==n):[...p.cells,n].sort((a,b)=>a-b);this.renderPatternGrid();});
  $('#pattern-copy').addEventListener('click',()=>{if(!this.patternDraft)return;this.patternDraft={...clone(this.patternDraft),id:newId('patroon'),title:(this.patternDraft.title.slice(0,52)+' · kopie').trim()};this.renderPatterns();this.renderPatternEditor();});
  $('#pattern-form').addEventListener('submit',async event=>{
   event.preventDefault();const p=this.patternDraft;if(!this.document||!p)return;
   if(!p.title.trim()||!p.cells.some(c=>c!==12||!p.freeCenter)){$('#pattern-status').textContent='Geef het patroon een naam en kies minimaal één niet-vrij vakje.';return;}
   const i=this.document.patterns.findIndex(x=>x.id===p.id);if(i<0&&this.document.patterns.length>=80)return this.onNotice('Er kunnen maximaal 80 patronen worden bewaard.');if(i<0)this.document.patterns.push(clone(p));else this.document.patterns[i]=clone(p);
   this.changed();this.renderPatterns();this.renderInspector();this.renderTimeline();this.renderPatternEditor();try{await this.flush();$('#pattern-status').textContent='Patroon opgeslagen. Je kunt het nu aan een ronde koppelen.';}catch(error){$('#pattern-status').textContent=error.message;}
  });
  $('#pattern-delete').addEventListener('click',async()=>{const p=this.patternDraft;if(!p||!this.document)return;const used=this.usedIn('patternId',p.id);if(used)return $('#pattern-status').textContent=`Dit patroon wordt gebruikt in ${used}. Kies daar eerst een ander patroon.`;this.document.patterns=this.document.patterns.filter(x=>x.id!==p.id);this.patternDraft=clone(this.document.patterns[0]||{id:newId('patroon'),title:'',cells:[],freeCenter:true,variant:'fixed'});this.changed();this.renderPatterns();this.renderPatternEditor();this.renderInspector();try{await this.flush();}catch(error){$('#pattern-status').textContent=error.message;}});
 }
 usedIn(field,id){return this.document.blocks.filter(b=>b.type==='round'&&b.goals.some(g=>g[field]===id)).map(b=>b.title).join(', ');}
 renderPatterns(){if(!this.document)return;$('#patterns-list').innerHTML=this.document.patterns.length?this.document.patterns.map(p=>`<button type="button" class="pattern-catalog-card ${p.id===this.patternDraft?.id?'selected':''}" data-pattern="${esc(p.id)}" aria-pressed="${p.id===this.patternDraft?.id}">${patternPreview(p)}<strong>${esc(p.title)}</strong><span>${p.variant==='doubleRows'?'Twee horizontale rijen':p.variant==='rows'?'Elke horizontale rij':`${p.cells.filter(c=>c!==12||!p.freeCenter).length} vakjes`}${p.freeCenter?' · vrij midden':''}</span></button>`).join(''):'<div class="catalog-empty">Nog geen patronen. Maak je eerste patroon met Nieuw patroon.</div>';}
 renderPatternEditor(){const p=this.patternDraft;if(!p)return;$('#pattern-name').value=p.title;$('#pattern-free').checked=p.freeCenter;$('#pattern-variant').value=p.variant;$('#pattern-editor-heading').textContent=this.document.patterns.some(x=>x.id===p.id)?'Patroon bewerken':'Nieuw patroon';$('#pattern-delete').hidden=!this.document.patterns.some(x=>x.id===p.id);$('#pattern-status').textContent='';this.renderPatternGrid();}
 renderPatternGrid(){const p=this.patternDraft;if(!p)return;$('#pattern-variant-help').textContent=p.variant==='doubleRows'?'Twee willekeurige horizontale rijen tellen. Het voorbeeld toont de bovenste twee rijen.':p.variant==='rows'?'Elke horizontale rij telt. Het voorbeeld toont de bovenste rij.':'Alle gemarkeerde vakjes moeten compleet zijn.';$('#pattern-grid').innerHTML=Array.from({length:25},(_,i)=>{const free=i===12&&p.freeCenter;return `<button type="button" data-cell="${i}" class="${p.cells.includes(i)?'marked':''} ${free?'free':''}" aria-label="Rij ${Math.floor(i/5)+1}, kolom ${'BINGO'[i%5]}${free?', vrij middenvak':''}" aria-pressed="${p.cells.includes(i)}" ${free||['rows','doubleRows'].includes(p.variant)?'disabled':''}>${free?'VRIJ':p.cells.includes(i)?'●':''}</button>`;}).join('');}
 bindPrizes(){
  $('#prize-new').addEventListener('click',()=>{if(!this.document)return;this.prizeDraft={id:newId('prijs'),title:'',description:'',image:''};this.uploadSerial++;this.uploading=false;this.renderPrizes();this.renderPrizeEditor();$('#catalog-prize-title').focus();});
  $('#prizes-list').addEventListener('click',event=>{const el=event.target.closest('[data-prize]');if(!el)return;this.prizeDraft=clone(this.document.prizes.find(p=>p.id===el.dataset.prize));this.uploadSerial++;this.uploading=false;this.renderPrizes();this.renderPrizeEditor();});
  $('#catalog-prize-title').addEventListener('input',event=>{if(this.prizeDraft)this.prizeDraft.title=event.target.value;});$('#catalog-prize-description').addEventListener('input',event=>{if(this.prizeDraft)this.prizeDraft.description=event.target.value;});
  $('#prize-image-choose').addEventListener('click',()=>$('#prize-upload').click());
  $('#prize-upload').addEventListener('change',()=>this.uploadPrize());
  $('#prize-image-clear').addEventListener('click',()=>{if(!this.prizeDraft)return;this.uploadSerial++;this.uploading=false;this.prizeDraft.image='';this.renderPrizeEditor();});
  $('#prize-form').addEventListener('submit',async event=>{
   event.preventDefault();const p=this.prizeDraft;if(!this.document||!p||this.uploading)return;if(!p.title.trim())return;
   const i=this.document.prizes.findIndex(x=>x.id===p.id);if(i<0&&this.document.prizes.length>=100)return this.onNotice('Er kunnen maximaal 100 prijzen worden bewaard.');if(i<0)this.document.prizes.push(clone(p));else this.document.prizes[i]=clone(p);
   this.changed();this.renderPrizes();this.renderInspector();this.renderTimeline();this.renderPrizeEditor();try{await this.flush();$('#prize-status').textContent='Prijs opgeslagen. Je kunt deze nu aan een ronde koppelen.';}catch(error){$('#prize-status').textContent=error.message;}
  });
  $('#prize-delete').addEventListener('click',async()=>{const p=this.prizeDraft;if(!p||!this.document)return;const used=this.usedIn('prizeId',p.id);if(used)return $('#prize-status').textContent=`Deze prijs wordt gebruikt in ${used}. Kies daar eerst een andere prijs.`;this.document.prizes=this.document.prizes.filter(x=>x.id!==p.id);this.prizeDraft=clone(this.document.prizes[0]||{id:newId('prijs'),title:'',description:'',image:''});this.uploadSerial++;this.uploading=false;this.changed();this.renderPrizes();this.renderPrizeEditor();this.renderInspector();try{await this.flush();}catch(error){$('#prize-status').textContent=error.message;}});
 }
 renderPrizes(){if(!this.document)return;$('#prizes-list').innerHTML=this.document.prizes.length?this.document.prizes.map(p=>`<button type="button" class="prize-catalog-card ${p.id===this.prizeDraft?.id?'selected':''}" data-prize="${esc(p.id)}" aria-pressed="${p.id===this.prizeDraft?.id}"><div class="prize-card-image">${p.image?`<img src="${esc(p.image)}" alt="" loading="lazy">`:`${icon('i-star')}<span>Afbeelding toevoegen</span>`}</div><div class="prize-card-copy"><strong>${esc(p.title)}</strong><p>${esc(p.description||'Geen omschrijving')}</p><span>${this.usedIn('prizeId',p.id)?esc(this.usedIn('prizeId',p.id)):'Nog niet aan een ronde gekoppeld'}</span></div></button>`).join(''):'<div class="catalog-empty">Nog geen prijzen. Voeg je eerste prijs toe met Nieuwe prijs.</div>';}
 renderPrizeEditor(){const p=this.prizeDraft;if(!p)return;$('#catalog-prize-title').value=p.title;$('#catalog-prize-description').value=p.description;$('#prize-editor-heading').textContent=this.document.prizes.some(x=>x.id===p.id)?'Prijs bewerken':'Nieuwe prijs';$('#prize-image-preview').hidden=!p.image;$('#prize-image-placeholder').hidden=!!p.image;if(p.image)$('#prize-image-preview').src=p.image;else $('#prize-image-preview').removeAttribute('src');$('#prize-image-clear').hidden=!p.image;$('#prize-delete').hidden=!this.document.prizes.some(x=>x.id===p.id);$('#prize-upload').value='';$('#prize-save').disabled=this.uploading;$('#prize-image-choose').disabled=this.uploading;$('#prize-status').textContent='';$('#prize-upload-status').textContent=p.image?'Afbeelding geüpload. Bewaar de prijs om deze te koppelen.':'JPG, PNG of WebP. Grote afbeeldingen worden passend gemaakt.';}
 async uploadPrize(){
  const file=$('#prize-upload').files[0],draft=this.prizeDraft;if(!file||!draft)return;const serial=++this.uploadSerial;this.uploading=true;$('#prize-save').disabled=true;$('#prize-image-choose').disabled=true;$('#prize-upload-status').textContent='Afbeelding voorbereiden en opslaan…';
  try{
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12*1024*1024)throw new Error('Kies een JPG-, PNG- of WebP-afbeelding van maximaal 12 MB.');
   const bitmap=await createImageBitmap(file),scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));let blob=file;
   if(scale<1||file.size>3*1024*1024){const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.88));}
   bitmap.close();if(!blob||blob.size>3*1024*1024)throw new Error('De afbeelding kon niet passend worden gemaakt. Kies een kleiner bestand.');
   const result=await api('images',{method:'POST',headers:{'Content-Type':blob.type},body:blob});if(serial!==this.uploadSerial||draft!==this.prizeDraft)return;
   this.prizeDraft.image=result.image;this.uploading=false;this.renderPrizeEditor();$('#prize-upload-status').textContent='Afbeelding geüpload. Kies Prijs bewaren om de prijs op te slaan.';
  }catch(error){if(serial===this.uploadSerial){this.uploading=false;$('#prize-upload-status').textContent=error.message;}}
  finally{if(serial===this.uploadSerial){$('#prize-save').disabled=false;$('#prize-image-choose').disabled=false;}}
 }
}
