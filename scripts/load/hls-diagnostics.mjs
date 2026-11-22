const finite=value=>Number.isFinite(value)?value:null;
const label=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value)?value:'unknown';
export function createHlsEventLog(limit=32){
  if(!Number.isInteger(limit)||limit<1||limit>64)throw new RangeError('HLS-diagnostiek vereist een begrensd log.');
  const events=[];let total=0;
  return {
    record(event,observedAtMs=Date.now()){
      const safe={observedAtMs:finite(observedAtMs),type:label(event?.type),details:label(event?.details),fatal:event?.fatal===true};
      // Never copy response/fragment URLs, request headers, messages or tokens.
      events.push(safe);if(events.length>limit)events.shift();total++;
    },
    snapshot(){return {total,retained:events.length,limit,events:events.map(event=>({...event}))};},
  };
}
function ranges(value,limit){
  const result=[];
  for(let index=0;value&&index<Math.min(value.length,limit);index++)result.push({start:finite(value.start(index)),end:finite(value.end(index))});
  return result;
}
export function hlsPlaybackSnapshot(video,hls){
  const buffered=ranges(video.buffered,8),currentTime=finite(video.currentTime),containing=buffered.find(range=>range.start<=currentTime&&range.end>=currentTime);
  return {currentTime,paused:video.paused===true,readyState:video.readyState,networkState:video.networkState,playbackRate:finite(video.playbackRate),width:video.videoWidth,height:video.videoHeight,buffered,seekable:ranges(video.seekable,4),forwardBufferSeconds:containing?containing.end-currentTime:0,latencySeconds:finite(hls?.latency),targetLatencySeconds:finite(hls?.targetLatency),maxLatencySeconds:finite(hls?.maxLatency),liveSyncPosition:finite(hls?.liveSyncPosition),lowLatencyMode:hls?.config?.lowLatencyMode??null,maxLiveSyncPlaybackRate:finite(hls?.config?.maxLiveSyncPlaybackRate),liveSyncOnStallIncrease:finite(hls?.config?.liveSyncOnStallIncrease)};
}
