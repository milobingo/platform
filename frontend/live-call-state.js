import {useSyncExternalStore} from 'react';

const empty=Object.freeze({call:null,cues:[],queue:[],busy:false,error:'',media:null,settings:null,mode:'real',drawHeld:false});
const noSubscribe=()=>()=>{},getEmpty=()=>empty;
export function useLiveCallState(engine){const runtime=engine?.liveCalls;return [runtime,useSyncExternalStore(runtime?.subscribe||noSubscribe,runtime?.getSnapshot||getEmpty)];}
