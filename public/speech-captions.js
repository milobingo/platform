// Short, sequential subtitles keep the presenter visible on portrait screens.
export function splitCaptions(text,limit=60){
  const result=[];let block=null;
  const flush=()=>{if(block){result.push(block);block=null;}};
  for(const match of text.matchAll(/\S+/g)){
    const word=match[0],start=match.index;
    if(word.length>limit){flush();for(let i=0;i<word.length;i+=limit)result.push({text:word.slice(i,i+limit),start:start+i,end:Math.min(start+i+limit,start+word.length)});continue;}
    if(block&&block.text.length+word.length+1>limit)flush();
    if(!block)block={text:word,start,end:start+word.length};
    else{block.text+=' '+word;block.end=start+word.length;}
    if(/[.!?]$/.test(word)&&block.text.length>32)flush();
  }
  flush();return result;
}
export function captionAt(chunks,index){
  if(!chunks.length)return null;
  return chunks.find(c=>index<c.end)??chunks.at(-1);
}
