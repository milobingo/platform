import {showBrand,brandText,BRAND_IDS} from './show-brands.js?v=36';
export const currentBrand=()=>showBrand(globalThis.document?.body?.dataset.brand||'vlampie');
export const bt=text=>brandText(text,currentBrand());
let staticNodes=[],staticAttributes=[],initialized=false,lastApplied=null,originalIcon=null;
export function captureStaticBranding(){
 if(initialized)return;initialized=true;
 const walk=document.createTreeWalker(document.body,(globalThis.NodeFilter?.SHOW_TEXT||4));
 while(walk.nextNode()){const n=walk.currentNode;if(/Vlampie|VLAMPIE/.test(n.textContent)&&!n.parentElement?.closest('script,style,textarea'))staticNodes.push([n,n.textContent]);}
 for(const node of document.querySelectorAll('*'))for(const attr of ['alt','aria-label','title','placeholder']){const value=node.getAttribute(attr);if(value&&/Vlampie|VLAMPIE/.test(value))staticAttributes.push([node,attr,value]);}
 for(const img of document.querySelectorAll('img[src$="studio-logo.png"]'))img.dataset.brandLogo='';
}
export function applyBrand(identity){
 const b=showBrand(identity),old=currentBrand(),changed=lastApplied!==b.id;document.body.dataset.brand=b.id;
 if(changed){lastApplied=b.id;
 for(const [key,value] of Object.entries(b.palette))document.documentElement.style.setProperty('--brand-'+key,value);
 document.documentElement.style.setProperty('--brand-logo',`url("${b.logo}")`);
 document.documentElement.style.setProperty('--brand-studio',`url("${b.id==='vlampie'?'/assets/studio-master-v14.png':'/assets/hosts/'+b.id+'-master-v36.webp'}")`);
 for(const [node,value] of staticNodes)if(node.isConnected)node.textContent=brandText(value,b);
 for(const [node,attr,value] of staticAttributes)if(node.isConnected)node.setAttribute(attr,brandText(value,b));
 document.documentElement.style.setProperty('--brand-mascot',`url("${b.mascot}")`);
 const icon=document.querySelector('link[rel=icon]');if(icon){originalIcon??={href:icon.href,type:icon.type};icon.href=b.id==='vlampie'?originalIcon.href:b.logo;icon.type=b.id==='vlampie'?originalIcon.type:'image/png';}
 }
 document.title=brandText(document.title,b);
 const description=document.querySelector('meta[name=description]');if(description)description.content=brandText(description.content,b);
 const themeColor=document.querySelector('meta[name=theme-color]');if(themeColor)themeColor.content=b.palette.base;
 for(const img of document.querySelectorAll('[data-brand-logo]')){if(img.getAttribute('src')!==b.logo)img.src=b.logo;img.alt=b.title;}
 for(const select of document.querySelectorAll('[data-brand-switch]'))select.value=b.id;
 for(const node of document.querySelectorAll('[data-brand-choice]')){const active=node.dataset.brandChoice===b.id;node.classList.toggle('selected',active);node.setAttribute('aria-pressed',String(active));}
 for(const node of document.querySelectorAll('[data-brand-name]'))node.textContent=b.name;
 for(const node of document.querySelectorAll('[data-brand-title]'))node.textContent=b.title;
 for(const node of document.querySelectorAll('[data-brand-studio-name]'))node.textContent=b.studio;
 for(const node of document.querySelectorAll('.sidebar-emblem'))node.textContent=b.short[0];const mark=document.querySelector('.brand-mark');if(mark?.firstChild)mark.firstChild.textContent=b.short[0];
 for(const id of ['game-title','show-title']){const input=document.getElementById(id);if(input&&BRAND_IDS.some(id=>showBrand(id).title===input.value))input.value=b.title;}
 for(const button of document.querySelectorAll('[data-scene]')){if(button.dataset.scene==='host'){const label=button.querySelector('.scene-name');if(label)label.textContent=b.short;}for(const attr of ['aria-label','title']){const value=button.getAttribute(attr);if(value)button.setAttribute(attr,brandText(value,b));}}
 const seasonal=document.querySelector('[data-line=sint]');if(seasonal)seasonal.hidden=b.id!=='vlampie';
 for(const node of document.querySelectorAll('[data-camera=audience] span,option[value=audience]'))node.textContent=b.id==='vlampie'?'Publiek':'Publieksmoment';
 const speech=document.getElementById('speech-text');if(speech&&(speech.value===speech.defaultValue||BRAND_IDS.some(id=>speech.value===showBrand(id).intro)))speech.value=b.intro;
 if(old.id!==b.id)document.dispatchEvent(new CustomEvent('show-brand-changed',{detail:b}));
 return b;
}
export function brandOptions(selected='vlampie'){return BRAND_IDS.map(id=>{const b=showBrand(id);return `<option value="${id}" ${id===selected?'selected':''}>${b.name}</option>`;}).join('');}
export function mountBrandSwitch(onChoose){
 const header=document.querySelector('#studio-brand-choice')||document.querySelector('.header-actions');if(!header)return;
 const wrap=document.createElement('label');wrap.className='host-switch';wrap.innerHTML=`<span>Showhost</span><select data-brand-switch aria-label="Showhost en volledige showwereld">${brandOptions(currentBrand().id)}</select>`;header.prepend(wrap);
 const page=document.querySelector('#page-studio'),gallery=document.createElement('section');gallery.className='host-worlds';gallery.innerHTML=`<div class="host-worlds-heading"><div><span class="eyebrow">DRIE HOSTS · DRIE SHOWWERELDEN</span><h2>Wie presenteert jouw show?</h2><p>Eén keuze voor de studio, de uitzending en de spelerservaring.</p></div><span class="host-active-studio" data-brand-studio-name></span></div><div class="host-world-grid">${BRAND_IDS.map(id=>{const b=showBrand(id);return `<button type="button" class="host-world-card" data-brand-choice="${id}" aria-pressed="false" style="--world-accent:${b.palette.accent};--world-bg:${b.palette.base}"><div class="host-world-art"><img class="host-world-set" src="${id==='vlampie'?'/assets/studio-master-v14.png':'/assets/hosts/'+id+'-master-v36.webp'}" alt="" loading="lazy"><img class="host-world-character" src="${b.mascot}" alt="${b.name}" loading="lazy"><span class="host-world-check">Geselecteerd</span></div><div class="host-world-copy"><small>${b.studio}</small><strong>${b.name}</strong><p>${b.signature}</p><span>Gebruik deze showwereld</span></div></button>`;}).join('')}</div><p class="host-switch-feedback" id="host-switch-feedback" role="status">De keuze wordt bij je geselecteerde spel bewaard. Je kunt hier ook de studio’s bekijken.</p><details class="host-scene-catalog"><summary>Alle scènes in deze showwereld</summary><div>${['Still & showlogo','Opening & countdown','Presentator aan de desk','Volgende bal & onthulling','Bingobord · 75 getallen','Ronde & patronen','Spelregels','Prijs onthullen','Vraag aan de host','Bingokaart controleren','Belmoment','Minigames','Voorprogramma','Pauze','Publieksmoment','Finale'].map(t=>`<span>${t}</span>`).join('')}</div><p>Alle scènes volgen automatisch de gekozen showhost, inclusief logo-overgangen, persoonlijkheid en spelersschermen.</p><button type="button" class="button primary" data-export-scene>Exporteer huidige scène · 8K</button><p>Export: 7680 × 4320 pixels. Studio-artwork is opgeschaald; tekst en showgraphics worden op exportformaat getekend.</p><a id="host-art-download" href="/assets/hosts/rocco-artwork.zip?v=36" download>Download Rocco artwork</a> <a href="/assets/hosts/milo-artwork.zip?v=36" download>Download Milo artwork</a></details>`;page?.prepend(gallery);
 wrap.querySelector('select').addEventListener('change',event=>onChoose(event.target.value));gallery.addEventListener('click',event=>{const button=event.target.closest('[data-brand-choice]');if(button)onChoose(button.dataset.brandChoice);if(event.target.closest('[data-export-scene]'))document.dispatchEvent(new Event('export-show-scene'));});applyBrand(currentBrand());
}
