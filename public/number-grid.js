import {bingoBoardState} from './bingo-board.js?v=36';

// Read-only view of the same completed draws used by the studio's LED board.
export function createNumberGrid(element){
 const doc=element.ownerDocument,cells=Array.from({length:75},(_,index)=>{
  const cell=doc.createElement('li');cell.className='number-cell';cell.textContent=String(index+1);return cell;
 });
 element.replaceChildren(...cells);let lastKey=null;
 return {update(state){
  const board=bingoBoardState(state),key=board.drawn.join(',');
  if(key!==lastKey){
   lastKey=key;
   for(const row of board.rows)for(const ball of row){
    const cell=cells[ball.number-1];cell.classList.toggle('is-called',ball.lit);cell.classList.toggle('is-latest',ball.latest);
    const label=`Nummer ${ball.number}${ball.latest?', laatste getrokken bal':ball.lit?', getrokken':', nog niet getrokken'}`;
    cell.setAttribute('aria-label',label);cell.title=label;
    if(ball.latest)cell.setAttribute('aria-current','true');else cell.removeAttribute('aria-current');
   }
  }
  return board;
 }};
}
