import {showBrand} from './show-brands.js?v=36';
import {createBrandPresenter} from './brand-presenter.js?v=36';

// The reserve/transparent view is prepared before an identity becomes visible.
export async function createBrandReserve(identity,{loadImage,canvasFactory}){
 const b=showBrand(identity);
 const [portrait,talking,backdrop]=await Promise.all([
  loadImage(b.mascot),loadImage(`/assets/hosts/${b.id}-talking.png`),loadImage(`/assets/hosts/${b.id}-master-v36.webp`)
 ]);
 const actor=createBrandPresenter(portrait,{brandId:b.id,mouthImage:talking,canvasFactory});
 return {draw(ctx,width,height,state){
  ctx.save();
  if(!state.overlay){const scale=Math.max(width/backdrop.width,height/backdrop.height);ctx.drawImage(backdrop,(width-backdrop.width*scale)/2,(height-backdrop.height*scale)/2,backdrop.width*scale,backdrop.height*scale);}
  actor.draw(ctx,{x:width*.5,y:height*.96,height:Math.min(height*.88,width*1.22)},{...state,age:state.motionElapsed},state.delta);
  ctx.restore();
 },dispose(){actor.dispose();}};
}
