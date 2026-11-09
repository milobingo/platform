import test from 'node:test';
import assert from 'node:assert/strict';
import {MAIL_TEMPLATES,listMailTemplates,validateMailTemplate,renderMailTemplate,sampleMailContext} from '../server/mail-templates.js';

const origin='https://bingo.test';
const render=(id='newsletter',options={})=>renderMailTemplate(id,{brandId:'milo',origin,from:'organisatie@voorbeeld.invalid',to:'ouder@voorbeeld.invalid',context:sampleMailContext(id,'milo',origin),...options});
const bad=fn=>assert.throws(fn,e=>e.status===400&&e.code==='mail_template');

test('the14 source messages plus3 operational messages have a complete email frame, plain alternative and the correct production identity',()=>{
 assert.equal(MAIL_TEMPLATES.length,17);assert.equal(new Set(MAIL_TEMPLATES.map(x=>x.id)).size,17);
 for(const brandId of ['milo','vlampie'])for(const t of listMailTemplates(brandId)){
  const payload=render(t.id,{brandId,context:sampleMailContext(t.id,brandId,origin)});
  assert.deepEqual(payload.to,['ouder@voorbeeld.invalid']);assert(payload.text.length>120);assert(payload.html.includes('<table role="presentation"'));
  assert(payload.html.includes('https://bingo.test'+(brandId==='milo'?'/assets/milo-friends/logo.png':'/assets/studio-logo.png')));
  assert(!payload.html.includes(brandId==='milo'?'/assets/studio-logo.png':'/assets/milo-friends/logo.png'));
  assert(!/\{\{[a-z_]+\}\}/.test(payload.subject+payload.text+payload.html));
 }
});
test('template-specific shortcodes reject typos, malformed syntax and cross-template access',()=>{
 bad(()=>validateMailTemplate('newsletter',{body:'Dit is {{onbekend}}.'}));
 bad(()=>validateMailTemplate('newsletter',{body:'Geheime code: {{inlogcode}}'}));
 bad(()=>validateMailTemplate('welcome',{body:'Hallo {{voornaam'}));
 bad(()=>validateMailTemplate('niet-bestaand',{}));
 bad(()=>render('show-changed',{context:{...sampleMailContext('show-changed','milo',origin),wijziging_tekst:''}}));
});
test('copy edits never turn parent names, notes or campaign text into HTML or executable attributes',()=>{
 const p=render('payment-link',{context:{...sampleMailContext('payment-link','milo',origin),voornaam:'<img src=x onerror="alert(1)">',betaalnotitie:'Dank je <gezin>!'}});
 assert(p.html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));assert(!p.html.includes('<img src=x'));
 assert(p.html.includes('Dank je &lt;gezin&gt;!'));assert(p.text.includes('Dank je <gezin>!'));
 const n=render('newsletter',{template:{title:'Een <b>mooie</b> show',body:'{{nieuwsbrief_tekst}}'},context:{...sampleMailContext('newsletter','milo',origin),nieuwsbrief_tekst:'<script>bad()</script>\nWelkom & veel plezier'}});
 assert(n.html.includes('&lt;script&gt;bad()&lt;/script&gt;'));assert(!n.html.includes('<script>'));
 assert(n.html.includes('Een &lt;b&gt;mooie&lt;/b&gt; show'));
});
test('header injection is rejected both before and after shortcode expansion',()=>{
 bad(()=>validateMailTemplate('welcome',{subject:'Welkom\r\nBcc: iemand@voorbeeld.invalid'}));
 bad(()=>render('welcome',{template:{subject:'Hallo {{voornaam}}'},context:{...sampleMailContext('welcome','milo',origin),voornaam:'Danny\r\nBcc: iemand@voorbeeld.invalid'}}));
 bad(()=>render('welcome',{to:'ouder@voorbeeld.invalid\r\nBcc: iemand@voorbeeld.invalid'}));
 bad(()=>render('welcome',{context:{...sampleMailContext('welcome','milo',origin),organisatie_naam:'Naam\r\nBcc: fout'}}));
});
test('transaction buttons cannot be replaced or removed and unsafe resolved links cannot be sent',()=>{
 bad(()=>validateMailTemplate('payment-link',{buttonUrl:'https://anders.test/betaal'}));
 bad(()=>validateMailTemplate('books-ready',{buttonLabel:'',buttonUrl:''}));
 bad(()=>render('payment-link',{context:{...sampleMailContext('payment-link','milo',origin),betaallink:'javascript:alert(1)'}}));
 bad(()=>render('newsletter',{template:{buttonUrl:'https://name:password@evil.test/'}}));
 bad(()=>render('newsletter',{template:{buttonUrl:'http://niet-lokaal.test/'}}));
 assert(render('newsletter',{template:{buttonUrl:'/spelen'}}).html.includes('href="https://bingo.test/spelen"'));
 assert(render('welcome',{origin:'http://terminal.local:4173',context:sampleMailContext('welcome','milo','http://terminal.local:4173')}).html.includes('http://terminal.local:4173/assets/milo-friends/logo.png'));
});
test('OTP remains enabled and preserves its code, expiry and safety guidance after all copy is changed',()=>{
 const template={enabled:false,subject:'Welkom',title:'Een nieuwe titel',body:'Aangepaste tekst',preheader:'Ander voorbeeld'};
 assert.equal(validateMailTemplate('auth-code',template).enabled,true);
 const p=render('auth-code',{template});
 assert(p.html.includes('482619'));assert(p.text.includes('is 482619.'));assert(p.text.includes('10 minuten geldig'));
 assert(p.html.includes('Deel deze code met niemand'));assert(p.text.includes('niet zelf aangevraagd'));
 bad(()=>render('auth-code',{context:{...sampleMailContext('auth-code','milo',origin),inlogcode:'123'}}));
});
test('unsubscribe cannot be removed from a newsletter or from a show campaign',()=>{
 const p=render('newsletter',{template:{body:'Alleen mijn tekst',buttonLabel:'',buttonUrl:''}});
 assert(p.html.includes('Afmelden voor de nieuwsbrief'));assert(p.text.includes('Afmelden voor de nieuwsbrief: https://bingo.test/mail/afmelden?token='));
 bad(()=>render('newsletter',{context:{...sampleMailContext('newsletter','milo',origin),afmeldlink:''}}));
 bad(()=>render('newsletter',{context:{...sampleMailContext('newsletter','milo',origin),afmeldlink:'data:text/html,bad'}}));
 const show=render('show-reminder',{unsubscribeUrl:'https://bingo.test/mail/afmelden?token=fictief'});
 assert(show.html.includes('Afmelden voor de nieuwsbrief'));assert(show.text.includes('token=fictief'));
});
test('prize copy needs authoritative confirmation and template changes cannot remove the official facts',()=>{
 bad(()=>render('prize-confirmed',{context:{...sampleMailContext('prize-confirmed','milo',origin),uitslag_bevestigd:false}}));
 assert(render('prize-confirmed').text.includes('Noor ontvangt Een magisch verrassingspakket'));
 const edited=render('prize-confirmed',{template:{body:'Een feestelijk bericht.'}});assert(edited.text.includes('Winnaar: Noor'));assert(edited.text.includes('Prijs: Een magisch verrassingspakket'));
});
test('a trusted public asset base keeps the correct brand path without changing account or payment URLs',()=>{
 const p=render('books-ready',{assetBaseUrl:'https://publiek.voorbeeld.invalid/mail-assets'});
 assert(p.html.includes('https://publiek.voorbeeld.invalid/mail-assets/assets/milo-friends/logo.png'));
 assert(p.html.includes('href="https://bingo.test/spelen"'));
 bad(()=>render('welcome',{assetBaseUrl:'http://onveilig.test'}));
 bad(()=>render('welcome',{context:{...sampleMailContext('welcome','milo',origin),logo_url:'javascript:bad'}}));
});
