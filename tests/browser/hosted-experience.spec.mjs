import {test,expect} from '@playwright/test';
import {CHARACTERS} from '../../server/characters.js';

// Browser transport fixtures use no hosted accounts or provider calls. The
// real Next/React entry must verify the session before importing family data.
async function hostedTransport(page,testInfo,{failSession=false,regie=false,failGames=false}={}){
 const origin=new URL(testInfo.project.use.baseURL).origin,proof={errors:[],external:[],writes:[],games:0,unexpected:[]};
 page.on('pageerror',error=>proof.errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){proof.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return route.continue();
  if(request.method()!=='GET'){proof.writes.push(url.pathname);return route.fulfill({status:403,json:{error:{message:'Hosted browser fixture blocks all mutations.'}}});}
  let body;
  if(url.pathname==='/api/auth/session'){
   if(failSession)return route.fulfill({status:503,json:{error:{message:'Temporary session outage'}}});
   body={authenticated:regie,role:regie?'regie':null,user:regie?'fictional-regie':null,configured:true,localAvailable:false};
  }else if(url.pathname==='/api/player/session')body={authenticated:false};
  else if(url.pathname==='/api/player/brand')body={brandId:'milo'};
  else if(url.pathname==='/api/bingo/games'){
   proof.games++;
   if(failGames)return route.fulfill({status:503,json:{error:{message:'Shows tijdelijk niet bereikbaar.'}}});
   body={games:[]};
  }else if(url.pathname==='/api/characters')body={characters:Object.values(CHARACTERS),revision:0};
  else if(url.pathname==='/api/openai/status')body={configured:false,canManage:false};
  else if(url.pathname==='/api/output')body={state:null,serverTime:Date.now()};
  else if(url.pathname==='/api/live-calls')body={call:null,drawHeld:false,serverTime:Date.now()};
  else{proof.unexpected.push(url.pathname);return route.fulfill({status:404,json:{error:{message:'Unexpected hosted browser fixture endpoint'}}});}
  return route.fulfill({json:body,headers:{'Cache-Control':'private, no-store'}});
 });
 await page.addInitScript(()=>{
  window.__MILO_LOCAL_PREVIEW_AVAILABLE__=true;
  localStorage.setItem('mf-production','milo');
  localStorage.setItem('mf-rehearsal-plan-milo',JSON.stringify({title:'Old fictional show'}));
 });
 return proof;
}
const clean=proof=>{expect(proof.errors).toEqual([]);expect(proof.external).toEqual([]);expect(proof.writes).toEqual([]);expect(proof.unexpected).toEqual([]);};

for(const failSession of [false,true])test(`hosted family ignores demo flag and old preview permission even during session outage (${failSession})`,async({page},testInfo)=>{
 const proof=await hostedTransport(page,testInfo,{failSession});
 await page.goto('/spelen?demo=1&brand=milo&spel=chosen-show&bestelling=selected-order#/books');
 await expect(page.getByRole('heading',{name:'Welkom bij de bingo!',exact:true})).toBeVisible();
 await expect.poll(()=>new URL(page.url()).searchParams.has('demo')).toBe(false);
 expect(new URL(page.url()).searchParams.get('spel')).toBe('chosen-show');
 expect(new URL(page.url()).searchParams.get('bestelling')).toBe('selected-order');
 expect(new URL(page.url()).hash).toBe('#/books');
 await expect(page.locator('.fam-demo-banner,.fam-demo-video')).toHaveCount(0);
 await expect(page.getByRole('navigation',{name:'Spelersomgeving'})).toHaveCount(0);
 await expect(page.getByRole('link',{name:/demo|oefen/i})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__MILO_LOCAL_PREVIEW_AVAILABLE__)).toBe(false);
 clean(proof);
});

test('hosted login provides no demonstration or local account entry',async({page},testInfo)=>{
 const proof=await hostedTransport(page,testInfo);
 await page.goto('/login?demo=1');
 await expect(page.getByRole('textbox',{name:'E-mailadres',exact:true})).toBeVisible();
 await expect(page.locator('a[href*="demo="],a[href="/auth/local"]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:/lokale regie|lokaal ouderaccount/i})).toHaveCount(0);
 clean(proof);
});

test('hosted empty studio offers a first real show without sample books, participants, or rehearsal controls',async({page},testInfo)=>{
 const proof=await hostedTransport(page,testInfo,{regie:true});
 await page.goto('/?demo=1#/live');
 await expect(page.getByRole('heading',{name:'Je eerste show begint hier',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Nieuwe show',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/Oefenstudio|Start de repetitie|Volgende bal/i})).toHaveCount(0);
 await expect(page.locator('.mf-show-card,.mf-table tbody tr,.rd-console')).toHaveCount(0);
 await expect(page.getByText('Old fictional show',{exact:true})).toHaveCount(0);
 await expect.poll(()=>new URL(page.url()).searchParams.has('demo')).toBe(false);
 await page.getByRole('combobox',{name:'Productie kiezen',exact:true}).selectOption('vlampie');
 await expect(page.locator('.mf-empty-brand img')).toHaveAttribute('alt','Vlampies Bingo');
 await expect(page.getByRole('button',{name:'Nieuwe show',exact:true})).toBeVisible();
 clean(proof);
});

test('failed hosted shows request stays an explicit retry state and never opens fictional regie',async({page},testInfo)=>{
 const proof=await hostedTransport(page,testInfo,{regie:true,failGames:true});
 await page.goto('/#/live');
 await expect(page.getByRole('heading',{name:'Je shows konden niet worden geladen',exact:true})).toBeVisible();
 await expect(page.locator('main.mf-studio-empty').getByRole('alert')).toContainText('Shows tijdelijk niet bereikbaar.');
 await expect(page.getByRole('button',{name:/Oefenstudio|Volgende bal|Start show/i})).toHaveCount(0);
 const before=proof.games;
 await page.getByRole('button',{name:'Opnieuw laden',exact:true}).click();
 await expect.poll(()=>proof.games).toBeGreaterThan(before);
 await expect(page.getByRole('heading',{name:'Je shows konden niet worden geladen',exact:true})).toBeVisible();
 clean(proof);
});
