import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const legacyChecks=[
  'check-family-demo','check-family-extras','check-family-brand','check-player-auth','check-bingo','check-live-chat','check-chat-client',
  'check-milo-print','check-characters','check-cast-runner','check-milo-motion','check-milo-life',
  'check-milo-minigame-catalog','check-milo-minigame-server','check-milo-game-clock',
  'check-call-draw-hold','check-live-call-audio','check-live-calls','check-player-live-call',
  'check-regie-workspace','check-regie-panels','check-brand-contract','check-secrets',
  'check-youtube-player','check-startup-recovery','check-gpt-live',
  'check-calls','check-planner-api','check-planner-ui','check-openai','check-production','check-milo-brand-isolation','check-presentation',
  'check-claim-priority','check-family-consolation','check-bingo-orders','check-order-demo',
  'check-workspace-navigation','check-character-navigation','check-administration-ui','check-broadcast-shell','check-show-cue-ui',
  'check-magic-catalog','check-milo-studio-tour','check-milo-leg-render','check-milo-magic-render','check-milo-puppet-render','check-milo-effect-continuity',
  'check-livekit','check-live-call-output','check-live-call-runtime','check-live-call-recovery','check-mail-templates','check-mail-service','check-mail-ui','check-milo-ui','check-showtime','check-director-whisper-runtime','check-director-whisper-ui','check-director-whisper-server','check-live-director-whisper',
];
const checks=[...legacyChecks.map(name=>`scripts/${name}.mjs`),'tests/check-node-storage.mjs','tests/check-node-runtime.mjs','tests/check-node-provider-fetch.mjs','tests/check-node-mail-gateway.mjs','tests/check-node-postgres-tls.mjs','tests/check-deploy-contract.mjs','tests/check-production-deploy.mjs','tests/check-deploy-database.mjs','tests/check-provision-runtime.mjs','tests/check-show-time.mjs','tests/check-game-invariants.mjs','tests/check-game-capacity.mjs','tests/check-family-claim-context.mjs','tests/check-live-feed.mjs','tests/check-live-feed-isolation.mjs','tests/check-v70-schema-upgrade.mjs','tests/check-show-time-audit.mjs','tests/check-account-mail.mjs','tests/check-staging-restore-relay.mjs','tests/check-staging-restore-target.mjs'];
await mkdir('verification/local-testlogs',{recursive:true});
const results=[];
for(const path of checks){
  const name=path.split('/').at(-1).replace(/\.mjs$/,'');
  const started=Date.now();
  const result=spawnSync(process.execPath,[path],{encoding:'utf8',timeout:120000,env:{...process.env,CODEX_PRIMARY_RUNTIME_NODE_MODULES:new URL('../node_modules',import.meta.url).pathname}});
  await writeFile(`verification/local-testlogs/${name}.log`,(result.stdout||'')+(result.stderr||'')+(result.error?.message||''));
  results.push({name,exitCode:result.status,ms:Date.now()-started});
  console.log(`${result.status===0?'✓':'✗'} ${name} (${Date.now()-started} ms)`);
  if(result.status!==0)console.error((result.stdout||'')+(result.stderr||'')+(result.error?.message||''));
}
await writeFile('verification/local-tests.json',JSON.stringify({runtime:process.version,checks:results},null,2)+'\n');
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
