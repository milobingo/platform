// Local UI-only preview. It deliberately has no production data or API credentials.
// The real browser-local rehearsal remains available; provider requests fail clearly.
import {createServer} from 'node:http';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {context} from 'esbuild';
import {handleFamilyPreview} from './family-preview-data.mjs';

const root=resolve(import.meta.dirname,'..');
const outdir=resolve(root,'.sites-runtime/preview/app');
await mkdir(outdir,{recursive:true});
const bundler=await context({absWorkingDir:root,entryPoints:['frontend/main.jsx'],outdir,bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',sourcemap:true,chunkNames:'chunks/[name]-[hash]',assetNames:'assets/[name]-[hash]',define:{'process.env.NODE_ENV':'"development"'},logLevel:'warning'});
await bundler.rebuild();
await bundler.watch();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.woff2':'font/woff2','.pdf':'application/pdf'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  const path=decodeURIComponent(url.pathname);
  res.setHeader('Cache-Control','no-store');
  if(path.startsWith('/api/')){
   if(await handleFamilyPreview(req,res,url))return;
   res.writeHead(503,{'Content-Type':'application/json; charset=utf-8'});
   res.end(JSON.stringify({error:{message:'Lokale UI-preview: serverkoppelingen zijn niet actief. Gebruik de oefenstudio.'}}));return;
  }
  const appAsset=path.startsWith('/app/');
  const base=appAsset?outdir:resolve(root,'public');
  const requested=appAsset?path.slice(5):path.slice(1);
  const file=resolve(base,requested||'milo-studio.html');
  if(file!==base&&!file.startsWith(base+sep)){res.writeHead(403);res.end();return;}
  let target=file;
  try{if(!(await stat(target)).isFile())throw Error();}catch{
   if(extname(path)){res.writeHead(404);res.end('Niet gevonden');return;}
   target=resolve(root,'public/milo-studio.html');
  }
  let data=await readFile(target);
  // The managed preview is HTTP, where randomUUID is not exposed. Use the same
  // cryptographic random source for local rehearsal identifiers only.
  if(target.endsWith('milo-studio.html')){
   let html=data.toString().replace('<head>','<head><script>if(!crypto.randomUUID)crypto.randomUUID=()=>"10000000-1000-4000-8000-100000000000".replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16));</script>');
   if(path.startsWith('/spelen')&&url.searchParams.get('voorbeeld')==='1')html=html.replace('</body>','<div style="position:fixed;z-index:10000;right:12px;bottom:12px;background:#1d1031;color:#ffe8a8;border:1px solid #c69a51;border-radius:20px;padding:7px 13px;font:600 11px system-ui;box-shadow:0 4px 24px #0003;pointer-events:none">Voorbeeld · geen echte show</div></body>');
   data=Buffer.from(html);
  }
  res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream'});
  res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(500);res.end('Lokale preview kon het bestand niet laden.');}
});
const port=Number(process.env.PORT||4173);
server.listen(port,'0.0.0.0',()=>console.log(`Lokale UI-preview op ${port}; geen server- of providerkoppelingen.`));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{server.close();await bundler.dispose();process.exit(0);});
