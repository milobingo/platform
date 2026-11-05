import React from 'react';

const COVER='/assets/milo-friends/studio/sterrenplein-grand-preview.webp';
const SHOTS=new Set(['establish','wide','host','portrait','duo','board','guest','magic','dolly','crane','orbit']);

// These are renders of the actual studio composition, rather than a crop marker
// on one shared panorama. The cover is retained as a loading-error fallback.
export default function StudioShotPreview({shot}){
 const src=SHOTS.has(shot)?`/assets/milo-friends/studio/shots/${shot}.webp`:COVER;
 return <img className="mf-shot-preview" src={src} alt="" loading="lazy" decoding="async" onError={event=>{
  const image=event.currentTarget;
  if(image.dataset.fallback==='true')return;
  image.dataset.fallback='true';image.src=COVER;
 }}/>;
}
