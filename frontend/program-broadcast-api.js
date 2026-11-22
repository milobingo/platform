// Programme tokens are short lived and stay in memory. Never put them in logs,
// localStorage, an iframe URL, or a call-room connection.
export async function programBroadcastRequest(gameId,action,{body,signal,fetcher=globalThis.fetch}={}){
 const write=body!==undefined;
 const response=await fetcher('/api/broadcast/'+encodeURIComponent(gameId)+'/'+action,{
  method:write?'POST':'GET',credentials:'same-origin',cache:'no-store',
  signal:signal||AbortSignal.timeout(12000),
  headers:{'X-Milo-Broadcast':'1',...(write?{'Content-Type':'application/json'}:{})},
  ...(write?{body:JSON.stringify(body)}:{}),
 });
 let data;try{data=await response.json();}catch{throw Error('De uitzendserver gaf geen bruikbaar antwoord. Probeer opnieuw.');}
 if(!response.ok)throw Object.assign(Error(data.error?.message||data.error||'De uitzending is nog niet beschikbaar.'),{status:response.status,code:data.error?.code});
 return data;
}

/** While TV playback is delayed, never advance the phone from server time. */
export function programVisibleDrawn(game,remoteActive,heard){
 const drawn=game?.state?.drawn||[];
 if(!remoteActive)return drawn;
 const key=game?.id+':'+game?.state?.roundIndex;
 if(heard?.key!==key)return [];
 const index=drawn.indexOf(heard.number);
 return index<0?[]:drawn.slice(0,index+1);
}
