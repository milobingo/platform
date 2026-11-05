import {bt} from './brand-ui.js?v=37';
export const DASHBOARD_PAGES=Object.freeze({overzicht:'Overzicht',regie:'Live regie',spellen:'Mijn shows',voorbereiding:'Draaiboek',patronen:'Patronen',prijzen:'Prijzen',studio:'Host & decor',vlampie:'Stem & persoonlijkheid',spelregels:'Spelregels',chat:'Publiek & chat',koppeling:'Koppelingen'});
export function dashboardPage(hash){const key=String(hash||'').replace(/^#/,'');return Object.hasOwn(DASHBOARD_PAGES,key)?key:'regie';}

// The stage keeps its native 16:9 shape; spare horizontal space belongs to chat.
export function fitProgramWidth({width,height,chrome=76,gap=12,chatMin=260,compact=false,mobile=false}){
 const available=Math.max(0,Number(width)||0);
 const widthLimit=compact||mobile?available:Math.max(0,Math.min((available-gap)*.68,available-gap-chatMin));
 const heightLimit=mobile?available:Math.max(0,(Number(height)-chrome)*16/9);
 return Math.max(0,Math.floor(Math.min(widthLimit,heightLimit)*100)/100);
}

// Switching the operator panel never changes the live show.
export function setConsoleView(value,{focus=false}={}){
 const view=['monitor','bingo','books','vlampie','calls'].includes(value)?value:'monitor';document.body.dataset.console=view;
 for(const button of document.querySelectorAll('[data-console-view]')){const selected=button.dataset.consoleView===view;button.setAttribute('aria-pressed',String(selected));if(selected&&focus)button.focus({preventScroll:true});}
 const monitor=document.querySelector('#console-monitor'),bingo=document.querySelector('#bingo-regie');if(monitor)monitor.hidden=view!=='monitor';if(bingo)bingo.hidden=!['bingo','books'].includes(view);const presenter=document.querySelector('#console-vlampie');if(presenter)presenter.hidden=view!=='vlampie';const calls=document.querySelector('#console-calls');if(calls)calls.hidden=view!=='calls';
 const claims=document.querySelector('.bingo-live-claims'),books=document.querySelector('.bingo-live-participants');if(claims)claims.hidden=view!=='bingo';if(books)books.hidden=view!=='books';return view;
}

// Navigation reveals existing controls. The director and audio stay active.
export function initDashboard({isShow=false,onResize=()=>{},onNavigate=()=>{}}={}){
 const body=document.body,sidebar=document.querySelector('#dashboard-sidebar'),toggle=document.querySelector('#sidebar-toggle'),backdrop=document.querySelector('#sidebar-backdrop');
 const narrow=matchMedia('(max-width:720px)'),medium=matchMedia('(max-width:1100px)'),chatCompact=matchMedia('(max-width:1200px)');
 const broadcast=document.querySelector('.regie-broadcast'),program=document.querySelector('.program-monitor');
 let page='regie',collapsed=null,fitFrame=0;try{const stored=localStorage.getItem('vlampie-sidebar-collapsed');if(stored!==null)collapsed=stored==='true';}catch{}
 function resized(){
  onResize();if(fitFrame)cancelAnimationFrame(fitFrame);fitFrame=requestAnimationFrame(()=>{
   fitFrame=0;body.classList.toggle('regie-options-popup',!isShow&&page==='regie');
   if(!isShow&&page==='regie'&&broadcast&&program){
    const box=broadcast.getBoundingClientRect(),heading=program.querySelector('.monitor-heading'),footer=program.querySelector('.program-footer');
    // Hidden compact monitors still use the same chrome dimensions when reopened.
    const chrome=(heading?.getBoundingClientRect().height||39)+(footer?.getBoundingClientRect().height||34)+3;
    const width=fitProgramWidth({width:box.width,height:box.height,chrome,compact:chatCompact.matches,mobile:narrow.matches});
    if(width>0&&broadcast.style.getPropertyValue('--program-width')!==`${width}px`){broadcast.style.setProperty('--program-width',`${width}px`);onResize();}
   }
  });
 }
 function sidebarState(){
  const compact=collapsed===null?medium.matches:collapsed;
  body.classList.toggle('sidebar-collapsed',compact);body.classList.toggle('sidebar-expanded',!compact);
  const open=narrow.matches?body.classList.contains('sidebar-open'):!compact;
  toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Menu inklappen':'Menu openen');toggle.title=open?'Menu inklappen':'Menu openen';
  backdrop.hidden=!(narrow.matches||medium.matches&&!compact)||!open;sidebar.inert=!!isShow||narrow.matches&&!open;resized();
 }
 function closeMenu(){body.classList.remove('sidebar-open');if(medium.matches&&!narrow.matches&&body.classList.contains('sidebar-expanded'))collapsed=true;sidebarState();}
 function closeTuning(){body.classList.remove('tuning-open');document.querySelector('#tuning-open').setAttribute('aria-expanded','false');document.querySelector('#live-tuning').hidden=true;}
 function closeBoard(){body.classList.remove('number-grid-open');document.querySelector('#toggle-number-grid').setAttribute('aria-expanded','false');document.querySelector('.ballboard-card').removeAttribute('role');}
 function navigate(focus=false){
  page=isShow?'regie':dashboardPage(location.hash);body.dataset.page=page;
  for(const panel of document.querySelectorAll('[data-dashboard-page]'))panel.hidden=panel.dataset.dashboardPage!==page;
  for(const link of document.querySelectorAll('[data-page-link]')){if(link.dataset.pageLink===page)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
  for(const group of document.querySelectorAll('[data-nav-group]')){if(group.querySelector('[aria-current="page"]'))group.open=true;}
  const heading=document.querySelector('#dashboard-page-title');heading.textContent=bt(DASHBOARD_PAGES[page]);if(!isShow)document.title=`${bt(DASHBOARD_PAGES[page])} · ${bt("Vlampie")} Studio`;
  const group=document.querySelector('#dashboard-page-group');if(group)group.textContent=['regie','chat'].includes(page)?'UITZENDING':['studio','vlampie','koppeling'].includes(page)?'STUDIO':'SHOW VOORBEREIDEN';
  closeBoard();closeTuning();closeMenu();onNavigate(page);resized();if(focus)heading.focus({preventScroll:true});
 }
 if(isShow){navigate();sidebar.inert=true;return {get page(){return page;}};}
 toggle.addEventListener('click',()=>{if(narrow.matches)body.classList.toggle('sidebar-open');else{collapsed=!(collapsed===null?medium.matches:collapsed);try{localStorage.setItem('vlampie-sidebar-collapsed',String(collapsed));}catch{}}sidebarState();});
 backdrop.addEventListener('click',closeMenu);
 for(const link of document.querySelectorAll('[data-page-link]'))link.addEventListener('click',()=>{if(dashboardPage(link.hash)===page)closeMenu();});
 window.addEventListener('hashchange',()=>navigate(true));
 const resize=()=>{if(!narrow.matches)body.classList.remove('sidebar-open');sidebarState();};narrow.addEventListener('change',resize);medium.addEventListener('change',resize);chatCompact.addEventListener('change',resize);
 for(const button of document.querySelectorAll('[data-monitor-view]'))button.addEventListener('click',()=>{body.dataset.monitor=button.dataset.monitorView;for(const other of document.querySelectorAll('[data-monitor-view]'))other.setAttribute('aria-pressed',String(other===button));resized();});
 for(const button of document.querySelectorAll('[data-console-view]'))button.addEventListener('click',()=>{setConsoleView(button.dataset.consoleView);resized();});
 setConsoleView(body.dataset.console);
 document.querySelector('#tuning-open').addEventListener('click',()=>{closeBoard();const open=body.classList.toggle('tuning-open');document.querySelector('#tuning-open').setAttribute('aria-expanded',String(open));document.querySelector('#live-tuning').hidden=!open;if(open)document.querySelector('#tuning-close').focus({preventScroll:true});resized();});
 document.querySelector('#tuning-close').addEventListener('click',()=>{closeTuning();document.querySelector('#tuning-open').focus({preventScroll:true});});
 document.querySelector('#toggle-number-grid').addEventListener('click',()=>{closeTuning();const open=body.classList.toggle('number-grid-open');document.querySelector('#toggle-number-grid').setAttribute('aria-expanded',String(open));if(open){setConsoleView('monitor');document.querySelector('.ballboard-card').setAttribute('role','dialog');document.querySelector('#close-number-grid').focus({preventScroll:true});}else closeBoard();resized();});
 document.querySelector('#close-number-grid').addEventListener('click',()=>{closeBoard();document.querySelector('#toggle-number-grid').focus({preventScroll:true});resized();});
 window.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  if(body.classList.contains('number-grid-open')){event.preventDefault();closeBoard();document.querySelector('#toggle-number-grid').focus({preventScroll:true});resized();return;}
  if(body.classList.contains('tuning-open')){event.preventDefault();closeTuning();document.querySelector('#tuning-open').focus({preventScroll:true});return;}
  if(body.classList.contains('sidebar-open')||medium.matches&&body.classList.contains('sidebar-expanded')){event.preventDefault();closeMenu();toggle.focus({preventScroll:true});}
 });
 const observer=new ResizeObserver(resized);observer.observe(document.querySelector('.controlroom-layout'));if(broadcast)observer.observe(broadcast);document.fonts?.ready.then(resized);
 navigate();sidebarState();return {get page(){return page;},navigate,dispose(){observer.disconnect();if(fitFrame)cancelAnimationFrame(fitFrame);}};
}
