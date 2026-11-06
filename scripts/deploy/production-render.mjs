import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadProductionProfile,validateProductionProfile,productionPaths,profileDigest,MAIL_RUNTIME_KEYS,sha256,fail} from './production-profile.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const TEMPLATE_PINS=Object.freeze({
 'infra/staging/deploy-entry.py':'542e34c26019eeea787120bfa2e6182e66102539d488de020cfdfd6dd17893f5',
 'infra/staging/deploy-helper.py':'ce93bfeffa573616394d1f28dc5dd101bc7e0ce076b7bf25b35a38827ed9aba8',
 'infra/staging/milobingo-staging.service.example':'bf87320ca8c307bf69fdd9d97511f0129348d050edd516bd38efc6ad37333402',
 'infra/staging/Caddyfile.example':'5768de11ddfa25d7bf72052fc3099d283d0a0676903caf0405d3b7ab8b10918e',
 'scripts/deploy/provision-runtime.mjs':'44ef6ead26075d7d93ec1dc19a1e90fef56ce21e8e67ed4ff58596170ff6c4c9',
});
function change(source,from,to){if(!source.includes(from))fail('De beoordeelde native template is gewijzigd; herbeoordeling vereist.');return source.replaceAll(from,to);}
export async function renderProductionBundle(profile,{sourceRoot=root}={}){
 const p=validateProductionProfile(profile),paths=productionPaths(p),templates={};
 for(const [name,digest] of Object.entries(TEMPLATE_PINS)){const data=await readFile(resolve(sourceRoot,name));if(sha256(data)!==digest)fail('Een native brontemplate wijkt af van de beoordeelde versie.');templates[name]=data.toString('utf8');}
 const bindings=new Map([['/usr/local/libexec/dg-milobingo-deploy-helper',paths.helper],['/home/run-mil-stg/_work/platform/platform',p.workspace],['https://milo-staging.dgwebservices.nl',p.appUrl],['milo-staging.dgwebservices.nl',new URL(p.appUrl).hostname],['lfsdgxcpdyghidzkzzvn',p.supabaseRef],['dg-nxttrack-01-nxttrack-staging',p.runnerName],['dg-nxttrack-01',p.host],['milobingo-staging',p.siteId],['milo-staging',p.bucket],['milo_staging_runtime',paths.runtimeRole],['run-mil-stg',p.runnerUser],['build-mil-stg',p.buildUser],['app-mil-stg',p.appUser],['dg-milobingo-build-',`dg-${p.siteId}-build-`],["'dg-build'",JSON.stringify(p.buildLockGroup)]]);
 const escaped=value=>RegExp.escape(value);
 const bindingPattern=new RegExp([...bindings.keys()].sort((a,b)=>b.length-a.length).map(escaped).join('|'),'g');
 // Match only original template bytes. A confirmed target may itself contain
 // another old token; inserted values must never be interpreted as templates.
 const bind=source=>source.replace(bindingPattern,match=>bindings.get(match));
 const extendKeys=source=>change(source,"'RELEASE_SHA', 'RELEASE_ID', 'CONFIG_VERSION')","'RELEASE_SHA', 'RELEASE_ID', 'CONFIG_VERSION', "+MAIL_RUNTIME_KEYS.map(key=>JSON.stringify(key)).join(', ')+')');
 let helper=extendKeys(bind(templates['infra/staging/deploy-helper.py']));
 const rolePolicy=`    runtime_role = ${JSON.stringify(paths.runtimeRole)}\n    database_user = unquote(database.username)\n    require(database.port in [None, 5432] and ((database.hostname == f'db.{ref}.supabase.co' and database_user == runtime_role) or (database.hostname.endswith('.pooler.supabase.com') and database_user == runtime_role + '.' + ref)), 'Wrong limited production database principal or port')\n`;
 helper=change(helper,'    params = parse_qs(database.query, keep_blank_values=True)',rolePolicy+'    params = parse_qs(database.query, keep_blank_values=True)');

 const mail=`    require(all(values.get(key, '').strip() for key in ['OPENAI_API_KEY', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']), 'Missing production AI or live-call credentials')\n    require(values.get('MAIL_ENVIRONMENT') == 'production' and values.get('MAIL_MODE') == ${JSON.stringify(p.mailMode)}, 'Wrong production mail policy')\n    if values.get('MAIL_MODE') != 'disabled':\n        secret = values.get('SEND_EMAIL_HOOK_SECRET', '')\n        if secret.startswith('v1,'): secret = secret[3:]\n        if secret.startswith('whsec_'): secret = secret[6:]\n        decoded = base64.b64decode(secret, validate=True)\n        require(len(decoded) >= 32 and base64.b64encode(decoded).decode() == secret, 'Invalid mail signing secret')\n        if values.get('MAIL_MODE') == 'allowlist':\n            recipients = [value.strip() for value in values.get('MAIL_ALLOWED_RECIPIENTS', '').split(',') if value.strip()]\n            require(1 <= len(recipients) <= 100 and all(len(value) <= 320 and re.fullmatch(r'[^\\s@]+@[^\\s@]+\\.[^\\s@]+', value) for value in recipients), 'Invalid approved mail recipients')\n`;
 helper=change(helper,'    return {key: values[key] for key in RUNTIME_KEYS if values.get(key, \'\') != \'\'}',mail+'    return {key: values[key] for key in RUNTIME_KEYS if values.get(key, \'\') != \'\'}');
 helper=helper.replace('\n',`\n# Bound production profile SHA256: ${profileDigest(p)}\n`);
 const helperDigest=sha256(helper);
 let entry=extendKeys(bind(templates['infra/staging/deploy-entry.py']));entry=change(entry,'__HELPER_SHA256__',helperDigest);
 const unit=bind(templates['infra/staging/milobingo-staging.service.example'].replace('loopbackpoort 4173','loopbackpoort '+p.port).replace('BingoShow staging','BingoShow production'));
 const caddy=bind(templates['infra/staging/Caddyfile.example'].replace('reverse_proxy 127.0.0.1:4173 {','reverse_proxy 127.0.0.1:'+p.port+' {').replace('Poort 4173','Poort '+p.port)).replace('        header_up -oai-authenticated-user-id',`        header_up Host ${new URL(p.appUrl).host}\n        header_up X-Forwarded-Host ${new URL(p.appUrl).host}\n        header_up X-Forwarded-Proto https\n        header_up -oai-authenticated-user-id`);
 let provision=bind(templates['scripts/deploy/provision-runtime.mjs'].replaceAll('stagingproject','productieproject').replaceAll('stagingdatabase','productiedatabase').replaceAll('stagingrunner','productierunner'));provision=change(provision,'process.getuid() !== 1001','process.getuid() === 0');
 const sudoers=`${p.runnerUser} ALL=(root) NOPASSWD:NOSETENV: sha256:${helperDigest} ${paths.helper} ^${p.siteId} ${p.workspace} [a-f0-9]{40} [1-9][0-9]*-[1-9][0-9]*$\n`;
 let workflow=await readFile(resolve(sourceRoot,'infra/production/deploy-production.yml.template'),'utf8');
 const workflowBindings={SITE_ID:p.siteId,APP_URL:p.appUrl,RUNNER_LABELS:JSON.stringify(['self-hosted','Linux','X64',p.host,p.siteId,'production']),HOST:p.host,RUNNER_USER:p.runnerUser,RUNNER_NAME:p.runnerName,WORKSPACE:p.workspace,ENTRY:paths.entry};
 workflow=workflow.replace(/__([A-Z_]+)__/g,(_match,key)=>{if(!Object.hasOwn(workflowBindings,key))fail('Een workflowdoel is niet ingevuld.');return workflowBindings[key];});
 const files={
  'deploy-entry.py':{content:entry,path:paths.entry,mode:'0755'},'deploy-helper.py':{content:helper,path:paths.helper,mode:'0755'},
  'service.unit':{content:unit,path:`/etc/systemd/system/${paths.service}`,mode:'0644'},'site.caddy':{content:caddy,path:`/etc/caddy/sites/${p.siteId}.caddy`,mode:'0644'},
  'deploy.sudoers':{content:sudoers,path:paths.sudoers,mode:'0440'},'deploy-profile.json':{content:JSON.stringify({node:paths.node,pnpm:paths.pnpm,port:p.port},null,2)+'\n',path:paths.deployProfile,mode:'0600'},
  'production-provision-runtime.mjs':{content:provision,path:'scripts/deploy/production-provision-runtime.generated.mjs',mode:'0644'},
  'deploy-production.yml':{content:workflow,path:'.github/workflows/deploy-production.yml',mode:'0644'},
  'profile.json':{content:JSON.stringify(p,null,2)+'\n',path:'infra/production/profile.json',mode:'0644'},
 };
 return {files,manifest:{format:1,kind:'reviewable-production-bootstrap',installed:false,profileDigest:profileDigest(p),templatePins:TEMPLATE_PINS,files:Object.fromEntries(Object.entries(files).map(([name,file])=>[name,{sha256:sha256(file.content),destination:file.path,mode:file.mode}]))}};
}
async function main(){
 const args=process.argv.slice(2);if(args.length!==2||!args[0].startsWith('--profile=')||!args[1].startsWith('--output='))fail('Gebruik production-render.mjs --profile=<bevestigd-openbaar-profiel> --output=<nieuwe-reviewmap>.');
 const bundle=await renderProductionBundle(await loadProductionProfile(args[0].slice(10))),output=resolve(args[1].slice(9));
 await mkdir(output,{mode:0o700});
 for(const [name,file] of Object.entries(bundle.files))await writeFile(resolve(output,name),file.content,{mode:0o600,flag:'wx'});
 await writeFile(resolve(output,'manifest.json'),JSON.stringify(bundle.manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({ok:true,rendered:true,installed:false,profileDigest:bundle.manifest.profileDigest,fileCount:Object.keys(bundle.files).length,credentialsIncluded:false}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Productierender geweigerd: volledig doelprofiel, beoordeelde templates en nieuwe lokale reviewmap vereist. Geen hostwijziging uitgevoerd.');process.exitCode=1;});
