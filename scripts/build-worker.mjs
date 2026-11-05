import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
// Every supported HTML entry must point at the same application release.
const studioHtml=await readFile('public/milo-studio.html','utf8');
for(const alias of ['index.html','player.html','studio-hub.html'])await writeFile('public/'+alias,studioHtml);
await cp('server/show-cues.js','public/show-cues.js');
await cp('server/show-brands.js','public/show-brands.js');
await cp('server/characters.js','public/characters.js');
await cp('server/production-model.js','public/production-model.js');
await cp('server/plan-model.js','public/plan-model.js');
await cp('server/presentation-model.js','public/presentation-model.js');
await cp('server/bingo-model.js','public/bingo-model.js');
for(const name of ['plan-model','presentation-model','bingo-model','production-model','show-brands','characters','show-cues']){const path=`public/${name}.js`;await writeFile(path,(await readFile(path,'utf8')).replace(/from (['"])(\.\/[a-z-]+\.js)\1/g,"from '$2?v=36'"));}
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await cp('public','dist/client',{recursive:true});
await cp('server','dist/server',{recursive:true});
await mkdir('.sites-runtime',{recursive:true});
await build({entryPoints:['frontend/main.jsx'],outdir:'dist/client/app',bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,chunkNames:'chunks/[name]-[hash]',assetNames:'assets/[name]-[hash]',define:{'process.env.NODE_ENV':'"production"'},metafile:true}).then(result=>writeFile('.sites-runtime/build-meta.json',JSON.stringify(result.metafile)));
await writeFile('dist/server/milo-page.js',`export default ${JSON.stringify(studioHtml)};\n`);
await cp('.openai/hosting.json','dist/.openai/hosting.json');
await build({entryPoints:['dist/server/index.js'],outfile:'dist/server/index.js',allowOverwrite:true,bundle:true,format:'esm',platform:'browser',target:'es2022'});
const worker=await import('../dist/server/index.js?build='+Date.now());
if(typeof worker.default?.fetch!=='function')throw new Error('Worker fetch ontbreekt');
console.log('Studio en OpenAI-server gebouwd.');
