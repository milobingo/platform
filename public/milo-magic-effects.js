/** Ten scenic, deterministic illusions. This renderer reads presentation time
 * only; it has no access to bingo numbers, cards, guests or provider sessions. */
const TAU=Math.PI*2;
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
const mix=(a,b,t)=>a+(b-a)*t;
const colorMix=(a,b,t)=>{t=clamp(t);const values=[1,3,5].map(i=>Math.round(mix(parseInt(a.slice(i,i+2),16),parseInt(b.slice(i,i+2),16),t)));return '#'+values.map(n=>n.toString(16).padStart(2,'0')).join('');};
const ease=n=>{n=clamp(n);return clamp(n*n*n*(n*(n*6-15)+10));};
const ramp=(p,a,b)=>ease((p-a)/(b-a));
export const EXTRA_MAGIC_IDS=Object.freeze(['flower-hat','linking-rings','floating-table','rainbow-cube','cookie-mystery','star-rabbit','bubble-world','reverse-hourglass','wand-multiplication','banana-surprise']);
const colors=['#f9cd7b','#82ece0','#f5a3dc','#ac8afa','#fff1bf'];
function gradient(c,x,y,x2,y2,stops){const g=c.createLinearGradient(x,y,x2,y2);for(const [p,col]of stops)g.addColorStop(p,col);return g;}
function ellipse(c,x,y,rx,ry,fill,rotation=0){c.beginPath();c.ellipse(x,y,Math.max(.01,rx),Math.max(.01,ry),rotation,0,TAU);c.fillStyle=fill;c.fill();}
function glow(c,x,y,r,color,alpha=1){c.save();c.globalAlpha*=clamp(alpha);const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'#00000000');ellipse(c,x,y,r,r,g);c.restore();}
function star(c,x,y,r,color='#ffe8a5',rotation=0){c.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5+rotation,d=i%2?r*.42:r;c[i?'lineTo':'moveTo'](x+Math.cos(a)*d,y+Math.sin(a)*d);}c.closePath();c.fillStyle=color;c.fill();}
function shadow(c,x,y,w=150,alpha=.4){c.save();c.globalAlpha*=alpha;const g=c.createRadialGradient(x,y,0,x,y,w);g.addColorStop(0,'#15071d');g.addColorStop(1,'#15071d00');c.translate(x,y);c.scale(1,.13);ellipse(c,0,0,w,w,g);c.restore();}
function sparkles(c,x,y,r,time,amount=1,count=18){
 c.save();for(let i=0;i<count;i++){const a=i*2.399963+time*.22,d=r*(.3+(i%7)/9),pulse=.4+.6*(.5+.5*Math.sin(time*1.1+i*1.7));c.globalAlpha=clamp(amount*pulse);star(c,x+Math.cos(a)*d,y+Math.sin(a)*d*.7,2+(i%4)*1.4,colors[i%colors.length],a);}c.restore();
}
function metal(c,x,y,w,h){return gradient(c,x-w,y-h,x+w,y+h,[[0,'#744619'],[.16,'#e6ad4b'],[.31,'#fff6c0'],[.52,'#c78b35'],[.72,'#ffe5a0'],[1,'#9e6324']]);}
function round(c,x,y,w,h,r,fill,stroke='#fbe6ad',line=2){c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=line;c.stroke();}}
function hat(c,x,y,size=145,tilt=0){
 c.save();c.translate(x,y);c.rotate(tilt);c.shadowColor='#17071f99';c.shadowBlur=18;c.shadowOffsetY=9;
 const fill=gradient(c,-size/2,-size,size/2,0,[[0,'#7a328b'],[.3,'#32133d'],[.55,'#74287a'],[1,'#2b123d']]);
 c.beginPath();c.moveTo(-size*.4,-size);c.bezierCurveTo(-size*.46,-size*1.1,size*.46,-size*1.1,size*.4,-size);c.lineTo(size*.31,-size*.1);c.lineTo(-size*.31,-size*.1);c.closePath();c.fillStyle=fill;c.fill();c.strokeStyle='#e6b66c';c.lineWidth=2.5;c.stroke();
 c.shadowBlur=0;c.shadowOffsetY=0;ellipse(c,0,-size,size*.4,size*.07,'#905390');round(c,-size*.33,-size*.29,size*.66,size*.14,2,metal(c,0,-size*.2,size*.4,size*.12));
 ellipse(c,0,0,size*.64,size*.15,gradient(c,0,-20,0,20,[[0,'#b47bc4'],[.4,'#4e205e'],[1,'#bf8f4d']]));c.strokeStyle='#ffe3a0';c.lineWidth=3;c.stroke();ellipse(c,0,-4,size*.32,size*.065,'#130b21');star(c,0,-size*.65,size*.11,'#f6d58a');c.restore();
}
function wand(c,x,y,length=180,rotation=-.25,alpha=1){
 c.save();c.globalAlpha*=clamp(alpha);c.translate(x,y);c.rotate(rotation);c.shadowColor='#80ece066';c.shadowBlur=13;round(c,-length/2,-6,length,12,5,gradient(c,-length/2,0,length/2,0,[[0,'#eee2ba'],[.12,'#faf2d0'],[.14,'#21152f'],[.82,'#543465'],[.85,'#fff9d5'],[1,'#fff4bf']]),'#f9df9c',1);c.restore();
}
function flower(c,x,y,size,color,rotation=0){
 c.save();c.translate(x,y);c.rotate(rotation);for(let p=0;p<7;p++){c.save();c.rotate(p*TAU/7);ellipse(c,0,-size*.55,size*.36,size*.7,gradient(c,0,-size,0,0,[[0,'#fff4dc'],[.36,color],[1,'#8b3f92']]));c.restore();}ellipse(c,0,0,size*.32,size*.32,metal(c,0,0,size,size));ellipse(c,-size*.09,-size*.08,size*.09,size*.06,'#fff9d1');c.restore();
}
function flowers(c,s){
 const x=1195,y=770,grow=ramp(s.p,.26,.68),open=ramp(s.p,.40,.73);
 shadow(c,x,865,190,.25);hat(c,x,y+5,160,Math.sin(s.t*.5)*.018);
 const seed=ramp(s.p,.10,.27),seedAlpha=ramp(s.p,.03,.10)*(1-ramp(s.p,.27,.34));
 if(seedAlpha>0){c.save();c.globalAlpha*=seedAlpha;const sx=mix(s.wrist.x-10,x,seed),sy=mix(s.wrist.y-20,y-160,seed)-Math.sin(seed*Math.PI)*95;glow(c,sx,sy,22,'#ffeeb577');star(c,sx,sy,10,'#ffefb3',seed*2);c.restore();}
 c.save();c.beginPath();c.rect(x-230,y-420,460,415);c.clip();
 for(let i=0;i<9;i++){const dx=Math.sin(i*2.4)*125,dy=-(135+(i%3)*61)*grow;const sway=Math.sin(s.t*.8+i)*9*grow;c.strokeStyle=i%2?'#6ba775':'#a2d992';c.lineWidth=5;c.beginPath();c.moveTo(x,y-8);c.quadraticCurveTo(x+dx*.45,y+dy*.5,x+dx+sway,y+dy);c.stroke();ellipse(c,x+dx*.5,y+dy*.55,19,7,'#80be88',i%2?.5:-.5);flower(c,x+dx+sway,y+dy,(17+(i%3)*3)*open,colors[i%4],i*.7+s.t*.02);}
 c.restore();ellipse(c,x,y-3,52,10,'#281437');sparkles(c,x,y-170,215,s.t,open*.8,16);
}
function ring(c,x,y,rx,ry,rotation,arc=[0,TAU]){
 c.save();c.translate(x,y);c.rotate(rotation);c.shadowColor='#11091b77';c.shadowBlur=10;c.shadowOffsetY=5;c.beginPath();c.ellipse(0,0,rx,ry,0,...arc);c.lineWidth=13;c.strokeStyle=metal(c,0,0,rx,ry);c.stroke();c.shadowBlur=0;c.shadowOffsetY=0;c.beginPath();c.ellipse(-1,-2,rx-2,ry-2,0,...arc);c.lineWidth=2;c.strokeStyle='#fff5c5';c.stroke();c.restore();
}
function rings(c,s){
 const join=ramp(s.p,.24,.57),place=ramp(s.p,.03,.19),x=mix(s.wrist.x-75,1200,place),y=mix(s.wrist.y-15,615,place);
 glow(c,x,y,210,'#865cb032',.8);const spread=mix(160,62,join);
 ring(c,x-spread,y-18,75,94,-.16);ring(c,x+spread,y-18,75,94,.16);
 ring(c,x,y+mix(142,70,join),76,93,Math.sin(s.t*.7)*.035);
 if(join>.4){ring(c,x-spread,y-18,75,94,-.16,[Math.PI*.98,Math.PI*1.35]);ring(c,x+spread,y-18,75,94,.16,[Math.PI*1.65,TAU]);}
 const ping=Math.sin(clamp((s.p-.48)/.16)*Math.PI);glow(c,x,y+10,85,'#ffefb477',ping*.65);sparkles(c,x,y,180,s.t,ramp(s.p,.5,.65)*.55,12);shadow(c,x,850,190,.22);
}
function table(c,s){
 const lift=ramp(s.p,.26,.58)*(1-ramp(s.p,.82,.96)),x=1200,y=755-lift*135+(s.reduced?0:Math.sin(s.t*.8)*5*lift);
 shadow(c,x,910,215,.34-lift*.14);glow(c,x,y-35,240,'#8673cb20',lift);
 c.save();c.translate(x,y);c.strokeStyle=metal(c,0,0,130,150);c.lineWidth=12;c.lineCap='round';for(const side of [-1,1]){c.beginPath();c.moveTo(side*92,18);c.bezierCurveTo(side*82,65,side*62,100,side*105,155);c.stroke();ellipse(c,side*108,154,22,7,'#c89449');}
 ellipse(c,0,0,175,41,metal(c,0,0,170,40));c.strokeStyle='#ffedbb';c.lineWidth=3;c.stroke();
 c.beginPath();c.moveTo(-176,-5);c.bezierCurveTo(-130,-35,120,-35,176,-5);c.lineTo(162,89);for(let i=8;i>=0;i--){const xx=-162+i*40.5,yy=75+Math.sin(i*1.7+s.t*.9)*8*lift;c.lineTo(xx,yy);}c.closePath();c.fillStyle=gradient(c,-140,-15,130,95,[[0,'#a76ac1'],[.35,'#57216e'],[.65,'#713185'],[1,'#30113f']]);c.fill();c.strokeStyle='#edc178';c.lineWidth=2.5;c.stroke();star(c,0,31,25,'#e5b45e');c.restore();
 for(const side of [-1,1]){c.save();c.globalAlpha*=lift*.7;c.strokeStyle='#b5e6df';c.lineWidth=1.5;c.setLineDash([4,9]);c.beginPath();c.moveTo(x+side*182,850);c.bezierCurveTo(x+side*205,760,x+side*185,680,x+side*160,y-60);c.stroke();c.restore();}
}
function cube(c,s){
 const change=ramp(s.p,.31,.67),place=ramp(s.p,.04,.20),x=mix(s.wrist.x-75,1195,place),y=mix(s.wrist.y-60,610,place)+(s.reduced?0:Math.sin(s.t*.8)*8);shadow(c,1195,855,180,.25);glow(c,x,y,220,'#8de5e333',change*.8);
 c.save();c.translate(x,y);c.rotate(Math.sin(s.p*Math.PI)*.10);const a=110,b=56,h=132;
 const face=(pts,fill)=>{c.beginPath();pts.forEach(([px,py],i)=>c[i?'lineTo':'moveTo'](px,py));c.closePath();c.fillStyle=fill;c.fill();c.strokeStyle='#f7d28b';c.lineWidth=3;c.stroke();};
 const purple=['#8051ac','#39164f','#b882d0'],teal=['#81e6dd','#216f7b','#bbfff3'],rainbow=['#ffd67b','#bb5d96','#b9a6ff'];
 const palette=purple.map((col,i)=>colorMix(colorMix(col,teal[i],ramp(change,0,.55)),rainbow[i],ramp(change,.55,1)));
 face([[0,-b-h],[a,-h],[0,b-h],[-a,-h]],gradient(c,0,-h-b,a,b-h,[[0,'#fff4d1'],[.4,palette[2]],[1,palette[0]]]));
 face([[-a,-h],[0,b-h],[0,b],[ -a,0]],gradient(c,-a,-h,0,b,[[0,palette[0]],[1,palette[1]]]));face([[0,b-h],[a,-h],[a,0],[0,b]],gradient(c,0,-h,a,b,[[0,palette[2]],[1,palette[0]]]));
 c.strokeStyle='#f7e7bd77';c.lineWidth=1.2;for(let i=1;i<3;i++){const q=i/3;c.beginPath();c.moveTo(-a+a*q,-h+b*q);c.lineTo(-a+a*q,b*q);c.stroke();c.beginPath();c.moveTo(a*q,b-h-b*q);c.lineTo(a*q,b-b*q);c.stroke();}
 star(c,54,-37,27,'#fff0b5',.15);c.restore();sparkles(c,x,y-45,190,s.t,ramp(s.p,.55,.7)*.7,16);
}
function cookie(c,x,y,r,alpha=1){
 c.save();c.globalAlpha*=alpha;c.shadowColor='#13071c66';c.shadowBlur=12;c.shadowOffsetY=8;ellipse(c,x,y,r,r,gradient(c,x-r,y-r,x+r,y+r,[[0,'#fff0b8'],[.45,'#da9d4e'],[1,'#9e582c']]));c.shadowBlur=0;c.shadowOffsetY=0;c.strokeStyle='#efc989';c.lineWidth=4;c.stroke();for(let i=0;i<11;i++){const a=i*2.4,d=r*(.15+(i%4)*.18);ellipse(c,x+Math.cos(a)*d,y+Math.sin(a)*d,4+i%3,3+i%3,'#714228',a);}c.restore();
}
function cup(c,x,y,lift){
 c.save();c.translate(x,y-lift);c.shadowColor='#1c0d2a77';c.shadowBlur=17;c.shadowOffsetY=8;
 c.beginPath();c.moveTo(-58,0);c.bezierCurveTo(-53,-40,-43,-90,-32,-118);c.quadraticCurveTo(0,-139,32,-118);c.bezierCurveTo(43,-90,53,-40,58,0);c.closePath();c.fillStyle=gradient(c,-60,-50,60,-50,[[0,'#a36ab8'],[.3,'#512269'],[.55,'#9c63b5'],[.8,'#3b184e'],[1,'#c18dd0']]);c.fill();c.strokeStyle='#eec77c';c.lineWidth=3;c.stroke();c.shadowBlur=0;ellipse(c,0,-1,59,12,metal(c,0,0,65,20));star(c,0,-60,17,'#edc582');c.restore();
}
function cookieMystery(c,s){
 const x=1195,y=765,cover=ramp(s.p,.14,.30),reveal=ramp(s.p,.53,.70),vanish=ramp(s.p,.29,.38),move=ramp(s.p,.65,.82);shadow(c,x,836,220,.28);
 const place=ramp(s.p,.04,.18);
 round(c,x-205,y+18,410,24,12,metal(c,x,y,200,10));cookie(c,mix(s.wrist.x-35,x,place),mix(s.wrist.y,y-31,place),42,1-vanish);cup(c,x,y-7,130*(1-cover)+160*reveal);
 cookie(c,x+mix(180,132,move),y-38-Math.sin(move*Math.PI)*60,42,move);sparkles(c,x+132,y-35,92,s.t,move*.7,10);
}
function rabbit(c,x,y,size=1){
 c.save();c.translate(x,y);c.scale(size,size);c.shadowColor='#16092255';c.shadowBlur=12;
 const fur=gradient(c,-65,-140,65,55,[[0,'#fffcef'],[.45,'#f0e6e2'],[1,'#bdaed2']]);
 ellipse(c,0,12,54,65,fur);ellipse(c,-28,-112,18,64,fur,-.13);ellipse(c,27,-112,18,64,fur,.16);ellipse(c,-28,-112,9,45,'#e9a6c1',-.13);ellipse(c,27,-112,9,45,'#e9a6c1',.16);ellipse(c,0,-50,64,57,fur);c.shadowBlur=0;
 ellipse(c,-22,-56,8,12,'#372346');ellipse(c,22,-56,8,12,'#372346');ellipse(c,-24,-60,2.7,4,'#fffbed');ellipse(c,20,-60,2.7,4,'#fffbed');ellipse(c,0,-34,8,6,'#df9db3');
 c.strokeStyle='#79596f';c.lineWidth=2;c.beginPath();c.moveTo(0,-28);c.quadraticCurveTo(-7,-15,-17,-23);c.moveTo(0,-28);c.quadraticCurveTo(7,-15,17,-23);c.stroke();
 c.fillStyle='#7acfc3';c.beginPath();c.moveTo(0,5);c.lineTo(-30,-8);c.lineTo(-30,20);c.closePath();c.fill();c.beginPath();c.moveTo(0,5);c.lineTo(30,-8);c.lineTo(30,20);c.closePath();c.fill();ellipse(c,0,5,9,9,'#f6d596');ellipse(c,-43,58,29,14,fur);ellipse(c,43,58,29,14,fur);c.restore();
}
function starRabbit(c,s){
 const x=1200,y=792,appear=ramp(s.p,.36,.65);shadow(c,x,880,180,.3);glow(c,x,y-190,210,'#f2d79040',appear);
 c.save();c.beginPath();c.rect(x-190,y-500,380,500);c.clip();rabbit(c,x,y+105-appear*245,appear);c.restore();hat(c,x,y,164,Math.sin(s.t*.6)*.012);sparkles(c,x,y-190,190,s.t,appear*.6,18);
}
function bubbleWorld(c,s){
 const grow=ramp(s.p,.14,.47),discover=ramp(s.p,.36,.68),burst=ramp(s.p,.85,.97),r=190*grow*(1+burst*.17),x=1200,y=610;
 if(r<.1)return;shadow(c,x,872,210,.2);glow(c,x,y,r*1.3,'#7fded425',.9);
 c.save();c.globalAlpha*=1-burst;c.beginPath();c.arc(x,y,r,0,TAU);c.clip();ellipse(c,x,y,r,r,gradient(c,x-r,y-r,x+r,y+r,[[0,'#ecffff20'],[.4,'#5f8fbf22'],[.7,'#7939a333'],[1,'#71e0da40']]));
 c.globalAlpha*=discover;for(let i=0;i<5;i++){const a=s.t*(.13+i*.012)+i*1.4,orbit=53+i*21,px=x+Math.cos(a)*orbit,py=y+Math.sin(a)*orbit*.40;const rr=16+(i%3)*8;ellipse(c,px,py,rr,rr,gradient(c,px-rr,py-rr,px+rr,py+rr,[[0,'#fff7c3'],[.4,colors[i%4]],[1,'#493361']]));if(i===3){c.strokeStyle='#eac386';c.lineWidth=3;c.beginPath();c.ellipse(px,py,rr*1.8,rr*.35,-.3,0,TAU);c.stroke();}}sparkles(c,x,y,r*.85,s.t,.65,16);c.restore();
 c.save();c.globalAlpha*=1-burst;c.strokeStyle='#b9fff6aa';c.lineWidth=3.5;c.beginPath();c.arc(x,y,r,0,TAU);c.stroke();c.strokeStyle='#f4bbfa99';c.lineWidth=2;c.beginPath();c.arc(x+2,y+1,Math.max(.1,r-5),.2,Math.PI*1.1);c.stroke();c.strokeStyle='#fffef2cc';c.lineWidth=Math.min(8,r*.055);c.lineCap='round';c.beginPath();c.ellipse(x-r*.19,y-r*.16,r*.64,r*.72,-.25,Math.PI*1.15,Math.PI*1.55);c.stroke();ellipse(c,x+r*.53,y+r*.45,14*grow,7*grow,'#e7fffa66',-.5);c.restore();
 if(burst>0){c.save();c.globalAlpha*=Math.sin(burst*Math.PI)*.72;for(let i=0;i<18;i++){const a=i*TAU/18,rr=190+burst*105;ellipse(c,x+Math.cos(a)*rr,y+Math.sin(a)*rr,3+(i%3),5+(i%3)*2,colors[i%colors.length],a);}c.restore();}
}
function hourglass(c,s){
 const x=1195,y=625,transfer=ramp(s.p,.28,.78),w=116,h=174;shadow(c,x,875,180,.26);glow(c,x,y,210,'#d9c98a19',transfer);
 c.save();c.translate(x,y);c.rotate(Math.sin(s.t*.45)*.015);
 for(const side of [-1,1])round(c,side*w-8,-h,16,h*2,8,metal(c,side*w,0,14,h));
 round(c,-w-24,-h-15,w*2+48,25,10,metal(c,0,-h,w,20));round(c,-w-24,h-10,w*2+48,27,10,metal(c,0,h,w,20));
 c.beginPath();c.moveTo(-90,-h+15);c.bezierCurveTo(-85,-90,-30,-35,-13,0);c.bezierCurveTo(-30,35,-85,90,-90,h-20);c.lineTo(90,h-20);c.bezierCurveTo(85,90,30,35,13,0);c.bezierCurveTo(30,-35,85,-90,90,-h+15);c.closePath();c.fillStyle=gradient(c,-90,0,90,0,[[0,'#b6d9ef20'],[.25,'#ffffff0a'],[.7,'#c5f1ff18'],[1,'#fff1cb45']]);c.fill();c.strokeStyle='#d8f2f099';c.lineWidth=2.5;c.stroke();
 const sand=gradient(c,0,-120,0,150,[[0,'#fff2b9'],[.45,'#d9a452'],[1,'#a76030']]);
 c.beginPath();c.moveTo(-82,h-24);c.lineTo(82,h-24);c.lineTo(0,h-24-(1-transfer)*108);c.closePath();c.fillStyle=sand;c.fill();
 c.beginPath();c.moveTo(-76,-h+24);c.lineTo(76,-h+24);c.lineTo(0,-h+24+transfer*108);c.closePath();c.fill();
 for(let i=0;i<22;i++){const q=(s.t*.35+i/22)%1;if(transfer>.01&&transfer<.99)ellipse(c,Math.sin(i*3.2)*5,132-q*264,1.8,2.5,i%2?'#ffefac':'#dcab5c');}
 c.strokeStyle='#fffdf066';c.lineWidth=4;c.beginPath();c.moveTo(-70,-140);c.bezierCurveTo(-65,-86,-26,-36,-20,-18);c.stroke();c.restore();
}
function wands(c,s){
 const split=ramp(s.p,.24,.53)*(1-ramp(s.p,.76,.94)),flight=ramp(s.p,.08,.28)*(1-ramp(s.p,.79,.97)),x=mix(s.wrist.x,1200,flight),y=mix(s.wrist.y,625,flight),rotation=mix(-.88,-.14,flight);
 shadow(c,1200,850,190,.22);glow(c,x,y,180,'#94d7ed25',split);
 wand(c,x-split*138,y+split*45,184,rotation-split*.35,1);wand(c,x+split*138,y+split*45,184,rotation+split*.35,split);wand(c,x,y-split*80,184,rotation,split);
 sparkles(c,x,y,190,s.t,split*.65,12);
}
function banana(c,x,y,rotation=0,scale=1){
 c.save();c.translate(x,y);c.rotate(rotation);c.scale(scale,scale);c.shadowColor='#23122077';c.shadowBlur=15;c.shadowOffsetY=8;
 c.beginPath();c.moveTo(-74,-93);c.bezierCurveTo(-106,15,-22,111,100,65);c.bezierCurveTo(9,90,-50,9,-45,-80);c.closePath();c.fillStyle=gradient(c,-80,-80,70,80,[[0,'#fff4a0'],[.35,'#ffdf46'],[.68,'#eaae26'],[1,'#b57722']]);c.fill();c.strokeStyle='#ffe7a0';c.lineWidth=2.5;c.stroke();c.shadowBlur=0;c.shadowOffsetY=0;
 c.strokeStyle='#fff4b4';c.lineWidth=5;c.lineCap='round';c.beginPath();c.moveTo(-63,-58);c.bezierCurveTo(-59,15,3,78,70,69);c.stroke();c.strokeStyle='#7f4d28';c.lineWidth=10;c.beginPath();c.moveTo(-67,-85);c.lineTo(-66,-103);c.stroke();ellipse(c,98,65,7,5,'#744221',-.3);c.restore();
}
function bananaSurprise(c,s){
 const x=1200,y=795,reveal=ramp(s.p,.40,.65),bob=s.reduced?0:Math.sin(s.t*1.4)*8*reveal;shadow(c,x,880,175,.3);glow(c,x,y-180,210,'#f7df7830',reveal);
 c.save();c.beginPath();c.rect(x-200,y-410,400,410);c.clip();banana(c,x,y+50-reveal*260+bob,mix(-.9,-.3,reveal)+Math.sin(s.t*.7)*.06,reveal);c.restore();hat(c,x,y,162,-.025);sparkles(c,x,y-180,175,s.t,reveal*.6,12);
}
const DRAWERS=Object.freeze({'flower-hat':flowers,'linking-rings':rings,'floating-table':table,'rainbow-cube':cube,'cookie-mystery':cookieMystery,'star-rabbit':starRabbit,'bubble-world':bubbleWorld,'reverse-hourglass':hourglass,'wand-multiplication':wands,'banana-surprise':bananaSurprise});
export function extraMagicState({id,elapsed=0,duration=20,reducedMotion=false,wrist={x:1630,y:760}}={}){
 if(!DRAWERS[id])return null;duration=Number.isFinite(Number(duration))?clamp(Number(duration),1,180):20;elapsed=clamp(Number(elapsed)||0,0,duration);wrist=wrist||{};
 const t=reducedMotion?duration*.68:elapsed;
 return {id,t,p:clamp(t/duration),alpha:ease(elapsed/.8)*ease((duration-elapsed)/1.25),duration,reduced:!!reducedMotion,wrist:{x:Number.isFinite(wrist.x)?wrist.x:1630,y:Number.isFinite(wrist.y)?wrist.y:760}};
}
export function drawExtraMagic(c,options={}){
 const s=extraMagicState(options);if(!s)return false;
 c.save();c.globalAlpha*=s.alpha;DRAWERS[s.id](c,s);c.restore();return true;
}
