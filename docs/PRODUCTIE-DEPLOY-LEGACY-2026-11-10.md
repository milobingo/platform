> Historisch archief van de documentatie vóór de beschermde deployroute van 11 november 2026. Dit document beschrijft de eerdere werkwijze en eerdere waarnemingen; het is geen actuele installatie- of acceptatiestatus. Gebruik [PRODUCTIE-DEPLOY.md](PRODUCTIE-DEPLOY.md) voor de huidige procedure en [BESCHERMDE-CONFIGURATIE.md](BESCHERMDE-CONFIGURATIE.md) voor de migratiestatus.

# Milo productie: voorbereid uitrolpad

Productie-uitrol is op 6 november 2026 expliciet gevraagd. De bestemming is nog niet bevestigd: productie-URL, host/site, afzonderlijke runner/accounts/poort en Supabase-productieproject ontbreken. Er is daarom niets op productie geïnstalleerd of uitgerold. Het bestaande GitHub-environment `production` bevat nog geen complete configuratie. Staging blijft een afzonderlijke omgeving.

Dit pad levert een controleerbaar doelprofiel, native bootstrapbestanden, een workflowtemplate en releasecontroles. Het lege [voorbeeldprofiel](../infra/production/profile.example.json) kan niet worden geactiveerd. Er staat bewust nog geen actieve productie-workflow in `.github/workflows/`.

## Bevestig de bestemming

Vul de openbare velden uit `infra/production/profile.example.json` in en sla het beoordeelde profiel op als `infra/production/profile.json`. Plaats hierin **geen secrets**. De profielhash wordt later afzonderlijk als beschermde GitHub-variabele vastgelegd.

| Gegeven | Contract |
| --- | --- |
| `siteId`, `appUrl`, `host` | Bevestigde Milo-productiesite, canonieke HTTPS-origin en werkelijke Linux-hostnaam. De staging-site/origin zijn uitgesloten. |
| `runnerName`, `runnerUser`, `workspace` | Afzonderlijk bevestigde runner en account; exacte checkout `/home/<runnerUser>/_work/platform/platform`. |
| `buildUser`, `appUser` | Eigen productieaccounts met gescheiden UID/GID; buildaccount zonder aanvullende groepen. Dit Milo-pad gebruikt ook op een andere host andere namen dan de bestaande stagingaccounts. |
| `buildLockGroup`, `port` | Bevestigde beheergroep voor het gedeelde buildslot en werkelijk gecontroleerde vrije loopbackpoort. Poort `4173` is alleen op de bestaande staginghost uitgesloten; op een andere bevestigde host mag die vrij blijken. |
| `supabaseRef`, `bucket` | Afzonderlijk bestaand of bewust ingericht productieproject en privébucket. Project `lfsdgxcpdyghidzkzzvn` is staging en wordt geweigerd. Maak geen tweede project aan wanneer al een geschikt eigen productieproject bestaat. |
| `configVersion`, `mailMode` | Openbare configuratie-identiteit en bewust gekozen `disabled`, `allowlist` of `live`. Het veilige voorbeeld begint met `disabled`; productiepromotie blijft dan geblokkeerd. |

Versies blijven Node `24.18.0` en pnpm `11.25.0`, op de beoordeelde `/opt`-paden. De renderer leidt site-, release-, build-, runtime-, backup-, service-, entry-, helper- en sudoerspaden uitsluitend uit het gevalideerde Milo-profiel af. Hij wijzigt de geïnstalleerde stagingvoorzieningen niet.

```bash
node scripts/deploy/production-preflight.mjs profile --profile=infra/production/profile.json
node scripts/deploy/production-render.mjs --profile=infra/production/profile.json --output=/tmp/milo-production-review-20261106
```

De uitvoermap moet nieuw zijn. De renderer schrijft alleen lokale reviewbestanden met beperkte rechten en `installed: false`; hij voert geen sudo, accountaanmaak, installatie, databasewijziging of netwerkdeploy uit.

