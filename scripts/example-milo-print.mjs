import fs from 'node:fs/promises';
import path from 'node:path';
import {makeGame,generateBooks,cardSignature} from '../server/bingo-model.js';
import {bookPdf} from '../server/bingo-pdf.js';

// Fictional books exercise the same renderer as participant downloads. Public
// previews deliberately carry a non-activation QR and a NOT VALID watermark.
const target=path.resolve(process.argv[2]||'public/assets/milo-friends/example-color.pdf');
const qa=path.resolve(process.argv[3]||'.sites-runtime/print-qa');
const game=makeGame({brandId:'milo',title:'Milo & Friends BingoShow',date:'2026-11-11T13:30',roundCount:4},'print-preview','https://bingo.example');
generateBooks(game,2,'milo-sterrenmagie-preview');
if(new Set(game.books.flatMap(b=>b.cards.map(cardSignature))).size!==8)throw Error('Voorbeeldkaarten zijn niet uniek');
await fs.mkdir(path.dirname(target),{recursive:true});
await fs.mkdir(qa,{recursive:true});
for(const mode of ['color','mono']){
 const output=mode==='color'?target:path.join(path.dirname(target),'example-mono.pdf');
 await fs.writeFile(output,await bookPdf(game,[game.books[0].id],{mode,demo:true}));
 await fs.writeFile(path.join(qa,'milo-'+mode+'-real-qr.pdf'),await bookPdf(game,[game.books[0].id],{mode}));
 await fs.writeFile(path.join(qa,'milo-'+mode+'-a4.pdf'),await bookPdf(game,game.books.map(b=>b.id),{mode,format:'a4',demo:true}));
}
await fs.writeFile(path.join(qa,'expected.json'),JSON.stringify({url:`${game.origin}/spelen?spel=${game.id}&boek=${game.books[0].token}`,cards:game.books[0].cards,code:game.books[0].code,ticket:game.books[0].ticket,title:game.title},null,2));
console.log('Sterrenmagie: kleur- en inktarme voorbeeld-PDF, A4 en QR-controlebestanden gegenereerd.');
