import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,createConnection} from 'node:net';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {RESTORE_RELAY_PLANS,assertRelayIdentity,startRestoreRelay} from '../scripts/deploy/staging-restore-relay.mjs';

async function listener(t,onConnection){const sockets=new Set(),server=createServer({allowHalfOpen:true},socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));onConnection(socket);});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(done=>server.close(done));});return server;}
async function mappedRelay(t,{peer='100.111.66.17',upstream,lifetimeMs,listenPort=0}={}){
 let connects=0;const relay=await startRestoreRelay('worker',{
  ...(lifetimeMs?{lifetimeMs}:{}),
  serverFactory:(options,accept)=>{const server=createServer(options,socket=>{Object.defineProperty(socket,'remoteAddress',{value:peer});accept(socket);}),listen=server.listen.bind(server);server.listen=(bind,done)=>{assert.deepEqual(bind,{host:'100.79.0.26',port:54388,exclusive:true});return listen({host:'127.0.0.1',port:listenPort,exclusive:true},done);};return server;},
  connector:options=>{connects++;assert.deepEqual(options,{host:'127.0.0.1',port:54389,localAddress:'127.0.0.1',allowHalfOpen:true});return createConnection({...options,port:upstream.address().port});},
 });t.after(()=>relay.stop());return {...relay,get connects(){return connects;}};
}
async function client(relay){const socket=createConnection({host:'127.0.0.1',port:relay.server.address().port});socket.on('error',()=>{});await once(socket,'connect');return socket;}

test('restore relay exposes two fixed plans, refuses root/wrong runner/missing local Tailscale address and cannot extend30min',async()=>{
 assert.deepEqual(RESTORE_RELAY_PLANS.runner,{listenHost:'127.0.0.1',listenPort:55433,allowedPeer:'127.0.0.1',targetHost:'100.79.0.26',targetPort:54388,sourceHost:'100.111.66.17'});
 const valid={uid:1001,name:'run-mil-stg',host:'dg-nxttrack-01',interfaces:{tailscale0:[{address:'100.111.66.17'}]}};assertRelayIdentity('runner',valid);
 for(const change of [{uid:0},{name:'another-user'},{host:'other-host'},{interfaces:{}}])assert.throws(()=>assertRelayIdentity('runner',{...valid,...change}),e=>e.code==='relay_identity');
 await assert.rejects(startRestoreRelay('arbitrary'),e=>e.code==='relay_role');await assert.rejects(startRestoreRelay('worker',{lifetimeMs:1800001}),e=>e.code==='relay_lifetime');
});

test('fixed relay preserves binary streams and final half-close bytes through actual isolated loopback sockets',async t=>{
 const content=randomBytes(512*1024+17),upstream=await listener(t,socket=>{const chunks=[];socket.on('data',chunk=>chunks.push(chunk));socket.on('end',()=>{assert.deepEqual(Buffer.concat(chunks),content);socket.end(Buffer.concat([Buffer.from('response:'),content]));});}),relay=await mappedRelay(t,{upstream}),socket=await client(relay),chunks=[];
 socket.on('data',x=>chunks.push(x));socket.end(content);await once(socket,'close');assert.equal(relay.connects,1);assert.deepEqual(Buffer.concat(chunks),Buffer.concat([Buffer.from('response:'),content]));
});

test('wrong Tailscale peer is closed before any outbound scratch connection',async t=>{
 let accepted=0;const upstream=await listener(t,()=>accepted++),relay=await mappedRelay(t,{upstream,peer:'100.111.66.170'}),socket=await client(relay);socket.write('must not reach scratch');await new Promise(done=>socket.once('close',done));assert.equal(relay.connects,0);assert.equal(accepted,0);
});

test('occupied port fails without replacing the existing listener',async t=>{
 const upstream=await listener(t,socket=>socket.end('original-listener'));
 await assert.rejects(mappedRelay(t,{upstream,listenPort:upstream.address().port}),e=>e.code==='relay_bind');
 const socket=createConnection(upstream.address().port,'127.0.0.1'),chunks=[];socket.on('data',x=>chunks.push(x));await once(socket,'close');assert.equal(Buffer.concat(chunks).toString(),'original-listener');
});

test('hard expiry closes listener and active connections; cleanup is idempotent',async t=>{
 let peer;const upstream=await listener(t,socket=>{peer=socket;}),relay=await mappedRelay(t,{upstream,lifetimeMs:100}),socket=await client(relay);
 const finished=new Promise(done=>socket.once('close',done)),result=await relay.closed;await finished;assert.equal(result.reason,'expired');assert.equal(result.listeners,0);assert.equal(relay.server.listening,false);assert(peer?.destroyed||peer?.readableEnded);assert.deepEqual(await relay.stop(),result);
});
