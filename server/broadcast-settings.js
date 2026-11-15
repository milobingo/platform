// This parser only extracts a public video ID; it never contacts YouTube.
export function normalizeYoutubeId(value){
 if(typeof value!=='string')throw Object.assign(Error('Vul een YouTube-video-ID of een YouTube-link in.'),{status:400,code:'youtube_invalid'});
 const input=value.trim();if(!input)return '';
 if(/^[A-Za-z0-9_-]{11}$/.test(input))return input;
 let url;
 try{url=new URL(/^(?:www\.|m\.)?youtube\.com\/|^(?:www\.)?youtu\.be\//i.test(input)?'https://'+input:input);}catch{}
 const host=url?.hostname.toLowerCase();let id='';
 if(url&&['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!url.port){
  if(['youtu.be','www.youtu.be'].includes(host))id=url.pathname.split('/').filter(Boolean)[0]||'';
  else if(['youtube.com','www.youtube.com','m.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(host)){
   const parts=url.pathname.split('/').filter(Boolean);
   if(parts[0]==='watch')id=url.searchParams.get('v')||'';
   else if(['live','embed','shorts'].includes(parts[0]))id=parts[1]||'';
  }
 }
 if(!/^[A-Za-z0-9_-]{11}$/.test(id))throw Object.assign(Error('Gebruik de elf tekens van de YouTube-video-ID of een geldige YouTube-link.'),{status:400,code:'youtube_invalid'});
 return id;
}
export const broadcastSettings=game=>({youtubeId:game.settings?.youtubeId||'',revision:Number.isSafeInteger(game.broadcastRevision)?game.broadcastRevision:0});
