// Timing and layouts only. Official winner selection belongs to the game server.
export const MILO_MAGIC_GAME_IDS=Object.freeze(['plingo','ribbons','mirrors','potion','butterfly']);
export const MILO_MAGIC_GAMES=Object.freeze(['ribbons','mirrors','potion','butterfly']);
const timings=Object.freeze({plingo:24,ribbons:28,mirrors:26,potion:26,butterfly:30});
export function minigameDuration(id,preview=false){return timings[id]||(preview?12:20);}
export function miloMagicObjectPose(frame,group){
 const n=frame.groups.length,i=group.index,cols=n<=5?n:Math.ceil(n/2),rows=Math.ceil(n/cols),row=Math.floor(i/cols),count=Math.min(cols,n-row*cols),col=i%cols;
 const step=Math.min(470,1560/cols),x=960+(col-(count-1)/2)*step,y=rows===1?505:345+row*299;
 const lane=1650/n;
 return {x,y,size:Math.min(rows===1?340:230,step*.82),angle:0,chipX:frame.game==='ribbons'?160+(i+.5)*1600/n:135+(i+.5)*lane,chipY:855,width:Math.min(265,lane-10),height:n>6?48:54,progress:frame.progress,colorIndex:i};
}
