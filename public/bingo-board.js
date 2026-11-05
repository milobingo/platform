export const BINGO_BOARD=Object.freeze({width:1440,height:320,rows:5,columns:15});

// Completed draws are the only source of truth. The cage's preview number and
// a still-spinning pending ball must never light a number on this board.
export function bingoBoardState(state={}){
 const drawn=[...new Set((Array.isArray(state.bingoDrawn)?state.bingoDrawn:[]).filter(n=>Number.isInteger(n)&&n>=1&&n<=75))];
 const selected=new Set(drawn),latest=drawn.at(-1)??null;
 return {drawn,latest,pending:state.bingoPending!=null,rows:Array.from({length:5},(_,row)=>Array.from({length:15},(_,column)=>{
  const number=row*15+column+1;return {number,lit:selected.has(number),latest:number===latest};
 }))};
}

export function bingoBoardKey(board,theme){return `${theme}:${board.drawn.join(',')}:${board.pending}`;}

export function drawBingoBoard(c,board,theme='showtime',title='VLAMPIE’S BINGO'){
 const {width,height}=BINGO_BOARD;
 c.save();c.clearRect(0,0,width,height);
 const bg=c.createLinearGradient(0,0,0,height);
 bg.addColorStop(0,theme==='sinterklaas'?'#24101e':'#09172d');bg.addColorStop(1,'#040914');
 c.fillStyle=bg;c.fillRect(0,0,width,height);
 c.textBaseline='middle';c.textAlign='left';c.fillStyle='#f6d586';c.font='700 22px Arial';
 c.fillText(title.toUpperCase(),34,24,380);
 c.textAlign='center';c.fillStyle='#e8edf6';c.font='600 20px Arial';
 c.fillText(board.pending?'DE MOLEN DRAAIT':board.latest!==null?`LAATSTE BAL: ${board.latest}`:'KLAAR VOOR DE EERSTE BAL',740,24);
 c.textAlign='right';c.fillStyle='#f6d586';c.fillText(`${board.drawn.length} / 75 GETROKKEN`,1405,24);
 c.strokeStyle='#334058';c.lineWidth=1.5;c.beginPath();c.moveTo(32,45);c.lineTo(1408,45);c.stroke();
 const pitchX=88,pitchY=53,radius=23,startX=120,startY=78;
 for(let row=0;row<5;row++){
  const y=startY+row*pitchY;c.textAlign='center';c.fillStyle='#d8bc76';c.font='800 23px Arial';c.fillText('BINGO'[row],36,y);
  for(let col=0;col<15;col++){
   const cell=board.rows[row][col],x=startX+col*pitchX;
   c.save();
   if(cell.lit){
    c.shadowColor=cell.latest?'#fff4b9':'#e6ab32';c.shadowBlur=cell.latest?12:8;
    const fill=c.createRadialGradient(x-10,y-14,2,x,y,radius);
    fill.addColorStop(0,cell.latest?'#ffffff':'#fff8c5');fill.addColorStop(.58,cell.latest?'#fff2b0':'#f6ce65');fill.addColorStop(1,cell.latest?'#ffd767':'#bc852d');
    c.fillStyle=fill;
   }else c.fillStyle='#111e32';
   c.beginPath();c.arc(x,y,radius,0,Math.PI*2);c.fill();
   c.shadowBlur=0;c.strokeStyle=cell.latest?'#fffce5':cell.lit?'#fbd87c':'#33445f';c.lineWidth=cell.latest?3.5:1.5;c.stroke();
   if(cell.latest){c.beginPath();c.arc(x,y,radius+4,0,Math.PI*2);c.strokeStyle='#fff4bb';c.lineWidth=2;c.stroke();}
   c.fillStyle=cell.lit?'#1a1720':'#9aacc7';c.font='800 32px Arial';c.textAlign='center';c.fillText(String(cell.number),x,y+1);c.restore();
  }
 }
 c.restore();
}
