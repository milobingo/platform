import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseGateError,upgradeV70Database} from './database.mjs';

export async function main(argv=process.argv.slice(2),env=process.env){
 const options={env};let confirmed=false;
 for(const argument of argv){
  if(argument==='--apply-reviewed-v70')confirmed=true;
  else if(argument.startsWith('--expected-project-ref='))options.expectedProjectRef=argument.slice('--expected-project-ref='.length);
  else if(argument.startsWith('--reviewed-baseline-manifest-sha256='))options.reviewedBaselineManifestSha256=argument.slice('--reviewed-baseline-manifest-sha256='.length);
  else if(argument.startsWith('--reviewed-manifest-sha256='))options.reviewedManifestSha256=argument.slice('--reviewed-manifest-sha256='.length);
  else throw new DatabaseGateError('unknown_option','Gebruik uitsluitend de bevestigde projectref en beide vooraf beoordeelde manifestdigests.');
 }
 if(!confirmed)throw new DatabaseGateError('upgrade_confirmation_required','Deze afzonderlijke upgrade vereist --apply-reviewed-v70 en een volledige backup-/herstelproef.');
 const result=await upgradeV70Database(options);process.stdout.write(JSON.stringify(result,null,2)+'\n');return result.ok?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{process.exitCode=await main();}
 catch(error){const safe=error instanceof DatabaseGateError?{code:error.code,message:error.message}:{code:'database_upgrade_failed',message:'De gecontroleerde upgrade is gestopt. Verbindingswaarden en database-/toolstderr worden niet gelogd.'};process.stderr.write(JSON.stringify({ok:false,...safe})+'\n');process.exitCode=1;}
}
