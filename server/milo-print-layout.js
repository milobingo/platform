import {PDFDocument,StandardFonts} from 'pdf-lib';
import {A5,MM,PRINT_LAYOUT,printTools,hex} from './bingo-print-layout.js';
import {MILO_PRINT_LOGOS} from './milo-print-assets.js';
import {MILO_PRINT_SCENERY} from './milo-print-scenery.js';

export const MILO_PRINT_VERSION='milo-friends-sterrenmagie-a5-v4';
export const miloPrintPalette=mode=>mode==='mono'
 ? {paper:'FFFFFF',ink:'181818',purple:'FFFFFF',gold:'303030',muted:'555555',footerInk:'303030',footerTitle:'161616',footerMuted:'444444',footerLabel:'555555',footerCode:'101010'}
 : {paper:'151135',ink:'241638',purple:'351544',gold:'F1CB83',muted:'D8CBE5',footerInk:'F3E9E0',footerTitle:'FFF0C4',footerMuted:'D8CBE5',footerLabel:'EDCA85',footerCode:'FFE6AE'};

// Artwork is decorative only. These vector cells retain the established 5×5
// geometry so changing the template never touches any number, ID or QR token.
export async function drawMiloPrintBackground(pdf,page,{mode='color',font,bold}){
 const mono=mode==='mono',p=miloPrintPalette(mode),{rect,rule,text}=printTools(page,font,bold);
 const shape=(d,fill,stroke,width=.4)=>page.drawSvgPath(d,{x:0,y:210*MM,scale:MM,...(fill?{color:hex(fill)}:{}),...(stroke?{borderColor:hex(stroke),borderWidth:width/MM}:{} )});
 const panel=(x,y,w,h,cut,fill,stroke,width=.4)=>shape(`M${x+cut},${y} H${x+w-cut} L${x+w},${y+cut} V${y+h-cut} L${x+w-cut},${y+h} H${x+cut} L${x},${y+h-cut} V${y+cut} Z`,fill,stroke,width);
 const circle=(x,y,r,fill,stroke,width=.4)=>page.drawCircle({x:x*MM,y:(210-y)*MM,size:r*MM,...(fill?{color:hex(fill)}:{}),...(stroke?{borderColor:hex(stroke),borderWidth:width}:{} )});
 const star=(x,y,r,fill,stroke)=>{let d='';for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,k=i%2?r*.43:r;d+=`${i?'L':'M'}${x+Math.cos(a)*k},${y+Math.sin(a)*k} `;}shape(d+'Z',fill,stroke,.18);};
 if(mono)rect(0,0,148,210,'FFFFFF');
 else{
  const art=await pdf.embedPng(MILO_PRINT_SCENERY);
  page.drawImage(art,{x:0,y:0,width:A5[0],height:A5[1]});
 }
 // Colour uses the supplied transparent original at full header size. The
 // dedicated outline adaptation is smaller and has no shaded background,
 // saving ink while retaining the complete brand composition.
 const image=await pdf.embedPng(mono?MILO_PRINT_LOGOS.mono:MILO_PRINT_LOGOS.color);
 const logoWidth=mono?54:67,logoHeight=logoWidth*2/3,logoTop=mono?4.7:.4;
 page.drawImage(image,{x:(148-logoWidth)/2*MM,y:(210-logoTop-logoHeight)*MM,width:logoWidth*MM,height:logoHeight*MM});
 if(mono){
  star(21,20.5,3.6,null,'777777');
  for(const [x,y,r]of [[9,9,1],[30,13,.7],[136,15,1.2],[142,109,.8],[7,173,.8]])star(x,y,r,null,'AAAAAA');
  rule(10,42,32,42,'AAAAAA',.3);rule(116,42,138,42,'AAAAAA',.3);
 }
 text('STERRENMAGIE',21,33.2,5.9,true,mono?'383838':'F3D591',{align:'center'});
 text('JOUW BINGOBOEKJE',21,37,4.6,true,mono?'555555':'D8CBE5',{align:'center'});
 // The right header (x110–143, y26–40) is deliberately reserved for the live
 // BLADNUMMER overlay added by bookPdf, rather than a printed sample number.
 for(let slot=0;slot<4;slot++){
  const x=PRINT_LAYOUT.cardX[slot%2],y=PRINT_LAYOUT.cardY[Math.floor(slot/2)],finale=slot===3;
  if(mono){
   panel(x,y,65,64,2.1,'FFFFFF','444444',finale?.65:.45);
   if(finale)panel(x+.75,y+.75,63.5,62.5,1.6,null,'999999',.3);
   rule(x+2,y+7.5,x+63,y+7.5,'AAAAAA',.3);
   if(finale)for(const sx of [x+7,x+58])star(sx,y+4.3,1.3,null,'666666');
  }
  const gx=x+PRINT_LAYOUT.gridInset,gy=y+PRINT_LAYOUT.gridTop;
  for(let col=0;col<5;col++){
   const cx=gx+(col+.5)*10;
   if(mono)circle(cx,y+9.95,2.28,null,'AAAAAA',.25);
   text('BINGO'[col],cx,y+11.05,9.5,true,mono?'222222':'FFE7AA',{align:'center'});
  }
  // Pale ivory writing faces, slightly warmer in the final round. Mono has
  // genuinely white cells, including VRIJ: no large grey fills or gradients.
  rect(gx-.18,gy-.18,50.36,50.36,mono?'FFFFFF':'513A4B');
  for(let row=0;row<5;row++)for(let col=0;col<5;col++){
   const free=row===2&&col===2,xx=gx+col*10,yy=gy+row*10;
   if(mono)rect(xx,yy,10,10,'FFFFFF','929292',.3);
   else{
    panel(xx+.12,yy+.17,9.76,9.76,.35,'9C8167');
    panel(xx+.19,yy+.1,9.62,9.52,.3,free?'FBEDC8':finale?'FFFBED':'FFFDF6','E5D4B7',.12);
    rule(xx+.65,yy+.4,xx+9.35,yy+.4,'FFFFFF',.4);
   }
  }
  rect(gx,gy,50,50,null,mono?'555555':finale?'DEB86D':'B9925E',mono?.35:.3);
 }
 const f=PRINT_LAYOUT.info;
 if(mono){
  panel(5.7,179,49.3,25,1.5,'FFFFFF','A0A0A0',.35);
  panel(f.x,f.y,f.width,f.height,1.4,'FFFFFF','777777',.4);
  rule(115.6,182,115.6,201.5,'BBBBBB',.3);
 }else{
  rule(56.4,182,56.4,201.5,'8F7B91',.2);
  rule(115.6,182,115.6,201.5,'8F7B91',.2);
 }
 // The 22.8 mm white square includes the QR's full four-module quiet margin.
 rect(116.6,180.1,22.8,22.8,'FFFFFF');
 text('SAMEN EEN BEETJE MAGIE.',8,183,6.1,true,mono?'222222':'F1D49D');
 text('Streep de getrokken nummers af.',8,187,6.2,false,p.footerInk);
 text('Bingo? Meld je in de spelersapp.',8,190.5,6.2,false,p.footerInk);
 text('Bevestig JA en kies je boekje.',8,194,6.2,false,p.footerInk);
 text('Alleen geldig voor deze show.',8,201,5.95,false,mono?'555555':'D8CBE5');
 text('MILO & FRIENDS BINGOSHOW',74,207.1,4.5,true,mono?'777777':'E9D3A7',{align:'center'});
}

const backgrounds=new Map();
export function miloPrintBackground(mode){
 if(!['color','mono'].includes(mode))throw new Error('Onbekende printuitvoering');
 if(!backgrounds.has(mode))backgrounds.set(mode,(async()=>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const page=pdf.addPage(A5);await drawMiloPrintBackground(pdf,page,{mode,font,bold});
  pdf.setTitle('Milo & Friends BingoShow - Sterrenmagie printbasis');pdf.setCreator('Milo & Friends Studio');
  pdf.setCreationDate(new Date('2026-11-04T00:00:00Z'));pdf.setModificationDate(new Date('2026-11-04T00:00:00Z'));
  return pdf.save();
 })().catch(error=>{backgrounds.delete(mode);throw error;}));
 return backgrounds.get(mode);
}
