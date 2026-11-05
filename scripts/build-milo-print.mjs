import fs from 'node:fs/promises';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {drawRoundTitles,printTools} from '../server/bingo-print-layout.js';

// Original artwork remains the supplied PNG in the Site. Its full composition
// is embedded directly as transparent PNG in colour; mono uses the ink-saving outline PNG.
const base=new URL('../public/assets/milo-friends/',import.meta.url),logos={};
for(const mode of ['color','mono'])logos[mode]=Buffer.from(await fs.readFile(new URL(mode==='color'?'logo.png':'logo-print-ink.png',base))).toString('base64');
await fs.writeFile(new URL('../server/milo-print-assets.js',import.meta.url),`// Generated from the supplied group logo by scripts/build-milo-print.mjs.\nexport const MILO_PRINT_LOGOS=${JSON.stringify(logos)};\n`);
const scenery=Buffer.from(await fs.readFile(new URL('print-waves.png',base))).toString('base64');
await fs.writeFile(new URL('../server/milo-print-scenery.js',import.meta.url),`// Generated print-resolution scenery. Regenerate with scripts/render-milo-print-art.mjs.\nexport const MILO_PRINT_SCENERY=${JSON.stringify(scenery)};\n`);
const {miloPrintBackground}=await import('../server/milo-print-layout.js?build='+Date.now());
for(const mode of ['color','mono']){
 const pdf=await PDFDocument.load(await miloPrintBackground(mode)),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 drawRoundTitles(pdf.getPage(0),{font,bold,mode,brand:'milo',titles:['RONDE 1','RONDE 2','RONDE 3','FINALERONDE']});
 const {text}=printTools(pdf.getPage(0),font,bold),ink=mode==='mono'?'444444':'F1C469';
 text('BLADNUMMER',127,31.6,5.8,true,ink,{align:'center'});
 text('________',127,38,10,true,ink,{align:'center'});
 pdf.setTitle(`Milo & Friends - Sterrenmagie A5 sjabloon - ${mode==='mono'?'inktarm zwart-wit':'kleur'}`);
 const bytes=await pdf.save();
 await fs.writeFile(new URL(`template-${mode}.pdf`,base),bytes);
 // Keep previously shared template URLs current too.
 await fs.writeFile(new URL(`../hosts/milo-template-${mode}.pdf`,base),bytes);
}
console.log('Sterrenmagie print-assets en A5 kleur-/inktarme sjablonen bijgewerkt.');
