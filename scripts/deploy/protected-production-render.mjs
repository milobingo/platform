import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {loadProductionProfile,validateProductionProfile,productionPaths,profileDigest,sha256,fail} from './production-profile.mjs';
import {renderProductionBundle} from './production-render.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
// The shared staging module is imported as a library in the installed bundle.
// Its standalone CLI must not execute after esbuild flattens import.meta.url to
// the production bundle URL and consume the production request's stdin first.
const STAGING_GATE_CLI=String.raw`if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {requireValue(process.argv.length===3 && process.argv[2]==='--stdin','Use the fixed stdin release interface');process.stdout.write(JSON.stringify(await verifyRelease(await readJsonInput()))+'\n');}
  catch(error) {console.error(error instanceof ReleaseGateError ? error.message : 'Release verification failed; no credential or provider detail is logged');process.exitCode=1;}
}`;
export const PROTECTED_PRODUCTION_TEMPLATE_PINS=Object.freeze({
 'infra/protected/deploy-entry.py':'4427faff605c20987979b25907c10ada0fc06182c543fd81eb3e0e595dd3fb52',
 'infra/protected/deploy-helper.py':'4afcc454f95efb00e44991b587fbccbf539dcc63385e741f4e9adce5fabaac48',
 'infra/protected/extract-source.py':'f3c014830bd6134cbbd2561a79163267509a270cab42f916f55a9b5373532e72',
 'infra/protected/lock-guardian.py':'5d5bbdc90bbb9ab6ea57514bcfd313de7f478323a6e36cd85a1f403730077c36',
 'infra/protected/release-gate.mjs':'537ed06a96d51c06ae25b99f4d0a62e67b3b117f49c3c3eed8ccfc7bcfccaf2e',
});
export function protectedProductionPaths(profile){
 const p=validateProductionProfile(profile),base=productionPaths(p);
 return {...base,entry:`/usr/local/bin/dg-${p.siteId}-protected-deploy`,helper:`/usr/local/libexec/dg-${p.siteId}-protected-deploy-helper`,legacyHelper:base.helper,policy:`/etc/dg-sites/${p.siteId}/protected-deploy.json`,configRoot:`/etc/dg-sites/${p.siteId}/configs`,acceptanceRoot:`/etc/dg-sites/${p.siteId}/staging-acceptance`,gate:`/usr/local/libexec/${p.siteId}-protected-release-gate.mjs`,extractor:`/usr/local/libexec/${p.siteId}-protected-extract-source.py`,guardian:`/usr/local/libexec/${p.siteId}-protected-lock-guardian.py`,siteLock:`/run/lock/${p.siteId}.deploy.lock`,sudoers:`/etc/sudoers.d/${p.siteId}-protected-deploy`};
}
function replaceOnce(text,from,to){if(text.split(from).length!==2)fail('Een beschermde productietemplate wijkt af; herbeoordeling vereist.');return text.replace(from,to);}
function validateMetadata(p,accounts,configIds){
 const names=[p.runnerUser,p.buildUser,p.appUser];
 if(!accounts||typeof accounts!=='object'||Array.isArray(accounts)||Object.keys(accounts).length!==3||!names.every(name=>Object.hasOwn(accounts,name)))fail('Geef exact de drie werkelijk geverifieerde productie-UID/GID-paren.');
 for(const value of Object.values(accounts))if(!value||Object.keys(value).length!==2||!['uid','gid'].every(key=>Object.hasOwn(value,key)&&Number.isSafeInteger(value[key])&&value[key]>0))fail('Productieaccountidentiteiten ontbreken of zijn ongeldig.');
 if(new Set(Object.values(accounts).map(value=>value.uid)).size!==3||new Set(Object.values(accounts).map(value=>value.gid)).size!==3)fail('Productieaccounts vereisen afzonderlijke UID’s en primaire groepen.');
 if(!Array.isArray(configIds)||!configIds.length||configIds.length>1000||new Set(configIds).size!==configIds.length||configIds.some(value=>typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value))||!configIds.includes(p.configVersion))fail('Geef bestaande veilige configuratie-ID’s, inclusief de bevestigde profielversie.');
}
export async function renderProtectedProductionBundle(profile,{accounts,configIds,sourceRoot=root}={}){
 const p=validateProductionProfile(profile);validateMetadata(p,accounts,configIds);const paths=protectedProductionPaths(p),native=await renderProductionBundle(p,{sourceRoot}),templates={};
 for(const [name,pin] of Object.entries(PROTECTED_PRODUCTION_TEMPLATE_PINS)){const bytes=await readFile(resolve(sourceRoot,name));if(sha256(bytes)!==pin)fail('Een beschermde native brontemplate is niet de beoordeelde versie.');templates[name]=bytes.toString('utf8');}
 // Reuse the reviewed native implementation, but replace only its generated
 // legacy mail-policy block. The protected bundle cannot carry a delivery mode;
 // encrypted beheer settings make that choice after first infrastructure boot.
 let legacy=native.files['deploy-helper.py'].content;
 const start="    require(values.get('MAIL_ENVIRONMENT') == 'production' and values.get('MAIL_MODE') == "+JSON.stringify(p.mailMode)+", 'Wrong production mail policy')\n";
 const end="    return {key: values[key] for key in RUNTIME_KEYS if values.get(key, '') != ''}";
 const begin=legacy.indexOf(start),finish=legacy.indexOf(end,begin);
 if(begin<0||finish<0||legacy.lastIndexOf(start)!==begin||!legacy.slice(begin,finish).endsWith("'Invalid approved mail recipients')\n"))fail('De gegenereerde legacy-mailpolicy is niet exact herkenbaar.');
 legacy=legacy.slice(0,begin)+"    require(values.get('MAIL_ENVIRONMENT') == 'production' and not any(key in values for key in ['MAIL_MODE', 'MAIL_ALLOWED_RECIPIENTS', 'SEND_EMAIL_HOOK_SECRET']), 'Protected production delivery policy belongs to encrypted beheer settings')\n"+legacy.slice(finish);
 const legacyHash=sha256(legacy),bindings=new Map([
  ['/usr/local/libexec/dg-milobingo-deploy-helper',paths.legacyHelper],['/usr/local/libexec/dg-milo-deploy-helper',paths.helper],
  ['/usr/local/libexec/milo-protected-release-gate.mjs',paths.gate],['/usr/local/libexec/milo-protected-extract-source.py',paths.extractor],['/usr/local/libexec/milo-protected-lock-guardian.py',paths.guardian],
  ['milobingo-staging',p.siteId],['dg-nxttrack-01',p.host],['run-mil-stg',p.runnerUser],['build-mil-stg',p.buildUser],['app-mil-stg',p.appUser],
  ['PORT = 4173','PORT = '+p.port],['dg-milobingo-protected-build-',`dg-${p.siteId}-protected-build-`],['dg-milobingo-protected-lock-',`dg-${p.siteId}-protected-lock-`],
  ["'dg-build'",JSON.stringify(p.buildLockGroup)],["'deploy-staging.yml'","'deploy-production.yml'"],
 ]);
 const pattern=new RegExp([...bindings.keys()].sort((a,b)=>b.length-a.length).map(value=>RegExp.escape(value)).join('|'),'g'),bind=text=>text.replace(pattern,match=>bindings.get(match));
 let broker=bind(templates['infra/protected/deploy-helper.py']);
 broker=replaceOnce(broker,"'legacySha256', 'gateSha256', 'extractorSha256', 'guardianSha256', 'accounts'})","'legacySha256', 'gateSha256', 'extractorSha256', 'guardianSha256', 'accounts', 'productionProfileSha256'})");
 broker=replaceOnce(broker,"    require(value['version'] == 1)","    require(value['version'] == 1 and value['productionProfileSha256'] == "+JSON.stringify(profileDigest(p))+", 'Fixed production profile pin differs')");
 broker=replaceOnce(broker,'    allowed = set(legacy.RUNTIME_KEYS) - set(DERIVED_KEYS)',"    allowed = set(legacy.RUNTIME_KEYS) - set(DERIVED_KEYS) - {'MAIL_ENVIRONMENT', 'MAIL_MODE', 'MAIL_ALLOWED_RECIPIENTS', 'SEND_EMAIL_HOOK_SECRET'}");
 broker=replaceOnce(broker,"'PORT': str(PORT), 'RELEASE_SHA': sha, 'RELEASE_ID': run, 'CONFIG_VERSION': config_id}","'PORT': str(PORT), 'RELEASE_SHA': sha, 'RELEASE_ID': run, 'CONFIG_VERSION': config_id, 'MAIL_ENVIRONMENT': 'production'}");
 broker=replaceOnce(broker,"    runtime['MAIL_ENVIRONMENT'] = 'staging'","    runtime['MAIL_ENVIRONMENT'] = 'production'");
 broker=replaceOnce(broker,'# environment gate keeps staging allowlists mandatory without freezing mode.','# environment gate keeps production bound without freezing the beheer mode.');
 // The installed gate is a self-contained Node module: no pg, repository import
 // or mutable runtime module path is involved when root invokes it.
 const gateSource=resolve(sourceRoot,'scripts/deploy/protected-production-root-gate.mjs');
 const stagingGate=resolve(sourceRoot,'infra/protected/release-gate.mjs'),gateLibrary=replaceOnce(templates['infra/protected/release-gate.mjs'],STAGING_GATE_CLI,'');
 const bundled=await build({stdin:{contents:`import {runInstalledProtectedProductionGate} from ${JSON.stringify(gateSource)};\nawait runInstalledProtectedProductionGate(${JSON.stringify(p)});\n`,resolveDir:sourceRoot,sourcefile:'protected-production-root-entry.mjs'},bundle:true,platform:'node',format:'esm',target:'node24',write:false,metafile:true,logLevel:'silent',plugins:[{name:'reviewed-staging-gate-library-only',setup(builder){builder.onLoad({filter:/release-gate\.mjs$/},args=>args.path===stagingGate?{contents:gateLibrary,loader:'js',resolveDir:dirname(stagingGate)}:undefined);}}]});
 const gate=bundled.outputFiles[0].text;
 const sourcePins={...native.manifest.templatePins,...PROTECTED_PRODUCTION_TEMPLATE_PINS};for(const name of ['scripts/deploy/production-render.mjs','scripts/deploy/protected-production-render.mjs','infra/protected/deploy-production.yml.template',...Object.keys(bundled.metafile.inputs)]){const path=resolve(sourceRoot,name);if(name==='protected-production-root-entry.mjs')continue;sourcePins[name]=sha256(await readFile(path));}
 const extractor=templates['infra/protected/extract-source.py'],guardian=bind(templates['infra/protected/lock-guardian.py']),helperHash=sha256(broker);
 const entry=replaceOnce(bind(templates['infra/protected/deploy-entry.py']),'__HELPER_SHA256__',helperHash);
 const policy={version:1,allowedConfigIds:[...configIds],legacySha256:legacyHash,gateSha256:sha256(gate),extractorSha256:sha256(extractor),guardianSha256:sha256(guardian),accounts:structuredClone(accounts),productionProfileSha256:profileDigest(p)};
 const sudoers=`${p.runnerUser} ALL=(root) NOPASSWD:NOSETENV: sha256:${helperHash} ${paths.helper} ^deploy [a-f0-9]{40} [1-9][0-9]*-[1-9][0-9]* [A-Za-z0-9][A-Za-z0-9_.-]*$\n`;
 let workflow=await readFile(resolve(sourceRoot,'infra/protected/deploy-production.yml.template'),'utf8');
 const fields={SITE_ID:p.siteId,APP_URL:p.appUrl,HOST:p.host,RUNNER_USER:p.runnerUser,RUNNER_NAME:p.runnerName,RUNNER_LABELS:JSON.stringify(['self-hosted','Linux','X64',p.host,p.siteId,'production']),ENTRY:paths.entry,CONFIG_ID:p.configVersion};
 workflow=workflow.replace(/__([A-Z_]+)__/g,(_match,name)=>{if(!Object.hasOwn(fields,name))fail('Een beschermde productieworkflowbinding ontbreekt.');return fields[name];});
 const files={
  'legacy-deploy-helper.py':{content:legacy,path:paths.legacyHelper,mode:'0755'},
  'deploy-helper.py':{content:broker,path:paths.helper,mode:'0755'},'deploy-entry.py':{content:entry,path:paths.entry,mode:'0755'},
  'release-gate.mjs':{content:gate,path:paths.gate,mode:'0644'},'extract-source.py':{content:extractor,path:paths.extractor,mode:'0755'},'lock-guardian.py':{content:guardian,path:paths.guardian,mode:'0755'},
  'protected-deploy.json':{content:JSON.stringify(policy,null,2)+'\n',path:paths.policy,mode:'0600'},'deploy.sudoers':{content:sudoers,path:paths.sudoers,mode:'0440'},
  'deploy-profile.json':native.files['deploy-profile.json'],'service.unit':native.files['service.unit'],'site.caddy':native.files['site.caddy'],
  'profile.json':native.files['profile.json'],'deploy-production.yml':{content:workflow,path:'.github/workflows/deploy-production.yml',mode:'0644'},
 };
 return {files,manifest:{format:'milo-protected-production-bootstrap-v1',installed:false,profileDigest:profileDigest(p),profile:p,site:p.siteId,host:p.host,port:p.port,policyComplete:true,credentialsIncluded:false,stagingGateCliRemoved:true,rootAcceptancePath:paths.acceptanceRoot+'/<sha>.json',runtimeBundlePath:paths.configRoot+'/<config_id>/runtime.json',legacyDependency:{path:paths.legacyHelper,sha256:legacyHash},mailPolicy:'encrypted-regie-settings-with-fixed-production-environment',sourcePins,files:Object.fromEntries(Object.entries(files).map(([name,file])=>[name,{destination:file.path,mode:file.mode,sha256:sha256(file.content)}]))}};
}
async function main(){
 const values=Object.fromEntries(process.argv.slice(2).map(value=>{const match=/^--(profile|output|accounts|config-ids)=(.+)$/.exec(value);if(!match)fail('Gebruik --profile, --accounts, --config-ids en --output met beoordeelde publieke metadata.');return [match[1],match[2]];}));
 if(Object.keys(values).length!==4)fail('Vier expliciete renderargumenten zijn verplicht.');
 const profile=await loadProductionProfile(values.profile),accounts=JSON.parse(await readFile(values.accounts,'utf8')),configIds=JSON.parse(await readFile(values['config-ids'],'utf8')),bundle=await renderProtectedProductionBundle(profile,{accounts,configIds}),output=resolve(values.output);
 await mkdir(output,{mode:0o700});for(const [name,file] of Object.entries(bundle.files))await writeFile(resolve(output,name),file.content,{mode:0o600,flag:'wx'});await writeFile(resolve(output,'manifest.json'),JSON.stringify(bundle.manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({rendered:true,installed:false,profileDigest:bundle.manifest.profileDigest,fileCount:Object.keys(bundle.files).length,credentialsIncluded:false}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Beschermde productierender geweigerd: volledig bevestigd profiel, accountidentiteiten, configuratie-ID’s en nieuwe reviewmap vereist. Geen hostwijziging uitgevoerd.');process.exitCode=1;});
