// RFC 9110 single byte ranges used by Chromium when looping/seeking a WAV.
export function waveByteRange(header,size){
  if(!Number.isSafeInteger(size)||size<1)throw new Error('De technische WAV is leeg of te groot.');
  if(header===undefined)return {status:200,start:0,end:size-1};
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!match||(!match[1]&&!match[2]))return {status:416};
  let start,end;
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)return {status:416};start=Math.max(0,size-suffix);end=size-1;}
  else{start=Number(match[1]);end=match[2]?Math.min(size-1,Number(match[2])):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return {status:416};
  return {status:206,start,end};
}
