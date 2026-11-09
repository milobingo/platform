import {createServer,createConnection} from 'node:net';
import {networkInterfaces,hostname,userInfo} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const MAX_LIFETIME_MS=30*60*1000,CONNECT_TIMEOUT_MS=10000,IDLE_TIMEOUT_MS=10*60*1000,MAX_CONNECTIONS=16;
export const RESTORE_RELAY_PLANS=Object.freeze({
 runner:Object.freeze({listenHost:'127.0.0.1',listenPort:55433,allowedPeer:'127.0.0.1',targetHost:'100.79.0.26',targetPort:54388,sourceHost:'100.111.66.17'}),
 worker:Object.freeze({listenHost:'100.79.0.26',listenPort:54388,allowedPeer:'100.111.66.17',targetHost:'127.0.0.1',targetPort:54389,sourceHost:'127.0.0.1'}),
});
const ipv4=value=>String(value||'').replace(/^::ffff:/,'');
class RelayError extends Error{constructor(code){super('De tijdelijke vaste Milo-herstelrelay is gestopt; er zijn geen credentials gelogd.');this.code=code;}}
const rolePlan=role=>{if(!Object.hasOwn(RESTORE_RELAY_PLANS,role))throw new RelayError('relay_role');return RESTORE_RELAY_PLANS[role];};

export function assertRelayIdentity(role,{uid=process.getuid?.(),name=userInfo().username,host=hostname(),interfaces=networkInterfaces()}={}){
 const plan=rolePlan(role),expectedAddress=role==='runner'?plan.sourceHost:plan.listenHost;
 if(!Number.isInteger(uid)||uid===0||!Object.values(interfaces).flat().some(item=>item?.address===expectedAddress))throw new RelayError('relay_identity');
 if(role==='runner'&&(uid!==1001||name!=='run-mil-stg'||host!=='dg-nxttrack-01'))throw new RelayError('relay_identity');
}

/** Fixed endpoints only. Transport injection lets tests use isolated loopback
 * sockets; the CLI provides no endpoint, peer, shell or credential options. */
export async function startRestoreRelay(role,{serverFactory=createServer,connector=createConnection,lifetimeMs=MAX_LIFETIME_MS}={}){
 const plan=rolePlan(role);
 if(!Number.isSafeInteger(lifetimeMs)||lifetimeMs<1||lifetimeMs>MAX_LIFETIME_MS)throw new RelayError('relay_lifetime');
 const pairs=new Set();let stopping,expiry,resolveClosed;
 const closed=new Promise(done=>{resolveClosed=done;});
 const server=serverFactory({allowHalfOpen:true},socket=>{
  socket.on('error',()=>{});
  if(stopping||pairs.size>=MAX_CONNECTIONS||ipv4(socket.remoteAddress)!==plan.allowedPeer){socket.destroy();return;}
  socket.pause();let target;
  try{target=connector({host:plan.targetHost,port:plan.targetPort,localAddress:plan.sourceHost,allowHalfOpen:true});}catch{socket.destroy();return;}
  const pair={socket,target};pairs.add(pair);
  const destroy=()=>{socket.destroy();target.destroy();},connecting=setTimeout(destroy,CONNECT_TIMEOUT_MS);
  connecting.unref();
  socket.setTimeout(IDLE_TIMEOUT_MS,destroy);target.setTimeout(IDLE_TIMEOUT_MS,destroy);
  socket.setKeepAlive(true,15000);target.setKeepAlive(true,15000);
  target.on('error',destroy);
  target.once('connect',()=>{clearTimeout(connecting);if(stopping)return destroy();socket.pipe(target);target.pipe(socket);socket.resume();});
  socket.once('close',()=>{clearTimeout(connecting);pairs.delete(pair);target.destroy();});
  target.once('close',hadError=>{clearTimeout(connecting);if(hadError||!target.readableEnded)destroy();else socket.end();});
 });
 const stop=(reason='requested')=>{
  if(stopping)return stopping;
  stopping=new Promise(done=>{clearTimeout(expiry);for(const pair of pairs){pair.socket.destroy();pair.target.destroy();}server.close(()=>{const result={role,event:'closed',listeners:0,reason:['requested','expired','signal','listener_error'].includes(reason)?reason:'requested'};resolveClosed(result);done(result);});});
  return stopping;
 };
 try{
  await new Promise((done,reject)=>{const failed=()=>reject(new RelayError('relay_bind'));server.once('error',failed);server.listen({host:plan.listenHost,port:plan.listenPort,exclusive:true},()=>{server.removeListener('error',failed);done();});});
 }catch(error){for(const pair of pairs){pair.socket.destroy();pair.target.destroy();}server.close();throw error;}
 server.on('error',()=>{void stop('listener_error');});
 expiry=setTimeout(()=>{void stop('expired');},lifetimeMs);expiry.unref();
 return {server,closed,stop};
}

export async function main(argv=process.argv.slice(2)){
 if(argv.length!==1)throw new RelayError('relay_arguments');const [role]=argv;assertRelayIdentity(role);
 const relay=await startRestoreRelay(role),terminate=()=>{void relay.stop('signal');};
 process.once('SIGTERM',terminate);process.once('SIGINT',terminate);
 process.stdout.write(JSON.stringify({role,event:'ready',listeners:1})+'\n');
 try{const result=await relay.closed;process.stdout.write(JSON.stringify(result)+'\n');return result.reason==='listener_error'?1:0;}
 finally{process.removeListener('SIGTERM',terminate);process.removeListener('SIGINT',terminate);await relay.stop();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{process.exitCode=await main();}catch(error){process.stderr.write(JSON.stringify({ok:false,code:error instanceof RelayError?error.code:'relay_failed',message:'De tijdelijke Milo-herstelrelay is niet beschikbaar; geen credential- of driverdetails gelogd.'})+'\n');process.exitCode=1;}
}
