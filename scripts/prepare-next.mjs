import {copyFile, readFile, writeFile, mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const vendor=spawnSync(process.execPath,['scripts/vendor-three.mjs'],{stdio:'inherit'});
if(vendor.status!==0)process.exit(vendor.status||1);
for(const name of ['plan-model','presentation-model','bingo-model','production-model','show-brands','characters','show-cues','magic-cues','game-capacity','game-rules','show-time']) {
  await copyFile(`server/${name}.js`,`public/${name}.js`);
}
// Keep the source Site identity as historical evidence, never as target hosting configuration.
await mkdir('verification',{recursive:true});
const pkg=JSON.parse(await readFile('package.json','utf8'));
await writeFile('verification/toolchain.json',JSON.stringify({node:process.version,packageManager:pkg.packageManager,next:pkg.dependencies.next,sourceCommit:'f81d0c1c60cbe1422d43ce46d896af6cd4d2939c',initialSourceCommit:'08e1a652a78586d2e791179eead388acad8a3266',handoffVersion:'2026-11-09-v70'},null,2)+'\n');
