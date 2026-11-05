import {BRAND_PRINT_TEMPLATES} from './brand-print-assets.js';
import {brandId,showBrand} from './show-brands.js';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import qrcode from 'qrcode-generator';
import {PRINT_TEMPLATES} from './bingo-pdf-assets.js';
import {A5,MM,PRINT_LAYOUT,printTools,printPalette,drawRoundTitles} from './bingo-print-layout.js';
import {MILO_PRINT_VERSION,miloPrintBackground,miloPrintPalette} from './milo-print-layout.js';
export {PRINT_VERSION} from './bingo-print-layout.js';
export function printVersion(game){return brandId(game)==='milo'?MILO_PRINT_VERSION:'a5-grand-show-v2';}
export async function bookPdf(game,bookIds,{mode='color',demo=false,format='a5'}={}){
 if(!['color','mono'].includes(mode))throw new Error('Onbekende printuitvoering');
 if(!['a5','a4'].includes(String(format).toLowerCase()))throw new Error('Kies A5 of A4 voor de printuitvoering');
 format=String(format).toLowerCase();
 const milo=brandId(game)==='milo',pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),rounds=game.plan.blocks.filter(b=>b.type==='round'),pagesPerBook=Math.ceil(rounds.length/4),p=milo?miloPrintPalette(mode):printPalette(mode);
 const backgroundBytes=milo?await miloPrintBackground(mode):BRAND_PRINT_TEMPLATES[brandId(game)]?.[mode]||PRINT_TEMPLATES[mode];
 const [background]=await pdf.embedPdf(backgroundBytes,[0]);
 for(const id of bookIds){
  const book=game.books.find(b=>b.id===id);if(!book)continue;
  // One QR identifies this book, regardless of its appearance or continuation page.
  const qr=qrcode(0,'M'),url=demo?showBrand(game).name.toUpperCase()+' - VOORBEELD - GEEN GELDIG SPEELBOEKJE':`${game.origin}/spelen?spel=${game.id}&boek=${book.token}`;qr.addData(url);qr.make();
  for(let sheet=0;sheet<pagesPerBook;sheet++){
   const page=pdf.addPage(A5);page.drawPage(background,{x:0,y:0,width:A5[0],height:A5[1]});const {text,rect}=printTools(page,font,bold);
   if(milo){
    text('BLADNUMMER',127,31.6,5.8,true,p.footerLabel,{align:'center'});
    text(book.ticket,127,38,12.7,true,p.footerCode,{align:'center',maxWidth:25,minSize:9});
   }
   const selected=rounds.slice(sheet*4,sheet*4+4);drawRoundTitles(page,{font,bold,mode,brand:brandId(game),titles:selected.map(r=>r.title)});
   for(let slot=0;slot<4;slot++){
    const x=PRINT_LAYOUT.cardX[slot%2],y=PRINT_LAYOUT.cardY[Math.floor(slot/2)];
    if(!selected[slot]){rect(x-.2,y-.2,PRINT_LAYOUT.cardWidth+1,PRINT_LAYOUT.cardHeight+1,p.paper);continue;}
    const card=book.cards[sheet*4+slot],gx=x+PRINT_LAYOUT.gridInset,gy=y+PRINT_LAYOUT.gridTop;
    for(let i=0;i<25;i++){const free=card[i]===0;const label=free?'VRIJ':String(card[i]);text(label,gx+(i%5+.5)*10,gy+(Math.floor(i/5)+.5)*10+(free?.9:2),free?7.5:16,true,p.ink,{align:'center'});}
   }
   text(game.title,61,183.2,8,true,milo?p.footerTitle:mode==='mono'?'161616':'132641',{maxWidth:53,minSize:6.8});
   const dateParts=String(game.date).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/),months=['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
   const date=dateParts?`${Number(dateParts[3])} ${months[Number(dateParts[2])-1]} ${dateParts[1]} / ${dateParts[4]}`:String(game.date).replace('T',' ');text(date,61,187,6.7,false,milo?p.footerMuted:mode==='mono'?'444444':'4C586A',{maxWidth:53});
   text('BOEKJECODE',61,191.2,5.8,true,milo?p.footerLabel:mode==='mono'?'555555':'566176');
   text(`${book.code.slice(0,4)}-${book.ticket}`,61,196.1,12.7,true,milo?p.footerCode:mode==='mono'?'101010':'102448');
   text(`Lot ${book.ticket}  /  Scan om te koppelen`,61,200.3,6.5,false,milo?p.footerMuted:mode==='mono'?'444444':'3B4B61',{maxWidth:53});
   const count=qr.getModuleCount(),{x:qx,y:qy,size}=PRINT_LAYOUT.qr,module=size*MM/(count+8);
   // Four white modules on every side; the QR never shares a colored background.
   for(let row=0;row<count;row++)for(let col=0;col<count;col++)if(qr.isDark(row,col))page.drawRectangle({x:qx*MM+(col+4)*module,y:(210-qy-size)*MM+(count-row+3)*module,width:module,height:module,color:rgb(0,0,0)});
   if(pagesPerBook>1)text(`Blad ${sheet+1} van ${pagesPerBook} / boekje ${book.ticket}`,8,197.5,6.2,true,mode==='mono'?'333333':'E6C68D');
   if(demo)text('VOORBEELD - NIET GELDIG',8,197.5,6.3,true,mode==='mono'?'202020':'F0CC86');
  }
 }
 pdf.setTitle(`${game.title} - A5 bingoboekjes - ${mode==='color'?'kleur':'zwart-wit'}`);pdf.setCreator(showBrand(game).name+' Studio');pdf.setProducer(showBrand(game).title+' A5');
 if(format==='a5')return pdf.save();
 // Optional two-up imposition: the same book identities, cards and QR tokens,
 // printed at their original A5 size on an A4 landscape sheet.
 const imposed=await PDFDocument.create(),pages=await imposed.embedPdf(await pdf.save(),pdf.getPages().map((_,index)=>index));
 for(let i=0;i<pages.length;i+=2){
  const page=imposed.addPage([297*MM,210*MM]);
  for(let slot=0;slot<2&&i+slot<pages.length;slot++)page.drawPage(pages[i+slot],{x:(.25+slot*148.5)*MM,y:0,width:A5[0],height:A5[1]});
  page.drawLine({start:{x:148.5*MM,y:4*MM},end:{x:148.5*MM,y:206*MM},thickness:.3,color:rgb(.7,.7,.7),dashArray:[2,3]});
 }
 imposed.setTitle(`${game.title} - A4 met twee A5 bingoboekjes - ${mode==='color'?'kleur':'zwart-wit'}`);imposed.setCreator(showBrand(game).name+' Studio');imposed.setProducer(showBrand(game).title+' A4');return imposed.save();
}
