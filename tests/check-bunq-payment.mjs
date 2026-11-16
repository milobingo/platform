import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBunqPaymentLink as normalize} from '../public/bunq-payment.js';
import {renderMailTemplate,listMailTemplates,sampleMailContext} from '../server/mail-templates.js';

test('bunq share text, quotes and sentence punctuation normalize to the exact cased code',()=>{
 const url='https://bunq.me/o/VoorbeeldCode123';
 for(const value of [url,`🙏 Betaal € 5,00 voor "test" via ${url}`,`"${url}"`,`(${url}).`,`Via ${url}!`,`(( ${url} )))`,`${url} ${url}`])assert.equal(normalize(value),url);
});
test('query parameters, encoded punctuation and meaningful query brackets remain intact',()=>{
 for(const url of ['https://bunq.me/o/AbC_12-3?ref=MiLo&code=%2bA+X#Top','https://bunq.me/o/AbC?tekst=Dag!','https://bunq.me/o/AbC?tekst=(Dag)'])assert.equal(normalize(url),url);
 assert.equal(normalize('(https://bunq.me/o/AbC?ref=MiLo).'),'https://bunq.me/o/AbC?ref=MiLo');
 assert.equal(normalize('HTTPS://BUNQ.ME:443/o/AbC?X=Y'),'https://bunq.me/o/AbC?X=Y');
});
test('missing, ambiguous, lookalike, credential, port and malformed paths are rejected',()=>{
 for(const value of ['', 'Betaal vijf euro', 'http://bunq.me/o/ABC','https://bunq.me.evil.test/o/ABC','https://www.bunq.me/o/ABC','https://bunq.me./o/ABC','https://búnq.me/o/ABC','https://bunq.me@evil.test/o/ABC','https://evil.test@bunq.me/o/ABC','https://bunq.me:8443/o/ABC','https://bunq.me/o/','https://bunq.me/ABC','https://bunq.me/o/ABC/extra','https://bunq.me/o/ABC%2fextra','https://bunq.me/o/%00','https://bunq.me/o/../o/ABC','https://bunq.me/o/ABC https://bunq.me/o/XYZ','https://bunq.me/o/ABC https://bunq.me.evil.test/o/ABC'])assert.throws(()=>normalize(value),error=>error.code?.startsWith('bunq_')&&error.message.length>10,value);
});
test('payment mail retains order facts and Milo branding with the required bunq CTA; Vlampie copy stays independent',()=>{
 const context={...sampleMailContext('payment-link','milo','https://bingo.test'),betaallink:'https://bunq.me/o/ABC?Ref=MiLo',show_naam:'Fictieve testshow',bestelnummer:'MF-0042',aantal_bladen:'3',bedrag:'€ 7,50'};
 const mail=renderMailTemplate('payment-link',{brandId:'milo',origin:'https://bingo.test',from:'team@example.test',to:'ouder@example.test',context,template:{buttonLabel:'Oude knoptekst'}});
 assert.deepEqual(mail.to,['ouder@example.test']);
 for(const text of ['Fictieve testshow','MF-0042','3','€ 7,50','Betaal via bunq','https://bunq.me/o/ABC?Ref=MiLo'])assert(mail.text.includes(text),text);
 assert(mail.html.includes('/assets/milo-friends/logo.png'));assert(mail.html.includes('Betaal via bunq'));
 assert.equal(listMailTemplates('milo').find(t=>t.id==='payment-link').buttonLabel,'Betaal via bunq');
 assert.equal(listMailTemplates('vlampie').find(t=>t.id==='payment-link').buttonLabel,'Open mijn betaallink');
});
