// A light, explicit technical probe. It creates no show, family or live call.
// Usage: node scripts/load/contract-probe.mjs --credentials-file /private/keys.json --report /private/report.json
import {readFile,writeFile,stat} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import {resolve} from 'node:path';
import {programService,PROGRAM_TRACK_NAMES} from '../../server/program-broadcast.js';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--credentials-file','--report'].includes(args[i])||!args[i+1])throw Error('Use --credentials-file and --report.');options[args[i]]=args[i+1];}
if(!options['--credentials-file']||!options['--report'])throw Error('Provide private credential and report file paths.');
const credentialPath=resolve(options['--credentials-file']),info=await stat(credentialPath);
if(!info.isFile()||info.size>4096||(info.mode&0o077))throw Error('Credentials must be a bounded private file (0600).');
const addresses=await lookup('milo-staging.dgwebservices.nl',{all:true});
if(!addresses.length||addresses.some(address=>address.address!=='128.140.93.95'))throw Error('The staging hostname does not resolve exclusively to the confirmed VPS.');
const credentials=JSON.parse(await readFile(credentialPath,'utf8'));
if(typeof credentials.apiKey!=='string'||typeof credentials.apiSecret!=='string')throw Error('Provide apiKey and apiSecret in the private file.');
const settings={url:'wss://milo-staging.dgwebservices.nl',apiKey:credentials.apiKey,apiSecret:credentials.apiSecret};
const room='milo-staging-load-contract-'+crypto.randomUUID(),identity='programme-contract-'+crypto.randomUUID();
const report={format:1,observedAt:new Date().toISOString(),origin:'https://milo-staging.dgwebservices.nl',roomPrefix:'milo-staging-load-contract-',tests:[],credentialsPrinted:false,realCalls:false,persistedShowsModified:false};let ingressId;
const record=(name,result)=>{report.tests.push({name,...result});if(result.passed!==true)process.exitCode=1;};
try{
 const created=await programService(settings,'RoomService','CreateRoom',{name:room,empty_timeout:30,departure_timeout:5,max_participants:4});record('create-isolated-room',{passed:created.name===room});
 const participants=await programService(settings,'RoomService','ListParticipants',{room});record('list-publishers',{passed:Array.isArray(participants.participants||[]),participants:(participants.participants||[]).length});
 const made=await programService(settings,'Ingress','CreateIngress',{input_type:'WHIP_INPUT',name:'isolated-contract',room_name:room,participant_identity:identity,participant_name:'Technical test encoder',enable_transcoding:false,audio:{name:PROGRAM_TRACK_NAMES.audio,source:'MICROPHONE'},video:{name:PROGRAM_TRACK_NAMES.video,source:'CAMERA'}});
 ingressId=made.ingress_id||made.ingressId;const key=made.stream_key||made.streamKey,endpoint=new URL(made.url);
 const valid=typeof ingressId==='string'&&typeof key==='string'&&!!key&&endpoint.origin==='https://milo-staging.dgwebservices.nl'&&endpoint.pathname==='/whip';
 record('whip-response',{passed:valid,origin:endpoint.origin,pathWithoutSecret:endpoint.pathname,keySeparate:typeof key==='string',bypassTranscoding:made.enable_transcoding===false||made.enableTranscoding===false});if(!valid)throw Error('Unexpected ingress response');
 const listed=await programService(settings,'Ingress','ListIngress',{room_name:room});record('ingress-reconcile',{passed:(listed.items||[]).filter(item=>(item.ingress_id||item.ingressId)===ingressId).length===1,count:(listed.items||[]).length});
 // Invalid SDP publishes nothing. Do not print this credential-bearing URL.
 const target=endpoint.origin+endpoint.pathname+'/'+encodeURIComponent(key);
 const response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/sdp',Authorization:'Bearer '+key},body:'invalid-sdp',signal:AbortSignal.timeout(10000),redirect:'error'});
 const text=(await response.text()).slice(0,4096);record('public-whip-routing-invalid-sdp',{passed:response.status===400,status:response.status,protocolRejectedSdp:/sdp|parse|invalid|decode|session/i.test(text),noTokenEcho:!text.includes(key)});
 const egress=await programService(settings,'Egress','ListEgress',{room_name:room,active:true});record('egress-api',{passed:Array.isArray(egress.items||[]),activeEncoders:(egress.items||[]).length});
}catch(error){record('probe-error',{passed:false,status:error.status||null,code:error.code||error.name});}
finally{
 if(ingressId){try{await programService(settings,'Ingress','DeleteIngress',{ingress_id:ingressId});record('delete-isolated-ingress',{passed:true});}catch(error){record('delete-isolated-ingress',{passed:false,status:error.status||null});}}
 try{await programService(settings,'RoomService','DeleteRoom',{room});record('delete-isolated-room',{passed:true});}catch(error){record('delete-isolated-room',{passed:false,status:error.status||null});}
 await writeFile(resolve(options['--report']),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report,null,2));
}
