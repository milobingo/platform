// Sterrenmagie print scenery. Number cells, logo, titles, book identity and QR
// remain exact vector/data overlays in milo-print-layout.js and bingo-pdf.js.
// node scripts/render-milo-print-art.mjs [absolute-path-to-@napi-rs/canvas/index.js]
import fs from 'node:fs/promises';
const {createCanvas}=await import(process.argv[2]||'@napi-rs/canvas');
const SCALE=12,W=148,H=210;
const canvas=createCanvas(W*SCALE,H*SCALE),c=canvas.getContext('2d');
c.scale(SCALE,SCALE);
const rounded=(x,y,w,h,r)=>{c.beginPath();c.roundRect(x,y,w,h,r);};
const fill=(x,y,w,h,r,paint)=>{rounded(x,y,w,h,r);c.fillStyle=paint;c.fill();};
const outline=(x,y,w,h,r,paint,width=.2)=>{rounded(x,y,w,h,r);c.strokeStyle=paint;c.lineWidth=width;c.stroke();};
const linear=(x,y,x2,y2,stops)=>{const g=c.createLinearGradient(x,y,x2,y2);for(const [p,color] of stops)g.addColorStop(p,color);return g;};
const glow=(x,y,r,color)=>{const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);};
const line=(points,paint,width=.15)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=paint;c.lineWidth=width;c.stroke();};
function curve(draw,paint,width=.3){c.beginPath();draw(c);c.strokeStyle=paint;c.lineWidth=width;c.lineCap='round';c.stroke();}
function star(x,y,size,alpha=1){
 c.save();c.globalAlpha=alpha;glow(x,y,size*4,'#ffdf8944');
 c.fillStyle='#fff0bb';c.beginPath();c.moveTo(x,y-size);
 c.quadraticCurveTo(x+.12*size,y-.12*size,x+size*.66,y);
 c.quadraticCurveTo(x+.12*size,y+.12*size,x,y+size);
 c.quadraticCurveTo(x-.12*size,y+.12*size,x-size*.66,y);
 c.quadraticCurveTo(x-.12*size,y-.12*size,x,y-size);c.fill();c.restore();
}
const gold=linear(0,0,148,210,[[0,'#ffedb4'],[.18,'#c99643'],[.39,'#ffe9a4'],[.6,'#aa702d'],[.78,'#f5cf73'],[1,'#ffe6a3']]);
// Midnight ink with broad amethyst light, restrained enough to keep tiny gold
// constellations legible. No artificial horizontal gradient bands.
c.fillStyle=linear(0,0,148,210,[[0,'#090e31'],[.25,'#181039'],[.55,'#23104b'],[.76,'#141237'],[1,'#0a1536']]);c.fillRect(0,0,W,H);
glow(24,37,72,'#5b25a85e');glow(137,110,82,'#43289c48');glow(17,187,57,'#182b854d');
// Deterministic starlight: the authoring script never uses random state.
let seed=72371;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
for(let i=0;i<410;i++){
 const x=random()*148,y=random()*210,r=.035+random()*.13;
 c.fillStyle=i%5?'#ffe5a65b':'#c4c9ff77';c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();
}
// Delicate constellation diagrams are confined to the exposed header/margins.
for(const points of [[[7,10],[17,6],[25,13],[18,21],[30,25]],[[116,6],[125,12],[138,8],[140,22]],[[2,78],[4,90],[1.8,100]],[[144,140],[146,151],[143.5,162]],[[18,206],[29,208],[38,205]]]){
 line(points,'#e5c57966',.14);
 for(const [x,y]of points){c.beginPath();c.arc(x,y,.37,0,Math.PI*2);c.fillStyle='#f9dea5';c.fill();glow(x,y,1.6,'#ead39d25');}
}
// Gold comet arcs wrap the logo and cards, echoing showcase 05 rather than
// curtain, chrome, papercut or satin designs.
const trails=[
 {draw:p=>{p.moveTo(-9,37);p.bezierCurveTo(6,10,56,12,85,19);p.bezierCurveTo(121,29,146,19,154,4);},color:'#f6cf7c83'},
 {draw:p=>{p.moveTo(-5,45);p.bezierCurveTo(18,25,57,37,92,33);p.bezierCurveTo(121,30,134,19,146,21);},color:'#f6cf7c2b'},
 {draw:p=>{p.moveTo(1,92);p.bezierCurveTo(-2,113,26,117,58,111);p.bezierCurveTo(97,104,137,108,149,122);},color:'#d5aa5c73'},
 {draw:p=>{p.moveTo(-2,167);p.bezierCurveTo(23,183,53,174,79,177);p.bezierCurveTo(106,181,134,184,152,163);},color:'#f6cf7c76'},
 {draw:p=>{p.moveTo(97,211);p.bezierCurveTo(128,202,148,204,151,187);},color:'#f6cf7c6b'}
];
for(const {draw,color}of trails){curve(draw,color,1.1);curve(draw,'#ffe7aa',.16);}
for(let i=0;i<155;i++){
 const t=i/154,x=-5+t*160,y=31-13*Math.sin(t*Math.PI*1.13)+Math.sin(t*19)*1.2;
 const spread=(random()-.5)*4.6;c.fillStyle=i%4?'#ffdfa995':'#ffffff99';c.beginPath();c.arc(x,y+spread,.05+random()*.15,0,Math.PI*2);c.fill();
}
for(const [x,y,s,a]of [[9,28,2.1,.9],[136,17,2.7,.95],[31,9,1.05,.65],[118,7,1.1,.7],[4,111,1.8,.8],[74,108.9,1.7,.9],[143,109,1.3,.8],[4,174,1.8,.8],[143,173.5,2,.9],[42,207,.8,.7],[108,206.5,1.2,.75]])star(x,y,s,a);
// Fine metallic rails sit close to the paper: a confident slim outline, not
// oversized moulded toy frames. The finale alone adds a second gold rail.
function frame(x,y,w,h,finale=false){
 c.save();c.shadowColor=finale?'#ebae4b36':'#07051b88';c.shadowBlur=(finale?2.1:1.6)*SCALE;c.shadowOffsetY=.45*SCALE;
 fill(x,y,w,h,2.9,finale?'#d9ac55':'#ad854a');c.restore();
 fill(x+.4,y+.4,w-.8,h-.8,2.55,linear(x,y,x+w,y+h,[[0,'#3a1557'],[.36,'#291047'],[.7,'#161337'],[1,'#24133f']]));
 outline(x+.14,y+.14,w-.28,h-.28,2.72,gold,.24);
 outline(x+.79,y+.79,w-1.58,h-1.58,2.2,finale?'#e0b86d':'#aa824c',finale?.22:.12);
 fill(x+1.55,y+1.4,w-3.1,6.1,1.45,linear(x,y,x+w,y+8,finale?[[0,'#684024'],[.45,'#4e263d'],[1,'#8b5b2a']]:[[0,'#4b1d68'],[.5,'#29113e'],[1,'#3a164e']]));
 curve(p=>{p.moveTo(x+3,y+7.45);p.lineTo(x+w-3,y+7.45);},finale?'#edca8580':'#ceae6c51',.16);
 for(let col=0;col<5;col++){
  const cx=x+12.5+col*10,cy=y+9.95;
  c.beginPath();c.arc(cx,cy,2.37,0,Math.PI*2);c.fillStyle='#171335';c.fill();c.strokeStyle=finale?'#f1cc82':'#bc955d';c.lineWidth=finale?.25:.18;c.stroke();
 }
 fill(x+7.02,y+12.6,50.96,50.96,.75,'#e5c588');
 fill(x+7.24,y+12.82,50.52,50.52,.55,'#291641');
 for(const sx of [x+3.5,x+w-3.5]){
  curve(p=>{p.moveTo(sx,y+15);p.lineTo(sx,y+h-6);},'#d9b87450',.13);
  for(const sy of [y+19,y+h-8])star(sx,sy,finale?.8:.52,.68);
 }
 if(finale){
  // A narrow star crown on each shoulder leaves the title at x+32.5 clear.
  for(const cx of [x+7,x+w-7]){
   c.beginPath();c.moveTo(cx-2.2,y+4.8);c.lineTo(cx-2.6,y+2.8);c.lineTo(cx-1,y+3.7);c.lineTo(cx,y+2.1);c.lineTo(cx+1,y+3.7);c.lineTo(cx+2.6,y+2.8);c.lineTo(cx+2.2,y+4.8);c.closePath();c.fillStyle=gold;c.fill();
   curve(p=>{p.moveTo(cx-2.1,y+5.25);p.lineTo(cx+2.1,y+5.25);},'#ffe8ae',.25);
  }
  for(let i=0;i<5;i++){const sx=x+6+i*13.25;star(sx,y+h-.15,.45,i%2?.75:1);}
 }
}
for(let i=0;i<4;i++)frame(i%2?77:6,i<2?46:112,65,64,i===3);
// One quiet footer with clear columns and a separately white vector QR zone.
fill(5.7,179,136.3,25,2.4,'#151534');outline(5.7,179,136.3,25,2.4,gold,.27);outline(6.3,179.6,135.1,23.8,1.9,'#e3c18540',.11);
curve(p=>{p.moveTo(12,205.5);p.bezierCurveTo(53,209,92,205,136,206.4);},'#cbaa5b45',.15);
await fs.writeFile(new URL('../public/assets/milo-friends/print-waves.png',import.meta.url),canvas.toBuffer('image/png'));
console.log('Sterrenmagie midnight constellation artwork rendered at 304 dpi.');
