import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {makeGame,generateBooks,cardSignature} from '../server/bingo-model.js';
import {bookPdf,printVersion,PRINT_VERSION} from '../server/bingo-pdf.js';
import {MILO_PRINT_VERSION,miloPrintBackground} from '../server/milo-print-layout.js';
const mm=72/25.4;
const make=()=>{const game=makeGame({brandId:'milo',title:'Milo & Friends - De magische eerste show',date:'2026-11-01T14:00',roundCount:4},'test-host','https://bingo.example');generateBooks(game,3,'print-rehearsal');return game;};

test('Milo PDFs preserve all generated book/card identities and use a separate template revision',async()=>{
 const game=make(),before=JSON.stringify(game),ids=game.books.map(b=>b.id),signatures=game.books.flatMap(b=>b.cards.map(cardSignature));
 assert.equal(new Set(signatures).size,12);assert.equal(new Set(game.books.map(b=>b.code)).size,3);
 assert.equal(printVersion(game),MILO_PRINT_VERSION);assert.notEqual(printVersion(game),PRINT_VERSION);
 assert.equal(game.batches[0].print.template,MILO_PRINT_VERSION,'New Milo batches identify the Sterrenmagie template');
 for(const mode of ['color','mono']){
  const bytes=await bookPdf(game,ids,{mode}),pdf=await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),3);assert.match(pdf.getTitle(),/Milo/);
  for(const page of pdf.getPages()){assert(Math.abs(page.getWidth()-148*mm)<.001);assert(Math.abs(page.getHeight()-210*mm)<.001);}
  assert(bytes.byteLength>10000);
 }
 assert.equal(JSON.stringify(game),before,'Appearance must never mutate book numbers, tokens, codes or game state');
 assert.equal(await miloPrintBackground('color'),await miloPrintBackground('color'),'All pages share a prepared background');
});

test('A4 imposes identical A5 booklets without regenerating cards; invalid choices fail',async()=>{
 const game=make(),before=JSON.stringify(game),ids=game.books.map(b=>b.id);
 const bytes=await bookPdf(game,ids,{mode:'color',format:'a4'}),pdf=await PDFDocument.load(bytes);
 assert.equal(pdf.getPageCount(),2);for(const page of pdf.getPages()){assert(Math.abs(page.getWidth()-297*mm)<.001);assert(Math.abs(page.getHeight()-210*mm)<.001);}
 assert.equal(JSON.stringify(game),before);
 await assert.rejects(()=>bookPdf(game,ids,{mode:'invalid'}),/printuitvoering/);
 await assert.rejects(()=>bookPdf(game,ids,{format:'a3'}),/A5 of A4/);
 game.brandId='vlampie';assert.equal(printVersion(game),PRINT_VERSION);
});
