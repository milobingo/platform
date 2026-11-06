import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export const PRODUCTION_KEYS=Object.freeze(['version','environment','repository','branch','siteId','appUrl','host','runnerName','runnerUser','buildUser','appUser','buildLockGroup','workspace','port','supabaseRef','bucket','configVersion','mailMode']);
export const MAIL_RUNTIME_KEYS=Object.freeze(['MAIL_ENVIRONMENT','MAIL_MODE','MAIL_ALLOWED_RECIPIENTS','SEND_EMAIL_HOOK_SECRET']);
export const fail=message=>{throw new Error(message);};
export const sha256=value=>createHash('sha256').update(value).digest('hex');
const staging={site:'milobingo-staging',url:'https://milo-staging.dgwebservices.nl',ref:'lfsdgxcpdyghidzkzzvn',runner:'dg-nxttrack-01-nxttrack-staging',users:['run-mil-stg','build-mil-stg','app-mil-stg']};
export function validateProductionProfile(input){
 if(!input||Array.isArray(input)||Object.keys(input).length!==PRODUCTION_KEYS.length||Object.keys(input).some(key=>!PRODUCTION_KEYS.includes(key)))fail('Productieprofiel heeft ontbrekende of onbekende velden; plaats geen secrets in het profiel.');
 const p={...input};
 if(p.version!==1||p.environment!=='production'||p.repository!=='milobingo/platform'||p.branch!=='main')fail('Productieprofiel vereist het vaste Milo-repositorycontract.');
 if(!/^milobingo(?:-[a-z0-9]+){0,4}$/.test(p.siteId||'')||p.siteId.length>48||p.siteId===staging.site)fail('Bevestig een afzonderlijke Milo-productiesite.');
 let url;try{url=new URL(p.appUrl);}catch{fail('Bevestig de echte HTTPS-productieorigin.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||url.origin!==p.appUrl||!/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(url.hostname)||url.hostname.endsWith('.localhost')||url.hostname.endsWith('.local')||url.origin===staging.url)fail('Productieorigin moet een afzonderlijke canonieke HTTPS-host zijn.');
 if(!/^[a-z0-9](?:[a-z0-9.-]{0,98}[a-z0-9])?$/.test(p.host||''))fail('Bevestig de echte productiehostnaam.');
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(p.runnerName||'')||p.runnerName===staging.runner)fail('Productie vereist een afzonderlijk bevestigde runnernaam.');
 const users=[p.runnerUser,p.buildUser,p.appUser];
 if(users.some(user=>!/[a-z]/.test(user||'')||!/^[a-z][a-z0-9-]{2,30}$/.test(user)||['root','nobody',...staging.users].includes(user))||new Set(users).size!==3)fail('Runner, build en app vereisen afzonderlijke productieaccounts.');
 if(!/^[a-z][a-z0-9-]{2,30}$/.test(p.buildLockGroup||''))fail('Bevestig de beheerdergroep voor het gedeelde buildslot.');
 if(p.workspace!==`/home/${p.runnerUser}/_work/platform/platform`)fail('Checkoutpad moet exact bij het bevestigde productie-runneraccount horen.');
 if(!Number.isInteger(p.port)||p.port<1024||p.port>65535||p.host==='dg-nxttrack-01'&&p.port===4173)fail('Bevestig een vrije productiepoort; 4173 is op de bestaande staginghost al bezet.');
 if(!/^[a-z]{20}$/.test(p.supabaseRef||'')||p.supabaseRef===staging.ref)fail('Bevestig een afzonderlijk Supabase-productieproject; staginghergebruik is verboden.');
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(p.bucket||''))fail('Bevestig de private productiebucket.');
 if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(p.configVersion||''))fail('Bevestig de productieconfiguratieversie.');
 if(!['disabled','allowlist','live'].includes(p.mailMode))fail('Kies bewust disabled, allowlist of live als productiemailmodus.');
 return Object.freeze(p);
}
export function productionPaths(profile){
 const p=validateProductionProfile(profile),site=p.siteId;
 return Object.freeze({siteRoot:`/srv/sites/${site}`,buildRoot:`/var/lib/dg-build/${site}`,runtimeRoot:`/etc/dg-sites/${site}.runtime.d`,deployProfile:`/etc/dg-sites/${site}.deploy.json`,backupDirectory:`/var/backups/${site}`,service:`${site}.service`,entry:`/usr/local/bin/dg-site-deploy-${site}`,helper:`/usr/local/libexec/dg-${site}-deploy-helper`,sudoers:`/etc/sudoers.d/${site}-deploy`,node:'/opt/node-v24.18.0-linux-x64/bin/node',pnpm:'/opt/dg-toolchains/pnpm/11.25.0/bin/pnpm',runtimeRole:site.replaceAll('-','_')+'_runtime'});
}
export async function loadProductionProfile(path='infra/production/profile.json'){
 let data;try{data=JSON.parse(await readFile(path,'utf8'));}catch{fail('Bevestigd productieprofiel ontbreekt of is ongeldig; er is niets uitgerold.');}
 return validateProductionProfile(data);
}
export const profileDigest=profile=>sha256(JSON.stringify(PRODUCTION_KEYS.map(key=>[key,validateProductionProfile(profile)[key]])));
export function requireProfilePin(profile,expected){if(!/^[a-f0-9]{64}$/.test(expected||'')||profileDigest(profile)!==expected)fail('DG_PRODUCTION_PROFILE_SHA256 ontbreekt of wijkt af van het beoordeelde doelprofiel.');return true;}
