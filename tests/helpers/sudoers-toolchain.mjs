import {mkdtempSync,writeFileSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

// Ubuntu 26.04 defaults to sudo-rs. The supported C sudo package installs
// visudo.ws; older Ubuntu versions install the same parser as visudo.
export const VISUDO_CANDIDATES=Object.freeze(['/usr/sbin/visudo.ws','/usr/sbin/visudo']);
const digestPolicy=`milo-probe ALL=(root) NOPASSWD:NOSETENV: sha256:${'a'.repeat(64)} /usr/local/libexec/milo-sudoers-probe ^milo-probe [a-f0-9]{40} [1-9][0-9]*-[1-9][0-9]*$\n`;

export function selectDigestVisudo({pinned=process.env.MILO_TEST_VISUDO,run=spawnSync}={}) {
 if(pinned&&!VISUDO_CANDIDATES.includes(pinned))throw Error('visudo_parser_path_not_allowed');
 const directory=mkdtempSync(join(tmpdir(),'milo-visudo-probe-'));
 try{
  const valid=join(directory,'valid.sudoers'),invalid=join(directory,'invalid.sudoers');
  writeFileSync(valid,digestPolicy,{mode:0o600});
  writeFileSync(invalid,digestPolicy.replace('sha256:'+'a'.repeat(64),'sha256:INVALID!'),{mode:0o600});
  for(const parser of pinned?[pinned]:VISUDO_CANDIDATES){
   const options={encoding:'utf8',timeout:10000};
   if(run(parser,['-cf',valid],options).status!==0)continue;
   // A no-op replacement must not satisfy this required policy check.
   const rejected=run(parser,['-cf',invalid],options);
   if(rejected.error||rejected.signal||rejected.status===null||rejected.status===0)continue;
   const version=run(parser,['--version'],options);
   if(version.status!==0)continue;
   return {parser,version:version.stdout.trim().split('\n')[0],digestAndArgumentRegex:true,malformedDigestRejected:true};
  }
  throw Error('digest_capable_visudo_required: install the official Ubuntu sudo package; digest policy validation cannot be skipped');
 }finally{rmSync(directory,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.argv.slice(2).some(arg=>arg!=='--github-env'))throw Error('unknown_visudo_toolchain_argument');
  const selected=selectDigestVisudo();
  if(process.argv.includes('--github-env')){
   if(!process.env.GITHUB_ENV)throw Error('github_environment_file_required');
   appendFileSync(process.env.GITHUB_ENV,`MILO_TEST_VISUDO=${selected.parser}\n`);
  }
  console.log(JSON.stringify(selected));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
