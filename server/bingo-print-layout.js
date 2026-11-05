import {rgb,BlendMode} from 'pdf-lib';
export const PRINT_VERSION='a5-grand-show-v2';
export const MM=72/25.4;
export const A5=[148*MM,210*MM];
export const PRINT_LAYOUT=Object.freeze({width:148,height:210,cardX:[6,77],cardY:[46,112],cardWidth:65,cardHeight:64,gridInset:7.5,gridTop:13,cell:10,info:{x:58,y:179,width:84,height:25},qr:{x:117,y:180.5,size:22}});
export const hex=value=>rgb(parseInt(value.slice(0,2),16)/255,parseInt(value.slice(2,4),16)/255,parseInt(value.slice(4,6),16)/255);
export const printPalette=mode=>mode==='mono'?{paper:'FFFFFF',ink:'141414',navy:'FFFFFF',card:'FFFFFF',gold:'282828',edge:'404040',grid:'555555',muted:'595959',soft:'F5F5F5',band:'FFFFFF'}:{paper:'08162F',ink:'132A4C',navy:'0E2550',card:'FFFEF8',gold:'DDB56C',edge:'AD823E',grid:'AEB9C8',muted:'B8C8DF',soft:'F5F1E5',band:'153E78'};
export function printTools(page,font,bold){
 const rect=(x,y,w,h,fill,stroke,line=.4)=>page.drawRectangle({x:x*MM,y:(210-y-h)*MM,width:w*MM,height:h*MM,...(fill?{color:hex(fill)}:{}),...(stroke?{borderColor:hex(stroke),borderWidth:line}:{} )});
 const rule=(x,y,x2,y2,color,width=.4)=>page.drawLine({start:{x:x*MM,y:(210-y)*MM},end:{x:x2*MM,y:(210-y2)*MM},thickness:width,color:hex(color)});
 const clean=value=>String(value??'').normalize('NFKD').replace(/[’‘]/g,"'").replace(/[—–]/g,'-').replace(/[^\x20-\x7eÀ-ÿ]/g,'');
 const text=(value,x,y,size=9,heavy=false,color='000000',options={})=>{let label=clean(value),face=heavy?bold:font;if(options.maxWidth){while(face.widthOfTextAtSize(label,size)>options.maxWidth*MM&&size>(options.minSize||size))size-=.2;if(face.widthOfTextAtSize(label,size)>options.maxWidth*MM){while(label.length&&face.widthOfTextAtSize(label+'...',size)>options.maxWidth*MM)label=label.slice(0,-1);label+='...';}}const width=face.widthOfTextAtSize(label,size);page.drawText(label,{x:x*MM-(options.align==='center'?width/2:options.align==='right'?width:0),y:(210-y)*MM,size,font:face,color:hex(color)});};
 return {rect,rule,text};
}
// A reusable background contains the logo, 100 cells and a clear QR/info box.
// Live PDF generation only overlays the round titles, numbers and book information.
export async function drawPrintBackground(pdf,page,{mode='color',logo,backdrop,font,bold}){
 const p=printPalette(mode),{rect,rule,text}=printTools(page,font,bold),mono=mode==='mono';
 const path=(d,fill,stroke,width=.4)=>page.drawSvgPath(d,{x:0,y:210*MM,scale:MM,...(fill?{color:hex(fill)}:{}),...(stroke?{borderColor:hex(stroke),borderWidth:width/MM}:{} )});
 const panel=(x,y,w,h,cut,fill,stroke,width=.4)=>path(`M${x+cut},${y} H${x+w-cut} L${x+w},${y+cut} V${y+h-cut} L${x+w-cut},${y+h} H${x+cut} L${x},${y+h-cut} V${y+cut} Z`,fill,stroke,width);
 const circle=(x,y,r,fill,stroke,width=.4)=>page.drawCircle({x:x*MM,y:(210-y)*MM,size:r*MM,...(fill?{color:hex(fill)}:{}),...(stroke?{borderColor:hex(stroke),borderWidth:width}:{} )});
 const star=(x,y,r,fill,stroke)=>{let d='';for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,k=i%2?r*.43:r;d+=`${i?'L':'M'}${x+Math.cos(a)*k},${y+Math.sin(a)*k} `;}path(d+'Z',fill,stroke,.35);};
 const mix=(a,b,t)=>[0,2,4].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
 const gradient=(x,y,w,h,stops)=>{const steps=Math.ceil(h*7);for(let i=0;i<steps;i++){const f=i/(steps-1)*(stops.length-1),s=Math.min(stops.length-2,Math.floor(f));rect(x,y+h*i/steps,w,h/steps+.025,mix(stops[s],stops[s+1],f-s));}};
 rect(0,0,148,210,p.paper);
 if(!mono&&backdrop){const art=await pdf.embedPng(backdrop);page.drawImage(art,{x:0,y:0,width:A5[0],height:A5[1]});}
 // Original logos stay embedded unchanged. Lighten blends only the black backdrop
 // into the dark stage; no tracing, re-generation or cropping of the logo occurs.
 const image=await pdf.embedJpg(logo);page.drawImage(image,{x:44*MM,y:(210-1-40)*MM,width:60*MM,height:40*MM,...(!mono?{blendMode:BlendMode.Lighten}:{})});
 if(mono){
  // A restrained ink-saving Art Deco surround echoes the full-color stage.
  for(const side of [0,1]){const x=side?144:4,s=side?-1:1;rule(x,6,x,204,'777777',.5);rule(x+s*1.2,12,x+s*1.2,199,'B0B0B0',.3);path(`M${x},8 L${x+s*13},8 L${x+s*17},12 M${x},12 L${x+s*10},12 L${x+s*14},16`,null,'777777',.5);star(x+s*9,24,2,null,'777777');}
 }
 rule(11,43,46,43,mono?'6A6A6A':'D6AB57',.5);rule(102,43,137,43,mono?'6A6A6A':'D6AB57',.5);
 star(47.4,43,.8,mono?'555555':'FFE3A0');star(100.6,43,.8,mono?'555555':'FFE3A0');
 text('JOUW BINGOBOEKJE',74,43.8,7.4,true,mono?'303030':'FFE4A7',{align:'center'});
 for(let slot=0;slot<4;slot++){
  const x=PRINT_LAYOUT.cardX[slot%2],y=PRINT_LAYOUT.cardY[Math.floor(slot/2)],finale=slot===3;
  if(!mono){
   panel(x+.45,y+.65,65,64,2.4,'030B20');
   panel(x,y,65,64,2.2,finale?'FFD16B':'CA953F','5F360F',.8);
   panel(x+.3,y+.3,64.4,63.4,2,'FFF1B7');
   panel(x+.7,y+.7,63.6,62.6,1.7,finale?'A56D19':'805522');
   panel(x+1.02,y+1.02,62.96,61.96,1.4,finale?'FFE6A1':'EFCC87');
   panel(x+1.42,y+1.42,62.16,61.16,1,'FFFEF9');
   gradient(x+1.6,y+1.6,61.8,10.9,finale?['FFF1BE','FFFCED']:['EAF0FA','FCFDFF']);
   gradient(x+2.2,y+1.4,60.6,5.9,finale?['7C4812','F0CA74','FFF2C3','C38B33']:['081D53','2457A7','163A7D','071B47']);
   rule(x+2.1,y+1.4,x+62.9,y+1.4,'FFF1C2',.7);rule(x+2.1,y+7.4,x+62.9,y+7.4,finale?'956328':'D7AF61',.55);
  }else{
   panel(x,y,65,64,2,null,'292929',finale?1.15:.7);panel(x+.8,y+.8,63.4,62.4,1.6,'FFFFFF','858585',.35);
   panel(x+1.5,y+1.4,62,6,1.1,'FFFFFF','343434',finale?.85:.5);
  }
  for(const side of [-1,1]){
   const sx=x+32.5+side*26;star(sx,y+4.4,finale?1.45:1.1,mono?null:finale?'785019':'FFE7A5',mono?'444444':finale?'FFF3C9':'9C7132');
   // Double vertical inlays give the card its own substantial show frame.
   rule(x+(side<0?3.1:61.9),y+14,x+(side<0?3.1:61.9),y+59,mono?'B2B2B2':'D8BA78',.35);
   if(finale){for(let j=0;j<6;j++){const cy=y+18+j*7;path(`M${sx+side*.4},${cy} q${side*1.8},-1.8 ${side*2.8},-2.5 q.5,2 ${-side*2.8},2.5 Z`,mono?null:'E7C27C',mono?'888888':'BC9851',.25);}}
  }
  const gx=x+PRINT_LAYOUT.gridInset,gy=y+PRINT_LAYOUT.gridTop;
  // Gold-rimmed medallions keep B I N G O aligned with their number columns.
  for(let c=0;c<5;c++){
   const cx=gx+(c+.5)*10,cy=y+9.95;
   circle(cx,cy,2.6,mono?'FFFFFF':finale?'DDAA47':'AC782A',mono?'555555':'6B471C',.35);
   circle(cx,cy,2.26,mono?'FFFFFF':finale?'FFF0B9':'FFF2BC',mono?'9A9A9A':'FCE5A8',.25);
   circle(cx,cy,1.94,mono?'FFFFFF':finale?'FFEDAD':'173D7B',mono?'BBBBBB':finale?'CB9F52':'0C2456',.25);
   if(!mono)text('BINGO'[c],cx+.08,cy+1.21,9.7,true,finale?'E4BC6A':'020F2B',{align:'center'});
   text('BINGO'[c],cx,cy+1.12,9.7,true,mono?'161616':finale?'533411':'FFE4A1',{align:'center'});
  }
  rect(gx-.45,gy-.45,50.9,50.9,mono?'FFFFFF':finale?'B3863F':'ABBBCE',mono?'3B3B3B':'745225',.35);
  for(let row=0;row<5;row++)for(let col=0;col<5;col++){
   const center=row===2&&col===2;
   rect(gx+col*10,gy+row*10,10,10,center?(mono?'F4F4F4':'FBF0D4'):mono?'FFFFFF':(row+col)%2?'FFFDFA':'F8FAFF',mono?'888888':'B1BBCB',mono?.4:.32);
  }
  rect(gx,gy,50,50,null,mono?'303030':finale?'9E7636':'657D9A',.7);
  // Small corner diamonds and the final's illuminated studs echo the logo frame.
  for(const cx of [x+3.4,x+61.6])for(const cy of [y+10.2,y+61]){path(`M${cx},${cy-.9} L${cx+.6},${cy} L${cx},${cy+.9} L${cx-.6},${cy} Z`,mono?'FFFFFF':finale?'FFE8A4':'D0AD68',mono?'777777':'99702F',.3);}
  if(finale)for(let i=0;i<11;i++){const cx=x+7.5+i*5;circle(cx,y+.58,.2,mono?'FFFFFF':'FFF9D9',mono?'666666':undefined,.2);}
 }
 const f=PRINT_LAYOUT.info;
 if(!mono){panel(5.7,179,49.3,25,1.4,'081A3A','CBA055',.55);panel(f.x,f.y,f.width,f.height,1.4,'E5C27D','7E541D',.6);panel(f.x+.55,f.y+.55,f.width-1.1,f.height-1.1,1,'FFFEF9');}
 else{panel(5.7,179,49.3,25,1.4,'FFFFFF','9A9A9A',.45);panel(f.x,f.y,f.width,f.height,1.4,'FFFFFF','414141',.6);}
 // Keep the complete QR area white, including four-module quiet space.
 rect(116.6,180.1,22.8,22.8,'FFFFFF');rule(115.6,182,115.6,201.5,mono?'B5B5B5':'D4BC83',.4);
 text('SAMEN SPELEN. SAMEN VIEREN.',8,183,6.05,true,mono?'222222':'F5D891');
 text('Streep de getrokken nummers af.',8,187,6.35,false,mono?'333333':'E3EAF5');
 text('Bingo? Meld je in de spelersapp.',8,190.5,6.35,false,mono?'333333':'E3EAF5');
 text('Bevestig JA en kies je boekje.',8,194,6.35,false,mono?'333333':'E3EAF5');
 text('Alleen geldig voor deze show.',8,201,6.1,false,mono?'555555':'B5C8E5');
}
export function drawRoundTitles(page,{font,bold,mode='color',titles,brand='vlampie'}){
 const {text}=printTools(page,font,bold),mono=mode==='mono';
 for(let i=0;i<Math.min(4,titles.length);i++){
  const x=PRINT_LAYOUT.cardX[i%2],y=PRINT_LAYOUT.cardY[Math.floor(i/2)];
  const label=String(titles[i]).toUpperCase();
  if(!mono)text(label,x+32.5+.12,y+5.65,10,true,brand==='milo'?'1B0D2E':i===3?'E0B764':'010C23',{align:'center',maxWidth:47,minSize:7});
  text(label,x+32.5,y+5.48,10,true,mono?'151515':brand==='milo'?'FFE7A5':i===3?'382208':'FFF0C2',{align:'center',maxWidth:47,minSize:7});
 }
}
