import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {decodePostgresCa} from '../server/node-postgres-tls.js';

// Validate names/presence and formats only. Never print configuration values.
const options=Object.fromEntries(process.argv.slice(2).map(argument=>{
  const match=/^--(phase|profile|env-file)=(.+)$/.exec(argument);
  if(!match)throw new Error('Gebruik --phase=build|runtime, --profile=local|supabase en/of --env-file=pad.');
  return [match[1],match[2]];
}));
const phase=options.phase||'build';
if(!['build','runtime'].includes(phase))throw new Error('Onbekende configuratiefase.');
for(const file of options['env-file']?[options['env-file']]:['.env.local','.env']){
  const path=resolve(file);
  if(existsSync(path))process.loadEnvFile(path);
  else if(options['env-file'])throw new Error('Het opgegeven configuratiebestand ontbreekt.');
}

const environment=process.env;
const has=name=>!!environment[name]?.trim();
const remoteNames=['SUPABASE_URL','SUPABASE_DB_CA_BASE64','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_STORAGE_BUCKET','DATABASE_URL'];
const providerNames=['OPENAI_API_KEY','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'];
const profile=options.profile||(remoteNames.some(has)?'supabase':'local');
if(!['local','supabase'].includes(profile))throw new Error('Onbekend configuratieprofiel.');
const errors=[];
const requireNames=names=>{
  for(const name of names)if(!has(name))errors.push(`${name}: ontbreekt.`);
};
const isLoopback=hostname=>['localhost','127.0.0.1','[::1]','::1'].includes(hostname);

for(const name of Object.keys(environment)){
  // This release deliberately has no browser environment contract.
  if(name.startsWith('NEXT_PUBLIC_'))errors.push(`${name}: niet opgenomen in de publieke configuratie-allowlist.`);
}
if(has('MILO_LOCAL_AUTH')&&!['true','false'].includes(environment.MILO_LOCAL_AUTH)){
  errors.push('MILO_LOCAL_AUTH: gebruik true of false.');
}
if(has('VLAMPIE_SETTINGS_KEY')&&!/^[a-f0-9]{64}$/i.test(environment.VLAMPIE_SETTINGS_KEY)){
  errors.push('VLAMPIE_SETTINGS_KEY: verwacht 64 hextekens.');
}
if(has('PORT')&&(!/^\d+$/.test(environment.PORT)||Number(environment.PORT)<1||Number(environment.PORT)>65535)){
  errors.push('PORT: verwacht een poort tussen 1 en 65535.');
}
if(has('RELEASE_SHA')&&!/^[a-f0-9]{40}$/i.test(environment.RELEASE_SHA)){
  errors.push('RELEASE_SHA: verwacht een volledige broncommit van 40 hextekens.');
}

let appUrl;
if(has('APP_URL')){
  try{
    appUrl=new URL(environment.APP_URL);
    if(!['http:','https:'].includes(appUrl.protocol)||appUrl.username||appUrl.password||appUrl.search||appUrl.hash||appUrl.pathname!=='/')throw new Error();
    if(appUrl.protocol!=='https:'&&(!isLoopback(appUrl.hostname)||environment.NODE_ENV==='production'))throw new Error();
  }catch{
    errors.push('APP_URL: verwacht een canonieke HTTPS-origin; HTTP-loopback alleen in development.');
  }
}
if(has('SUPABASE_URL')){
  try{
    const url=new URL(environment.SUPABASE_URL);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.protocol!=='https:'&&(!isLoopback(url.hostname)||environment.NODE_ENV==='production'))throw new Error();
  }catch{
    errors.push('SUPABASE_URL: verwacht een HTTPS-projectorigin; HTTP-loopback alleen in development.');
  }
}
if(has('SUPABASE_PUBLISHABLE_KEY')&&!environment.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')){
  errors.push('SUPABASE_PUBLISHABLE_KEY: verwacht een publishable key van het gekozen project.');
}
if(has('SUPABASE_SECRET_KEY')&&!environment.SUPABASE_SECRET_KEY.startsWith('sb_secret_')){
  errors.push('SUPABASE_SECRET_KEY: verwacht een server-only secret key van het gekozen project.');
}
if(has('DATABASE_URL')){
  try{
    const url=new URL(environment.DATABASE_URL);
    if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.password||url.pathname==='/')throw new Error();
  }catch{
    errors.push('DATABASE_URL: verwacht een volledige PostgreSQL-verbindingsstring.');
  }
}
if(has('SUPABASE_DB_CA_BASE64')){
  try{decodePostgresCa(environment.SUPABASE_DB_CA_BASE64);}
  catch{errors.push('SUPABASE_DB_CA_BASE64: verwacht geldige, actuele publieke CA-certificaten als base64-PEM.');}
}

if(environment.MILO_LOCAL_AUTH==='true'){
  if(environment.NODE_ENV==='production')errors.push('MILO_LOCAL_AUTH: niet toegestaan in productie-runtime.');
  if([...remoteNames,...providerNames].some(has))errors.push('MILO_LOCAL_AUTH: niet combineren met remote projectconfiguratie.');
  if(appUrl&&!isLoopback(appUrl.hostname))errors.push('APP_URL: lokale login vereist loopback.');
}
if(profile==='local'&&remoteNames.some(has))errors.push('Lokaal profiel: remote projectconfiguratie aangetroffen.');
if(phase==='runtime'&&profile==='supabase'){
  requireNames(['APP_URL','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','DATABASE_URL']);
  if(has('SUPABASE_SECRET_KEY')&&!has('SUPABASE_STORAGE_BUCKET'))errors.push('SUPABASE_STORAGE_BUCKET: vereist bij remote private Storage.');
  if(has('SUPABASE_STORAGE_BUCKET'))requireNames(['SUPABASE_SECRET_KEY']);
  if(has('DATABASE_URL')){
    try{
      const host=new URL(environment.DATABASE_URL).hostname;
      if(host.endsWith('.supabase.co')||host.endsWith('.pooler.supabase.com'))requireNames(['SUPABASE_DB_CA_BASE64']);
    }catch{ /* DATABASE_URL format errors are reported above. */ }
  }
}
if(phase==='runtime'&&['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'].some(has)){
  requireNames(['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET']);
  if(has('LIVEKIT_URL')){
    try{
      const url=new URL(environment.LIVEKIT_URL);
      if(url.protocol!=='wss:'||!url.hostname.endsWith('.livekit.cloud')||url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error();
    }catch{errors.push('LIVEKIT_URL: verwacht een wss:// LiveKit Cloud-projectorigin.');}
  }
}

if(errors.length){
  console.error(`Configuratie ongeldig (${phase}, ${profile}):\n${errors.map(error=>`- ${error}`).join('\n')}`);
  process.exitCode=1;
}else{
  console.log(`Configuratienamen en formaten akkoord (${phase}, ${profile}). Waarden zijn niet getoond; verbindingen zijn niet getest.`);
}
