import {showBrand} from './show-brands.js?v=36';
export function brandedContext(ctx,identity){
 const b=showBrand(identity);if(b.id==='vlampie')return ctx;
 const cache=new Map();const color=value=>{if(typeof value!=='string'||!/^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value))return value;if(cache.has(value))return cache.get(value);const [r,g,bl]=[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)),max=Math.max(r,g,bl),min=Math.min(r,g,bl);let out=value;
  if(bl>r*1.1&&bl>g*.98&&max-min>10){const lum=(r+g+bl)/3;const rgb=b.id==='milo'?[lum*.92,lum*.58,lum*1.36]:[lum*.64,lum*1.02,lum*1.16];out='#'+rgb.map(n=>Math.round(Math.min(255,n)).toString(16).padStart(2,'0')).join('')+value.slice(7);}
  cache.set(value,out);return out;};
 return new Proxy(ctx,{set(target,key,value){target[key]=['fillStyle','strokeStyle','shadowColor'].includes(key)?color(value):value;return true;},get(target,key){if(key==='createLinearGradient'||key==='createRadialGradient')return(...args)=>{const gradient=target[key](...args),add=gradient.addColorStop.bind(gradient);gradient.addColorStop=(offset,value)=>add(offset,color(value));return gradient;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
}