## Beoordeelde native bootstrap

De renderer controleert vaste hashes van de bestaande beoordeelde stagingtemplates en leidt daar een **afzonderlijke productie-implementatie** uit af. Onverwachte templatewijzigingen stoppen de render. Het manifest bevat bron-/uitvoerhashes, exacte bestemmingen en vereiste installatierechten. De gegenereerde entry pint de helperhash en accepteert alleen vier vaste site-/checkout-/SHA-/runargumenten. De helper herhaalt werkelijke host-, sudo-caller-, account-, pad-, runtime- en poortcontroles.

Een bevoegde beheerder controleert eerst bestaande hosts, services, poorten, directories en andere sites. Behoud hun gegevens; neem geen niet-lege onbekende site over en vervang geen centrale of stagingwrapper. Richt daarna uitsluitend de bevestigde productiepaden in:

- siteroot en `releases`: root met de appgroep, `0750`; `shared` als bewust app-schrijfpad;
- buildroot: root met de eigen buildgroep, `0710`;
- runtime-envdirectory: root `0700`; release-envbestanden root `0600`;
- backupdirectory buiten `shared`: productie-runner `0700`, onder root-beheerde ouderdirectories;
- vaste Node/pnpm-toolchains met gecontroleerde distributiehashes en root-beheerde paden;
- entry/helper root `0755`, rootprofiel `0600`, unit/Caddyfragment `0644`, sudoers `0440`, overeenkomstig `manifest.json`.

Installeer elk bestand pas na bron-/manifestreview op zijn exacte manifestbestemming. Gebruik `visudo -cf` en positieve/negatieve sudo-policyproeven. De sudoersregel bevat een helperdigest, vaste site/checkout en begrensde argumentregex; geen algemene shell of systemctl-bevoegdheid. Controleer de volledige Caddyconfiguratie en unit vóór reload. Het root-only deployprofiel blijft onleesbaar voor de runner: de preflight controleert daarvan alleen veilige metadata; de gepinde roothelper leest en valideert inhoud en poort zelf.

Caddy overschrijft `Host`, `X-Forwarded-Host` en `X-Forwarded-Proto` met het vaste productiecontract. De app bindt alleen `127.0.0.1`. De Node-adapter canoniseert uitsluitend een exact passende interne listener naar de vooraf ingestelde HTTPS-`APP_URL`; oorspronkelijke Origin-/Sec-Fetch-controles blijven gelden. Repositorycode en native builds draaien nooit als root. Build/install krijgen geen runtime-, database-, mail-, backup- of GitHub-credentials.

Kopieer na review de gegenereerde openbare profiel-/workflow-/provisioningbron naar de manifestpaden in de repository en commit ze samen. De workflow is dan targetgebonden; de productiejob gebruikt de exacte host/site/productie-runnerlabels. Neem de gerenderde entryhash over in `DG_DEPLOY_WRAPPER_SHA256` en de profielhash in `DG_PRODUCTION_PROFILE_SHA256`. Installatie of een lokale test is nog geen werkelijk productie-uitrolbewijs.

## Verplichte stagingacceptatie voor dezelfde bron

Voor promotie zijn alle volgende bewijzen verplicht:

1. De volledige bron-SHA behoort tot de eigen `main`-historie en de laatste eigen CI plus `verify`-job voor precies die SHA zijn geslaagd.
2. De opgegeven eigen stagingworkflow is volledig geslaagd voor die SHA, inclusief `release-gate`, `deploy` en `verify-public`. De actuele publieke staginghealth moet de exacte SHA en `<stagingRunId>-<poging>` bevestigen.
3. Beschermde productionenvironmentvariabele `DG_STAGING_ACCEPTANCE_JSON` bevat het werkelijke acceptatierecord voor precies die bron en stagingworkflowpoging. Alle vijf controles moeten `passed` zijn: gezin/login, regieautorisatie, bestellen/PDF, DG-mailgateway en showaudio/live bellen. `pending`, `disabled`, ontbrekende controles of uitzonderingen geven geen promotie.

