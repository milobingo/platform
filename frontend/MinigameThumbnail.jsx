import React,{useEffect,useRef,useState} from 'react';
import {drawBingoStage} from '../public/bingo-scenes.js';
import {minigameDuration} from '../public/milo-minigame-plan.js';

/** One still from the actual game renderer. No timer, audio or game request. */
export default function MinigameThumbnail({id,title}){
 const ref=useRef(null),[ready,setReady]=useState(false);
 useEffect(()=>{
  const canvas=ref.current,ctx=canvas?.getContext('2d');
  if(!ctx)return;
  setReady(false);
  const entrants=['Noor','Sam','Mila','Daan','Luca','Tess'].map((name,i)=>({bookId:'voorbeeld-'+i,name,ticket:String(i+1).padStart(4,'0')}));
  const duration=minigameDuration(id),result={id:'catalogus-'+id,minigame:id,entrants,winner:entrants[2],prize:{title:'Voorbeeldprijs'}};
  // Crop the game floor: the surrounding card supplies the title and controls.
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(canvas.width/1790,0,0,canvas.height/720,-65*canvas.width/1790,-177*canvas.height/720);
  try{
   drawBingoStage(ctx,{brandId:'milo',scene:'minigame',age:duration*(id==='butterfly'?.77:.66),paused:false,reducedMotion:false,gameStage:{type:'minigame',playId:'catalogus-'+id,result,duration}},{brandId:'milo'});
   setReady(true);
  }catch{
   // A failed still is visible as unavailable, never as a successful preview.
   ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  }
 },[id]);
 return <><canvas ref={ref} width={720} height={290} className="se-game-thumbnail" role="img" aria-label={`Stilstaand voorbeeld van ${title}, met fictieve deelnemers`} data-rendered={ready}/>{ready?<small className="se-game-example">Voorbeeld</small>:<small className="se-game-thumbnail-unavailable">Voorbeeld niet beschikbaar</small>}</>;
}
