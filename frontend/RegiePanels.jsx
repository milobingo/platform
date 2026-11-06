import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,Columns3,ExternalLink,GripVertical,PanelBottomClose,RotateCcw} from 'lucide-react';
import {DEFAULT_REGIE_PANELS,layoutKey,normalizeLayout,movePanel,revealPanel,resizeColumns} from './regie-layout.js';
import './regie-panels.css';

function Mount({target}) {
 const ref=useRef(null);
 useLayoutEffect(()=>{const host=ref.current;if(target)host.appendChild(target);return()=>{if(target?.parentNode===host)host.removeChild(target);};},[target]);
 return <div className="rd-panel-host" ref={ref}/>;
}

/** Panels retain one React tree and one engine while their DOM moves to a child window. */
export default function RegiePanels({panels,production='milo',onNotice,focusPanel}) {
 const ids=panels.map(p=>p.id),registry=new Map(panels.map(p=>[p.id,p]));
 const initial=()=>{try{return normalizeLayout(JSON.parse(localStorage.getItem(layoutKey(production))),ids);}catch{return normalizeLayout(null,ids);}};
 const [compact,setCompact]=useState(()=>typeof window.matchMedia==='function'&&window.matchMedia('(max-width:1099px)').matches);
 useEffect(()=>{const media=window.matchMedia?.('(max-width:1099px)');if(!media)return;const changed=()=>setCompact(media.matches);changed();media.addEventListener?.('change',changed);return()=>media.removeEventListener?.('change',changed);},[]);
 const [layout,setLayout]=useState(initial),[active,setActive]=useState(()=>Math.max(0,Math.min(2,initial().slots.length-1))),[detached,setDetached]=useState({}),[dragging,setDragging]=useState('');
 const windows=useRef(new Map()),targets=useRef(new Map()),visited=useRef(new Set()),layoutRef=useRef(layout),noticeRef=useRef(onNotice),dockRef=useRef(null),alive=useRef(true),resizeCleanup=useRef(null),brandRef=useRef(production);
 layoutRef.current=layout;noticeRef.current=onNotice;
 const getTarget=id=>{if(!targets.current.has(id)){const node=document.createElement('div');node.className='rd-panel-mount';targets.current.set(id,node);}return targets.current.get(id);};
 const remember=next=>{setLayout(current=>typeof next==='function'?next(current):next);};
 const clearDetached=id=>{
  const entry=windows.current.get(id);if(!entry)return;
  entry.window.removeEventListener('pagehide',entry.onClose);entry.document.removeEventListener('click',entry.onClick);
  windows.current.delete(id);
  if(alive.current){setDetached(prev=>{const next={...prev};delete next[id];return next;});setLayout(current=>revealPanel(current,id,current.slots.length-1));}
 };
 const restore=id=>{const entry=windows.current.get(id);clearDetached(id);try{entry?.window.close();}catch{}};
 const restoreAll=()=>[...windows.current.keys()].forEach(restore);
 const showPanel=id=>{
  if(!registry.has(id))return;
  const child=windows.current.get(id)?.window;if(child&&!child.closed){child.focus();return;}
  const index=layoutRef.current.slots.indexOf(id);
  if(index>=0){setActive(index);requestAnimationFrame(()=>targets.current.get(id)?.querySelector('.rd-panel-heading')?.focus());return;}
  const slot=Math.min(active,layoutRef.current.slots.length-1);remember(current=>revealPanel(current,id,slot));setActive(slot);
 };
 const popout=id=>{
  const existing=windows.current.get(id)?.window;if(existing&&!existing.closed){existing.focus();return;}
  let child;
  try{child=window.open('about:blank','mf-regie-'+production+'-'+id,'popup=yes,width=650,height=760,resizable=yes,scrollbars=yes');}catch{}
  if(!child||child.closed){noticeRef.current?.('Dit paneel blijft in de regie. Sta pop-ups voor deze site toe om het los te maken.');return;}
  try{
   const doc=child.document;doc.documentElement.lang='nl';
   doc.head.replaceChildren();const base=doc.createElement('base');base.href=window.location.href;doc.head.appendChild(base);
   doc.title=registry.get(id).title+' · Live regie';
   document.head.querySelectorAll('link[rel="stylesheet"],style').forEach(node=>doc.head.appendChild(node.cloneNode(true)));
   doc.body.replaceChildren();doc.body.className='rd-popout-document';
   const shell=doc.createElement('main');shell.className='mf-broadcast-shell is-regie rd-workspace rd-popout-shell';shell.dataset.brand=production;doc.body.appendChild(shell);
   const onClose=()=>clearDetached(id);
   const onClick=event=>{const link=event.target.closest?.('a[href]'),href=link?.getAttribute('href');if(href?.startsWith('#/')){event.preventDefault();window.location.hash=href.slice(1);window.focus();}};
   child.addEventListener('pagehide',onClose);doc.addEventListener('click',onClick);
   windows.current.set(id,{window:child,document:doc,onClose,onClick,shell});
   shell.appendChild(getTarget(id));setDetached(prev=>({...prev,[id]:true}));child.focus();
  }catch{try{child.close();}catch{}noticeRef.current?.('Het losse venster kon niet worden geopend. Het paneel blijft beschikbaar in de regie.');}
 };
 useEffect(()=>{if(brandRef.current!==production)return;try{localStorage.setItem(layoutKey(production),JSON.stringify(layout));}catch{}},[layout,production]);
 useEffect(()=>{if(brandRef.current!==production){restoreAll();brandRef.current=production;setLayout(initial());setActive(2);}},[production]);
 useEffect(()=>{if(focusPanel?.id)showPanel(focusPanel.id);},[focusPanel?.id,focusPanel?.nonce]);
 useEffect(()=>{
  alive.current=true;
  const close=()=>{for(const entry of windows.current.values()){entry.window.removeEventListener('pagehide',entry.onClose);entry.document.removeEventListener('click',entry.onClick);try{entry.window.close();}catch{}}windows.current.clear();if(alive.current)setDetached({});};
  window.addEventListener('pagehide',close);
  const timer=setInterval(()=>{for(const [id,entry] of windows.current){if(entry.window.closed)clearDetached(id);}},700);
  return()=>{alive.current=false;clearInterval(timer);resizeCleanup.current?.();window.removeEventListener('pagehide',close);close();};
 },[]);
 const changeCount=count=>{
  const current=layoutRef.current,remaining=ids.filter(id=>!current.slots.includes(id));
  const slots=[...current.slots,...remaining].slice(0,count);
  remember(normalizeLayout({slots,weights:slots.map((_,i)=>current.weights[i]||1)},ids));setActive(Math.min(active,count-1));
 };
 const shift=(id,step)=>remember(current=>{const index=current.slots.indexOf(id);return movePanel(current,id,current.slots[index+step]);});
 const drop=(event,targetId)=>{event.preventDefault();const id=event.dataTransfer.getData('text/plain')||dragging;if(registry.has(id))remember(current=>current.slots.includes(id)?movePanel(current,id,targetId):revealPanel(current,id,current.slots.indexOf(targetId)));setDragging('');};
 const startResize=(event,index)=>{
  if(event.button!==0)return;event.preventDefault();resizeCleanup.current?.();
  const startX=event.clientX,start=layoutRef.current,width=dockRef.current?.getBoundingClientRect().width||1000,total=start.weights.reduce((a,b)=>a+b,0),doc=event.currentTarget.ownerDocument;
  const move=e=>remember(resizeColumns(start,index,(e.clientX-startX)/width*total));
  const stop=()=>{doc.removeEventListener('pointermove',move);doc.removeEventListener('pointerup',stop);doc.removeEventListener('pointercancel',stop);doc.body.classList.remove('rd-resizing');resizeCleanup.current=null;};
  resizeCleanup.current=stop;doc.body.classList.add('rd-resizing');doc.addEventListener('pointermove',move);doc.addEventListener('pointerup',stop);doc.addEventListener('pointercancel',stop);
 };
 const renderedSlots=compact?[layout.slots[Math.min(active,layout.slots.length-1)]]:layout.slots;
 const visible=new Set([...renderedSlots,...Object.keys(detached)]);
 for(const id of visible)visited.current.add(id);
 return <section className={"rd-modular "+(compact?'is-compact':'')} aria-label="Modulaire werkpanelen">
  <header className="rd-modular-toolbar">
   <label className="rd-mobile-panel-picker"><span>Werkpaneel</span><select aria-label="Mobiel werkpaneel" value={renderedSlots[0]} onChange={e=>showPanel(e.target.value)}>{panels.map(({id,title})=><option key={id} value={id}>{title}{detached[id]?' · los venster':''}</option>)}</select></label>
   <div className="rd-module-tabs" aria-label="Werkpanelen kiezen">{panels.map(({id,title,icon:Icon})=><button type="button" key={id} data-module-id={id} aria-label={'Paneel '+title+' tonen'} aria-pressed={visible.has(id)} className={(visible.has(id)?'visible ':'')+(layout.slots[active]===id?'selected':'')} onClick={()=>showPanel(id)}>{Icon&&<Icon size={13}/>}<span>{title}</span>{detached[id]&&<ExternalLink size={11}/>}</button>)}</div>
   <div className="rd-layout-tools"><label title="Aantal werkpanelen naast elkaar"><Columns3 size={14}/><select aria-label="Aantal werkpanelen" value={layout.slots.length} onChange={e=>changeCount(+e.target.value)}>{[1,2,3,4].filter(n=>n<=ids.length).map(n=><option key={n} value={n}>{n} panelen</option>)}</select></label><button type="button" title="Alle panelen terug en standaardindeling herstellen" aria-label="Standaardindeling herstellen" onClick={()=>{restoreAll();remember(normalizeLayout({slots:DEFAULT_REGIE_PANELS},ids));setActive(2);}}><RotateCcw size={14}/></button></div>
  </header>
  <div className="rd-panel-grid" ref={dockRef} style={{gridTemplateColumns:compact?'minmax(0,1fr)':layout.slots.map((_,i)=>`minmax(0,${layout.weights[i]}fr)`).join(' 7px ')}}>
   {renderedSlots.map(id=>{const index=layout.slots.indexOf(id);return <React.Fragment key={id}>
    {!compact&&index>0&&<div className="rd-panel-resizer" role="separator" aria-label={'Breedte tussen paneel '+index+' en '+(index+1)} aria-orientation="vertical" aria-valuemin={55} aria-valuemax={250} aria-valuenow={Math.round(layout.weights[index-1]*100)} tabIndex={0} onPointerDown={e=>startResize(e,index-1)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();remember(current=>e.key==='Home'?{...current,weights:current.weights.map(()=>1)}:resizeColumns(current,index-1,e.key==='ArrowLeft'?-.1:.1));}}}><i/></div>}
    <div className={'rd-panel-slot '+(active===index?'active ':'')+(dragging?'drag-ready':'')} onFocusCapture={()=>setActive(index)} onPointerDown={()=>setActive(index)} onDragOver={e=>{if(dragging)e.preventDefault();}} onDrop={e=>drop(e,id)}>
     {detached[id]?<div className="rd-panel-detached"><ExternalLink size={27}/><strong>{registry.get(id)?.title}</strong><p>Dit paneel staat in een los venster.</p><button type="button" onClick={()=>windows.current.get(id)?.window.focus()}>Venster naar voren</button><button type="button" className="rd-reattach" onClick={()=>restore(id)}>Terug in de regie</button></div>:<Mount target={getTarget(id)}/>}
    </div>
   </React.Fragment>;})}
  </div>
  <div className="rd-layout-hint"><span><GripVertical size={12}/>Sleep een paneel bij de titel. Versleep de scheiding voor meer ruimte.</span><span>Indeling wordt bewaard{Object.keys(detached).length?' · Hoofdregie openhouden':''}</span></div>
  <div className="rd-panel-parking" hidden aria-hidden="true">{[...visited.current].filter(id=>!visible.has(id)).map(id=><Mount key={id} target={getTarget(id)}/>)}</div>
  {[...visited.current].map(id=>{
   const panel=registry.get(id);if(!panel)return null;const index=layout.slots.indexOf(id),Icon=panel.icon;
   return createPortal(<section className={'rd-module-card '+(detached[id]?'is-detached':'')} data-panel-id={id} aria-label={panel.title} onPointerDown={()=>{if(index>=0)setActive(index);}} onFocusCapture={()=>{if(index>=0)setActive(index);}} onDragOver={e=>{if(dragging)e.preventDefault();}} onDrop={e=>drop(e,id)}>
    <header className="rd-panel-heading" tabIndex={-1}>
     <button type="button" className="rd-panel-grip" draggable={!detached[id]} aria-label={panel.title+' verplaatsen'} title="Sleep om te verplaatsen; gebruik de pijlen voor toetsenbordbediening" onDragStart={e=>{setDragging(id);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',id);}} onDragEnd={()=>setDragging('')}><GripVertical size={14}/></button>
     {Icon&&<Icon size={14}/>}<h2>{panel.title}</h2>
     <div className="rd-panel-actions">{!detached[id]&&<><button type="button" aria-label={panel.title+' naar links'} title="Paneel naar links" disabled={index<=0} onClick={()=>shift(id,-1)}><ArrowLeft size={13}/></button><button type="button" aria-label={panel.title+' naar rechts'} title="Paneel naar rechts" disabled={index<0||index===layout.slots.length-1} onClick={()=>shift(id,1)}><ArrowRight size={13}/></button></>}
      <button type="button" aria-label={panel.title+(detached[id]?' terugzetten':' losmaken')} title={detached[id]?'Terug in de regie':'Los venster · handig voor een tweede scherm'} onClick={()=>detached[id]?restore(id):popout(id)}>{detached[id]?<PanelBottomClose size={15}/>:<ExternalLink size={14}/>}</button>
     </div>
    </header>
    {detached[id]&&<div className="rd-popout-notice">Gekoppeld aan de hoofdregie · houd die geopend. Sluit dit venster om het paneel terug te zetten.</div>}
    <div className="rd-module-content" data-module-kind={id} tabIndex={0} aria-label={'Inhoud '+panel.title}>{panel.content}</div>
   </section>,getTarget(id),id);
  })}
 </section>;
}
