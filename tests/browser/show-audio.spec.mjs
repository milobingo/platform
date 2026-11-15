import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// These checks render original music through Chromium's real Web Audio engine.
// No account, show, provider, microphone or OBS installation is contacted.
let server,origin;
test.beforeAll(async()=>{
 const publicRoot=fileURLToPath(new URL('../../public/',import.meta.url));
 server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Original show music render</title>');return;}const file=resolve(publicRoot,'.'+path);if(!file.startsWith(publicRoot)||!file.endsWith('.js'))throw Error('Invalid local asset');res.writeHead(200,{'Content-Type':'application/javascript'});res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await new Promise(resolve=>server.close(resolve));});

test('original Milo music renders continuously, ducks for speech/numbers and stops at pause',async({page})=>{
 await page.goto(origin);const proof=await page.evaluate(async()=>{
  const {createShowAudio}=await import('/show-audio.js');
  let native,context;
  class Context{
   currentTime=0;state='running';
   constructor(){context=this;native=new OfflineAudioContext(2,48000*12,48000);this.destination=native.destination;}
   createMediaStreamDestination(){const destination=native.createGain();destination.stream={getTracks:()=>[]};return destination;}
   createGain(){return native.createGain();}
   createAnalyser(){return native.createAnalyser();}
   createOscillator(){const oscillator=native.createOscillator(),stop=oscillator.stop.bind(oscillator);oscillator.stop=time=>stop(time===undefined?context.currentTime:time);return oscillator;}
   async resume(){}
   async close(){}
  }
  async function render(ducking){
   const audio=createShowAudio({Context});await audio.unlock();audio.enableBackground(true);
   for(let i=0;i<=110;i++){const t=i/10;context.currentTime=t;if(ducking&&i===20)audio.duck(true);if(ducking&&i===40)audio.duck(false);if(i===90)audio.pause();audio.tickGame({brandId:'milo',scene:ducking&&i>=60&&i<80?'draw':'host',paused:i>=90});}
   const buffer=await native.startRendering(),data=buffer.getChannelData(0),rms=(start,end)=>{let squares=0,count=0;for(let i=Math.floor(start*buffer.sampleRate);i<Math.floor(end*buffer.sampleRate);i++){squares+=data[i]**2;count++;}return Math.sqrt(squares/count);};
   const windows=Array.from({length:80},(_,i)=>({time:.5+i*.1,rms:rms(.5+i*.1,.6+i*.1)})),peak=data.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
   // Keep sample evidence small; the waveform comes from real oscillators,
   // envelopes and mixer automation rather than a fake amplitude report.
   return {sampleRate:buffer.sampleRate,frames:buffer.length,peak,windows,normal:rms(.5,1.5),voiceDucked:rms(2.5,3),numberDucked:rms(6.5,7),restored:rms(8.5,8.9),paused:rms(9.2,11.5)};
  }
  return {...await render(true),baseline:await render(false)};
 });
 expect(proof.frames).toBe(576000);expect(proof.normal).toBeGreaterThan(.0001);expect(proof.peak).toBeLessThan(.03);expect(proof.voiceDucked).toBeLessThan(proof.baseline.voiceDucked*.4);expect(proof.numberDucked).toBeLessThan(proof.baseline.numberDucked*.4);expect(proof.restored).toBeGreaterThan(proof.baseline.restored*.95);expect(proof.paused).toBeLessThan(1e-8);expect(Math.min(...proof.windows.map(w=>w.rms))).toBeGreaterThan(.00001);
 await mkdir('verification/show-audio',{recursive:true});await writeFile('verification/show-audio/rendered-music.json',JSON.stringify({actualChromiumOfflineAudioRendering:true,actualProviderCalls:false,actualOBSInstallation:false,...proof},null,2)+'\n');
});