Gebruik het onderstaande schema pas nadat de echte controles zijn uitgevoerd. `observedAt` is de werkelijke UTC-testdatum, niet een toekomstige planning. Wanneer GitHub een start-/updated-datum meldt, mag het record niet ouder zijn dan die stagingworkflowpoging. Bewijsreferenties bevatten uitsluitend veilige rapportpaden of eigen GitHub Actions-run/artifactlinks, zonder tokens, namen van kinderen, mailboxinhoud of credentials.

```json
{
  "format": 1,
  "releaseSha": "VOLLEDIGE_DAARWERKELIJK_GETESTE_SHA",
  "stagingRunId": 0,
  "stagingReleaseId": "ECHTE_RUN-POGING",
  "observedAt": "ECHTE_UTC_TESTDATUM",
  "checks": {
    "familyAuth": {"status": "pending", "evidence": "verification/staging-family-auth.json"},
    "regieAuthorization": {"status": "pending", "evidence": "verification/staging-regie-auth.json"},
    "ordersAndPdf": {"status": "pending", "evidence": "verification/staging-orders-pdf.json"},
    "mailGateway": {"status": "pending", "evidence": "verification/staging-mail-gateway.json"},
    "showAudioAndLiveCall": {"status": "pending", "evidence": "verification/staging-live-audio.json"}
  }
}
```

Dit voorbeeld wordt geweigerd. Een beheerder registreert geslaagde werkelijke proeven; een workflow mag dit record niet automatisch invullen op basis van CI, mocks, demo's of HTTP-health. Het record verleent geen nieuwe productiepermissie: die opdracht bestaat al. Het levert het nog ontbrekende feitelijke aansluitbewijs. De huidige lokale whisper-/WebSocket-/mailstubs en publieke demotests bewijzen geen echte provider-, account-, mail- of tweerapparatenrepetitie.

## GitHub-variabelen en secrets

Gebruik uitsluitend environment `production`; geen stagingwaarden lenen. De publieke profielhash en bron-SHA binden alle stappen aan dezelfde beoordeelde bestemming.

