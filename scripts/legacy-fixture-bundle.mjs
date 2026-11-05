// Historical adapter regressions bundle their own fixture; legacy applications
// are no longer emitted as production entry points.
import {build} from 'esbuild';
export async function importLegacyFixture(entry){
 const result=await build({entryPoints:[entry],write:false,bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
