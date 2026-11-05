// The broadcast desk only displays committed numbers; it never draws a ball.
export const DESK_BOARD=Object.freeze({x:708,y:678,width:504,height:112,columns:15,rows:5,gridX:721,gridY:700,cellWidth:30,cellHeight:15.5,gapX:2,gapY:2});
export function deskBoardCells(drawn=[],lastNumber=null){
 const confirmed=new Set((Array.isArray(drawn)?drawn:[]).filter(n=>Number.isInteger(n)&&n>=1&&n<=75));
 return Array.from({length:75},(_,i)=>({number:i+1,row:Math.floor(i/15),column:i%15,drawn:confirmed.has(i+1),last:confirmed.has(i+1)&&lastNumber===i+1}));
}
export function drawDeskNumberBoard(ctx,drawn,lastNumber,{integrated=false}={}){
 const b=DESK_BOARD,cells=deskBoardCells(drawn,lastNumber),count=cells.filter(c=>c.drawn).length;
 const rounded=(x,y,w,h,r)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);};
 const gradient=(x,y,x2,y2,stops)=>{const g=ctx.createLinearGradient(x,y,x2,y2);for(const [p,color] of stops)g.addColorStop(p,color);return g;};
 const text=(s,x,y,size,color,align='center',weight=700)=>{ctx.font=`${weight} ${size}px "Trebuchet MS",system-ui,sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(String(s),x,y);};
 ctx.save();
 if(!integrated){ctx.shadowColor='#120720bb';ctx.shadowBlur=9;ctx.shadowOffsetY=3;
 rounded(b.x,b.y,b.width,b.height,10);ctx.fillStyle=gradient(b.x,b.y,b.x+b.width,b.y+b.height,[[0,'#fff0bb'],[.18,'#bc813b'],[.48,'#ffdc91'],[.78,'#986128'],[1,'#f8df9f']]);ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
 rounded(b.x+2,b.y+2,b.width-4,b.height-4,8);ctx.fillStyle='#321942';ctx.fill();
 rounded(b.x+3.5,b.y+3.5,b.width-7,b.height-7,7);ctx.fillStyle=gradient(b.x,b.y,b.x,b.y+b.height,[[0,'#181429'],[.55,'#17142f'],[1,'#080e20']]);ctx.fill();
 ctx.strokeStyle='#f9dfac66';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(b.x+12,b.y+3);ctx.lineTo(b.x+b.width-12,b.y+3);ctx.stroke();}
 text('GETROKKEN NUMMERS',b.gridX,b.y+12,9,'#f8dfad','left');text(`${count} / 75`,b.x+b.width-13,b.y+12,9,'#b8dbdd','right');
 for(const cell of cells){
  const x=b.gridX+cell.column*(b.cellWidth+b.gapX),y=b.gridY+cell.row*(b.cellHeight+b.gapY);
  rounded(x,y,b.cellWidth,b.cellHeight,3);
  ctx.fillStyle=cell.last?gradient(x,y,x,y+b.cellHeight,[[0,'#fff6d1'],[.4,'#ffe1a0'],[1,'#dea650']]):cell.drawn?gradient(x,y,x,y+b.cellHeight,[[0,'#257c84'],[1,'#174858']]):'#252239';
  ctx.fill();ctx.lineWidth=cell.last?1:.55;ctx.strokeStyle=cell.last?'#fffaf0':cell.drawn?'#85e9da':'#555064';ctx.stroke();
  text(cell.number,x+b.cellWidth/2,y+b.cellHeight/2+.25,13.5,cell.last?'#36213c':cell.drawn?'#edfff7':'#c2b9d2');
 }
 ctx.restore();
}