| Plaats | Namen |
| --- | --- |
| Beschermde releasevariabelen | `DG_PRODUCTION_PROFILE_SHA256`, `DG_DEPLOY_WRAPPER_SHA256`, `DG_STAGING_ACCEPTANCE_JSON` |
| Openbare serverruntimevariabelen | `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_DB_CA_BASE64`, `OPENAI_TEXT_MODEL`, `OPENAI_SPEECH_MODEL`, `LIVEKIT_URL`, `MAIL_MODE`, `MAIL_ALLOWED_RECIPIENTS` |
| Serverruntimesecrets | `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `VLAMPIE_SETTINGS_KEY`, `OPENAI_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `SEND_EMAIL_HOOK_SECRET` |
| Afzonderlijk databasebeheer | `MIGRATION_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, tijdelijk `RESTORE_TEST_DATABASE_URL`; backupdirectory volgt het profiel |

De volledige productieversie vereist vóór activatie een centrale `OPENAI_API_KEY` en alle drie `LIVEKIT_*`-waarden. Ontbrekende velden blokkeren zowel de Node-preflight als de native helper; deze aanwezigheidscontrole bewijst geen werkelijke provider- of modeltoegang.

De wrapper laat exact de bestaande 21 runtimevelden plus `MAIL_ENVIRONMENT`, `MAIL_MODE`, `MAIL_ALLOWED_RECIPIENTS` en `SEND_EMAIL_HOOK_SECRET` toe. Productie forceert `MAIL_ENVIRONMENT=production`, het profiel forceert de mailmodus. `CONFIG_VERSION`, `PORT`, lokale-loginblokkade en release-identiteit worden uit profiel/workflow afgeleid. Migratie-, herstel-, backup-, GitHub- en overige procescredentials gaan niet naar wrapper, build of app.

`SEND_EMAIL_HOOK_SECRET` is uitsluitend het signingsecret van de eigen DG-gateway, geen Resend/SendGrid-key. De adapter gebruikt de eigen `/functions/v1/send-email-hook`-route en bewaart eerlijke verzendstatus. Gateway-idempotentie-/reconciliatie-/retentieafspraken ontbreken nog voor Milo; de huidige veilige herhaaltermijn is daarom nul. Echte mailacceptatie vereist dat contract en de ingestelde afzender/ontvangerroute. De geïnstalleerde **stagingwrapper versie 1** accepteert deze vier extra mailvelden nog niet; stagingmail blijft uit totdat een afzonderlijk beoordeelde bootstrapupgrade en gatewaykoppeling zijn uitgevoerd. Deze productierender wijzigt staging niet.

## Eenmalige database- en accountbootstrap

Voer een readonly-inventarisatie uit op het **bevestigde productieproject**, met zijn eigen CA en beheerverbinding. Gebruik de generieke `scripts/deploy/database.mjs` met de expliciete productieprojectref; de gewone productiedeploy past geen SQL toe. De oude bronmigratie blijft onveranderd en kan naast de gekozen bucket de historische privébucket `milo-private` aanmaken.

Vóór iedere toegestane schemawijziging blijven de volledige versleutelde snapshotdump, bijbehorende versleutelde extensie-/securitymetadata en een werkelijke afzonderlijke lege hersteltest met overeenkomende gegevens en eigenaarschap/ACL/RLS verplicht. De herstelserver moet de echte bronmajor, extensies en locale ondersteunen. Meet ruimte op backup- én werkelijk herstelvolume. Veiligstellen buiten de host, sleutelherstel, dry-run/mapping voor bestaande data en het afzonderlijke rollbackplan volgen [STAGING-DATABASE.md](STAGING-DATABASE.md), met alle doelwaarden vervangen door het beoordeelde productieprofiel. Gebruik nooit staging of een andere app als scratchdoel. Onbeheerde bestaande applicatietabellen blokkeren bootstrap; niets resetten of stilzwijgend adopteren.

Een afzonderlijke beoordeelde handmatige bootstrapjob op de bevestigde productierunner voert eerst de releasegate uit en krijgt alleen de benodigde productiebeheer-/backup-/herstelconfiguratie. CLI-voorbeelden bevatten bewust geen secretwaarden:

```bash
node scripts/deploy/database.mjs --expected-project-ref=BEVESTIGDE_PRODUCTIEREF
node scripts/deploy/database.mjs --expected-project-ref=BEVESTIGDE_PRODUCTIEREF --apply --reviewed-manifest-sha256=BEVESTIGDE_MANIFEST_SHA256
node scripts/deploy/production-provision-runtime.generated.mjs --backup-id=ECHTE_IDENTITEIT_UIT_GESLAAGD_HERSTELBEWIJS
```

De renderer levert de laatste, targetgebonden provisioningbron voor review en commit. Hij behoudt het bestaande gecontroleerde algoritme: recent bewijs van dezelfde release/ref/backup, advisory lock, gecontroleerde historie, uitsluitend ontbrekende beperkte login, SCRAM-verifier, herstelbare `0600`-overdracht vóór commit en onafhankelijke echte TLS-/rol-/tabelcontrole erna. Host, runnernaam, werkelijke runnergebruikersnaam en checkout blijven vast; de toevallige staging-UID `1001` wordt vervangen door een expliciete niet-rootcontrole. De private bewijsbestanden moeten nog steeds aan de werkelijke runner-UID toebehoren.

De afgeleide productierol heeft alleen `milo_backend` en database-CONNECT, geen superuser/rol-/databasebeheer, replicatie of RLS-bypass. `app_user_roles` blijft alleen leesbaar. Gebruik de staging-provisioningworkflow nooit op productie. Bestaande accounts of een gedeeltelijke commit mogen niet door een nieuwe login of wachtwoordreset worden overschreven. Bij gedeeltelijke provisioning blijft de private overdracht behouden voor gecontroleerde onafhankelijke verificatie; publiceer hem niet alleen omdat het bestand bestaat.

Pas na geslaagde provisioning en onafhankelijke verificatie wordt de beperkte productie-URL via de bevoegde afgebakende secret-writeprocedure als `DATABASE_URL` geplaatst. De beheerverbinding blijft `MIGRATION_DATABASE_URL`. Waarden lopen via stdin/private overdracht, niet via chat, logs, Git, artifacts of procesargumenten. Ruim daarna bootstrapduplicaten, scratchdata/tunnel/secret en tijdelijke beheertoegang op; behoud actieve envs, versleutelde backups en de afzonderlijke veilige sleutelherstelroute.

## Gewone productierelease en herstel

Na complete hostinrichting, databasebootstrap, eigen Auth-redirects/SMTP/Google-inrichting, gatewayconfiguratie en alle echte stagingacceptatie kiest de beheerder **Deploy Milo production → Run workflow** op `main`. Vul de volledige `release_sha` en de exact bijbehorende `staging_run_id` in. De workflow heeft geen automatische migratie- of betaalactie.

De productiedeploy controleert host/caller/checkout, rootwrapper-/helperhash, capaciteit en runtimeconfiguratie; herhaalt daarna CI/staging/acceptatie, auditt het eigen schema/historie uitsluitend readonly en controleert de beperkte appverbinding. De vaste native helper bouwt geïsoleerd, koppelt app en private configuratie atomair via `current` en bewaart bekende releases. De publieke nacontrole controleert exacte SHA/run/configuratie, appchunks/assets, anonieme sessie en afwijzing van vreemde origin, vervalste identiteit en lokale login.

Een mislukte nieuwe activatie herstelt alleen een vooraf gezond bevonden vorige app met diens eigen envbestand. Bewust appherstel gebruikt eveneens bekende compatibele bron en het beoordeelde native pad. Dit draait database, orders, kaarten, Auth, Storage, gateway of providers niet terug. Bewaar het vooraf afgesproken afzonderlijke database-/dataherstelplan en voer nooit een automatische bronreset uit.

Leg bron-, CI-, staging-, acceptatie-, database-/herstel-, provisioning- en productieruns, profiel-/wrapper-/artifacthashes, actieve procesidentiteit, loopbackbinding en publieke controles vast. Controleer vervolgens echte productieaccounts, mailroute en audio met de afgesproken accounts/apparaten voordat een volledig werkende productiekoppeling wordt geclaimd. Geen echte testmail, betaalopdracht of betaalde providerrepetitie wordt door dit scaffold gestart.

## Lokale verificatie van het scaffold

```bash
node --test tests/check-production-deploy.mjs
```

De tests gebruiken expliciete `.example`-/`.test`-fixtures, geïnjecteerde GitHub/HTTP-antwoorden en een werkelijk geladen lokale Python-helper plus `visudo -cf`. Ze controleren doelisolatie, source-/helperpins, mailpolicy, credentialstripping, complete releasegebonden acceptatie, publieke grenzen en weigering bij een leeg profiel. Ze voeren geen sudo, systemd-, host-, database- of providerwijzigingen uit en vormen geen productie- of echte stagingacceptatie.

Ubuntu 26.04 gebruikt standaard sudo-rs. De test kiest alleen een parser die een echte digest-/argumentregel accepteert én een ongeldige digest weigert: de ondersteunde C-variant `visudo.ws`, of de klassieke `visudo`. CI installeert zo nodig uitsluitend het officiële pakket `sudo`, legt parser-/imageversies vast en wijzigt de standaard-sudo niet. De volledige gegenereerde sudoersregel blijft verplicht gevalideerd. Zie [Ubuntu 26.04-release-informatie](https://documentation.ubuntu.com/release-notes/26.04/summary-for-lts-users/) en [de pakketbestanden](https://packages.ubuntu.com/resolute/amd64/sudo/filelist).
