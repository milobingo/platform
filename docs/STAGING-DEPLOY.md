# Milo stagingdeployment

Staging is geautoriseerd voor `https://milo-staging.dgwebservices.nl`, site `milobingo-staging` op `dg-nxttrack-01`. Productie valt buiten deze opdracht. Hostinrichting, volledige databasebackup met werkelijke restore, schema-aanmaak, beperkte runtime-login en backendacceptatie zijn uitgevoerd. De app is actief en de native deployment plus publieke releasecontrole zijn geslaagd. De definitieve actieve bron en laatste workflowuitkomst staan in [STAGING-RESULTAAT.md](STAGING-RESULTAAT.md).

## Bevestigde stand

| Controle | Uitgevoerd resultaat |
| --- | --- |
| Native host en wrapper | Milo-specifieke native wrapper versie 1, beperkte sudoers, appunit en Caddy zijn geïnstalleerd. Node `24.18.0`, pnpm `11.25.0`, PostgreSQL-clients `17.11`; apppoort `127.0.0.1:4173`. |
| Databasebron | `10a9c351fb9c7e501ff9996291518bedb8ed7c8d`, [CI 42072508564](https://github.com/milobingo/platform/actions/runs/42072508564) geslaagd. |
| Databaseapply | [Run 42073060158](https://github.com/milobingo/platform/actions/runs/42073060158) geslaagd: werkelijke volledige restore en gegevens-/securityvergelijking vóór migratie; 18 applicatietabellen, beheerhistorie en `pending: []`. |
| Backup en escrow | [Herstelbewijs](../verification/staging-restore-proof.json) en [offhost-escrowbewijs](../verification/staging-backup-escrow.json) vastgelegd; versleutelde dump, metadatasidecar en sleutelherstelpad buiten de deploymenthost veiliggesteld. |
| Runtime-login | [Run 42073332963](https://github.com/milobingo/platform/actions/runs/42073332963) committeerde de beperkte login; nieuwe poolerauthenticatie stopte op `28P01`. Onafhankelijk direct-routeherstel met hetzelfde wachtwoord is geslaagd, zonder reset of extra rechten. |
| Werkelijke runtime- en beheerverbinding | Beide directe IPv6-projectverbindingen hebben geautoriseerde TLS en hostnaamcontrole doorstaan. De app-login heeft uitsluitend `milo_backend`, geen beheer-/bypassrechten en toegang tot alle 18 tabellen. Beide GitHub-secrets zijn op de juiste directe rolverbinding ingesteld; zie [runtimebewijs](../verification/staging-runtime-verification.json). |
| Backendacceptatie | [CRUD/rollback en negatieve rechtenproeven](../verification/staging-backend-acceptance.json) geslaagd. Privé JSON-object opgeslagen, gelezen, anoniem geweigerd en verwijderd; alle tijdelijke testdata opgeruimd. |
| Publieke browsertests | [8/8 geslaagd](../verification/staging-browser-tests.json) op de werkelijke staging-URL: familie-demo op 320–1280 px, vervalste identiteit geweigerd, lokale regielogin uit en echte aanmeldroute zichtbaar. |
| Scratchcleanup | Tijdelijke herstelserver, tunnel en `RESTORE_TEST_DATABASE_URL` verwijderd na bewijsveiligstelling; zie [cleanupbewijs](../verification/staging-scratch-cleanup.json). |
| Tijdelijke beheertoegang | [Ingetrokken en gecontroleerd](../verification/staging-access-cleanup.json) om 17:41 UTC: beide nieuwe sleutel-logins geweigerd, bootstrapduplicaten en diagnostische logs verwijderd; actieve runtime-envs en versleutelde herstelbestanden behouden. Publieke eindcontrole na intrekking geslaagd. |
| Publiek gecontroleerde apprelease | Bron `985ed0d8aeac3ef7f7b2960d0a03a047e8a1d161`, [CI 42075300318](https://github.com/milobingo/platform/actions/runs/42075300318) en [Deploy 42076441650](https://github.com/milobingo/platform/actions/runs/42076441650) volledig geslaagd. `release-gate`, `deploy` en `verify-public` zijn groen; backendacceptatie is om 17:37 UTC herhaald op deze actieve bron. |
| Werkelijk appherstel | [Handmatige paarsgewijze hersteloefening](../verification/staging-recovery.json) geslaagd: eerdere gezonde release `42075923621-1` plus bijbehorende env geactiveerd, exact health gecontroleerd, laatste `42076441650-1` plus eigen env hersteld en opnieuw exact gezond. |

De [hostcontrole van 5 november, 16:27:48 UTC](../verification/staging-host.json) is een **historische bootstrapinventaris vóór de eerste appactivatie**. De toen gemeten HTTP `502`, ontbrekende `current`, inactieve appunit en lege poort beschrijven niet de huidige appstatus. Het bewijs legt onder meer runner `run-mil-stg` UID 1001, checkout `/home/run-mil-stg/_work/platform/platform`, het afzonderlijke buildaccount UID 990/GID 983 en appaccount UID 996/GID 987 vast.

De eerste hostinspectie vond geen bestaande DG-wrapper, installatiebron of siteregistratie. Deze host gebruikt daarom de nieuwe Milo-implementatie. Het vierargumentencontract, de buildisolatie en automatische rollback staan in [STAGING-NATIVE-WRAPPER.md](STAGING-NATIVE-WRAPPER.md); installatiehashes en rechten staan in [STAGING-HOST.md](STAGING-HOST.md). Een groene CI op een oudere commit keurt nieuwere bron niet goed. Gebruik voor iedere release één volledige main-SHA en wacht op succesvolle eigen CI voor precies die bron.

## Environmentconfiguratie

[GitHub environment staging](https://github.com/milobingo/platform/settings/environments) bevat de benoemde configuratie. Waarden van secrets gaan niet naar documentatie, CLI-argumenten, logs, artifacts of Git.

| Runtimevariabelen | Runtimesecrets |
| --- | --- |
| `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_DB_CA_BASE64` | `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `VLAMPIE_SETTINGS_KEY` |
| `OPENAI_TEXT_MODEL`, `OPENAI_SPEECH_MODEL`, `LIVEKIT_URL` | `OPENAI_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |

Supabase staging blijft project `lfsdgxcpdyghidzkzzvn`, privébucket `milo-staging`. Gebruik dit bestaande project. De geverifieerde databaseverbinding controleert het publieke CA-certificaat en de hostnaam; TLS wordt niet uitgeschakeld.

| Deploymentconfiguratie | Status en grens |
| --- | --- |
| `DG_STAGING_PORT` | Geconfigureerd als `4173`, overeenkomend met het rootprofiel en Caddy. |
| `DG_CONFIG_VERSION` | Geconfigureerd; wordt naar runtime `CONFIG_VERSION` gemapt en in health gecontroleerd. |
| `DG_DEPLOY_WRAPPER_SHA256` | Hash van de geïnstalleerde gerenderde entry; de helperhash is daarin gepind. Zie het installatiebewijs. |
| `MIGRATION_DATABASE_URL` | Afzonderlijke geverifieerde directe beheerverbinding geconfigureerd; uitsluitend voor databasebeheer. |
| `BACKUP_ENCRYPTION_KEY` | Afzonderlijke deployment-only sleutel geconfigureerd; geen app-runtimewaarde. |
| `RESTORE_TEST_DATABASE_URL` | Na de geslaagde volledige herstelproef en scratchcleanup verwijderd. Voor een volgende muterende migratie opnieuw tijdelijk inrichten op een afzonderlijke lege herstelomgeving. |

`DATABASE_BACKUP_DIRECTORY` staat vast op `/var/backups/milobingo-staging`, buiten de app-owned `shared`-map. Controleer capaciteit op zowel backup- als herstelvolume. De appomgeving krijgt geen migratie-, backup-, herstel- of GitHub-credentials.

`DATABASE_URL` is nu de onafhankelijk geverifieerde beperkte login `milo_staging_runtime`; `MIGRATION_DATABASE_URL` bewaart de afzonderlijke beheerlogin. Beide gebruiken de directe projecthost op poort 5432 en actieve CA-/hostnaamcontrole. Het oorspronkelijke poolerprobleem is opgelost door de gecontroleerde routewisseling met dezelfde wachtwoorden. De runtimegate blijft beheerrechten, RLS-bypass en onverwachte rollidmaatschappen weigeren.

## Eenmalige bootstrap: vaste volgorde

Deze eerste bootstrap is uitgevoerd en wordt niet herhaald voor het bestaande runtimeaccount. Onderstaande volgorde beschrijft het gecontroleerde proces; gewone volgende appreleases staan in de volgende sectie. Alle genoemde workflows worden handmatig vanuit `main` gestart. Ze delen concurrencygroep `milobingo-staging`, controleren de eigen exacte groene CI en gebruiken de bevestigde stagingrunner. De bron staat al in `main`; start de volgende stappen pas wanneer de gekozen volledige SHA daadwerkelijk groene CI heeft.

1. **Bevestig bron, CI en herstelserver.** Controleer de volledige 40-teken `release_sha`, beoordeelde migraties en clientmajor. Volg [STAGING-DATABASE.md](STAGING-DATABASE.md) en [STAGING-RESTORE-SCRATCH.md](STAGING-RESTORE-SCRATCH.md). De scratchdatabase is afzonderlijk en mag geen app- of andere sitedatabase zijn. Een readonly-audit mag de staat inventariseren, maar verandert niets. De eenmalige credentialoverdracht is reeds uitgevoerd en is geen normale deployvoorwaarde.
2. **Start `Apply Milo staging database`**, bestand `staging-database-apply.yml`, met die `release_sha`. Deze workflow gebruikt uitsluitend `MIGRATION_DATABASE_URL` als beheerverbinding. Hij berekent de manifesthash van de exacte CI-goedgekeurde bron, maakt vóór schemawijzigingen een versleutelde volledige dump en herstelt die werkelijk in scratch. Gegevenschecksums, eigenaarschap, ACLs, RLS en extensionmetadata moeten overeenkomen. Ontbrekend of afwijkend bewijs stopt vóór de migratie. Bewaar de veilige `backupId`, release-SHA en bewijsmetadata uit de geslaagde uitvoering; geen credentialwaarden.
3. **Start `Provision Milo staging runtime login`**, bestand `staging-runtime.yml`, met **dezelfde `release_sha`** en de exacte `backup_id` uit stap 2. Het herstelbewijs mag maximaal één uur oud zijn en moet aan dezelfde release/migratiehistorie zijn gebonden. De workflow maakt uitsluitend de ontbrekende vaste login `milo_staging_runtime`, geeft de beoordeelde backendrechten en verifieert daarna werkelijk de nieuwe authenticatie, TLS en minimale bevoegdheden. Een bestaande login wordt niet overschreven of automatisch van wachtwoord veranderd.
4. **Laat de bevoegde rootbootstrap de private runtimeoverdracht verwerken.** Pas na geslaagde provisioning en onafhankelijke verificatie van de nieuwe login wordt de gegenereerde URL via de afgebakende secret-writeprocedure als GitHub-stagingsecret `DATABASE_URL` geplaatst. Bij `partial_runtime_provision` moet de bestaande private overdracht eerst onafhankelijk worden onderzocht en de bestaande login geverifieerd; alleen een afzonderlijk vastgelegd, beoordeeld herstel kan publicatie alsnog toestaan. De hierboven vastgelegde directe route is zo met hetzelfde wachtwoord gecontroleerd. De beheerverbinding blijft `MIGRATION_DATABASE_URL`. Consumeer de private `runtime-output.json` zonder waarden te loggen en verwijder hem onmiddellijk na verwerking. Het gewone workflowtoken heeft hiervoor geen secret-writebevoegdheid. Een aanwezig bestand of een gedeeltelijk geslaagde run geeft geen toestemming om de URL te publiceren; bij onzekere commit/nacontrole blijft het bestand voor gecontroleerd herstel behouden en stopt deployment.
5. **Start `Deploy Milo staging`**, bestand `deploy-staging.yml`, met de gekozen volledige `release_sha` en **`apply_database: false`**. De database is in dit eerste bootstraptraject reeds afzonderlijk toegepast en de beperkte runtime-login is nu beschikbaar. Gebruik de gecombineerde apply-optie niet om de voorafgaande gates over te slaan. De deployworkflow controleert opnieuw host/caller/workspace/checkout, wrapperhash, toolchain, configuratie, capaciteit, databasegereedheid en de beperkte appverbinding.
6. **Bevestig de app en publieke nacontrole.** De native wrapper bouwt en activeert de exacte release; de workflow controleert daarna publieke HTTPS, volledige SHA/run/configuratie, demoassets, anonieme autorisatie en uitgeschakelde ontwikkelaanmelding. Een mislukte nacontrole maakt de deployment niet succesvol. Schakel de service pas na geslaagde eerste health voor boot in en voer de afzonderlijke gebruikersacceptatie uit.

Als het herstelbewijs verloopt of bron, schema of historie niet overeenkomen, herstel dan eerst de afzonderlijke gate. Een nieuwe backup of aangepast bootstrapplan wordt expliciet beoordeeld; verwijder geen historie en reset geen omgeving om verschillen te verbergen.

## Volgende gewone stagingrelease

1. Push de wijziging naar `main` en wacht op geslaagde `CI` voor de volledige commit-SHA.
2. Open [Actions: Deploy Milo staging](https://github.com/milobingo/platform/actions/workflows/deploy-staging.yml), kies **Run workflow** op `main`, vul die volledige `release_sha` in en laat **`apply_database` uit** voor een appwijziging zonder nieuwe migratie.
3. Wacht tot `release-gate`, `deploy` en `verify-public` allemaal slagen. Controleer daarna de staging-URL en `/api/health`; de SHA, run-ID en configuratieversie moeten bij de uitvoering horen.

Gewone appreleases gebruiken de ingerichte beperkte runnerbevoegdheid en vereisen geen nieuwe root-SSH-toegang. Een nieuwe schemamigratie vereist vooraf de afzonderlijke beoordeling, tijdelijke herstelserver en backup-/herstelgate; activeer `apply_database` uitsluitend voor die beoordeelde wijziging. De eenmalige runtimeprovisioning wordt niet opnieuw gebruikt voor een bestaand account.

## Native appactivatie

De entry krijgt uitsluitend vier argumenten:

```text
milobingo-staging
/home/run-mil-stg/_work/platform/platform
<volledige release-SHA>
<GitHub run-ID>-<pogingnummer>
```

De roothelper valideert die opnieuw en gebruikt de hostbrede build-lock. Git archiveert de exacte commit als runner. Uitpakken, installatiescripts en native build draaien als `build-mil-stg` in begrensde tijdelijke systemd-units met een lege gecontroleerde omgeving. Repositorycode draait niet als root en ontvangt geen runtimecredentials. Alleen de gecontroleerde standalone-output wordt root-owned verzegeld.

De service gebruikt `current/.next/standalone` als werkmap en start rechtstreeks `/opt/node-v24.18.0-linux-x64/bin/node` met `current/.next/standalone/server.js`. Het pakket bevat `public`, `.next/static`, `drizzle` en getraceerde `pg`/`ws`-dependencies. De runtime staat als root-only bestand buiten de appboom; `EnvironmentFile=/srv/sites/milobingo-staging/current/.runtime.env` volgt de releasegebonden symlink. App en configuratie wisselen daardoor samen via één atomische `current`.

De 21 runtimekeys staan in `scripts/deploy/release-preflight.mjs` en de wrapper. De entry geeft alleen die waarden als begrensde JSON via sudo-stdin door. `GITHUB_TOKEN`, de migratieverbinding, backupkey en scratchverbinding bereiken de helper/build/appomgeving niet. Een normale deployment start geen OTP-mail, betaalde AI-call of echte uitzending.

## Acceptatie, rollback en bewijs

De automatische publieke nacontrole is geslaagd en bewijst appbereikbaarheid, exacte release-identiteit, demoassets, anonieme toegangsgrenzen en uitgeschakelde lokale ontwikkelaanmelding. De afzonderlijke backendacceptatie met werkelijke database- en Storagebewerkingen is op dezelfde actieve bron opnieuw geslaagd. Raadpleeg het resultaatdocument voor de laatste release-identiteit. De volgende controles zijn op dit moment **niet uitgevoerd**: echte OTP-mail en Google-login, bewuste regietoekenning, gezinnen/boekjes/PDF met echte accounts, betaald provider-/modeltoegangsgebruik en de daadwerkelijke bel-/uitzendketen met audio. Voer deze releasegebonden uit volgens [RUNBOOK.md](RUNBOOK.md). Het DG-mailgateway-/outboxcontract blijft afzonderlijk aan te sluiten. Noteer iedere niet-uitgevoerde controle als openstaand; gezondheid van de demo is geen volledige showacceptatie.

De actuele [host- en releasecontrole](../verification/staging-release.json) bevestigt `active/running`, bootinschakeling en loopbackbinding; de [publieke eindcontrole](../verification/staging-public.json) bevestigt de laatste exacte release-identiteit en afwijzing van vreemde origin, vervalste identiteit en lokale login. De [handmatige app/configuratie-herstelproef](../verification/staging-recovery.json) is werkelijk uitgevoerd tussen twee volledig geaccepteerde releases van dezelfde bron. Deze proef injecteerde geen automatische activatiefout en voerde geen databaserollback uit.

Native wrapper versie 1 bewaart bekende releases en bijbehorende private envbestanden. Bij een mislukte nieuwe activatie herstelt hij automatisch een vooraf via health gezond bevonden vorige app met het bijbehorende envbestand. Mislukt ook de rollback-health, dan stopt de service. Bij de eerste mislukte activatie zonder gezonde voorganger stopt de service en verdwijnt `current`.

Voor een bewuste approllback kiest de beheerder een eerder bekende, compatibele main-SHA met geslaagde eigen CI en start **dezelfde `Deploy Milo staging`-workflow**, met die volledige `release_sha` en `apply_database: false`. Alle gewone gates en healthcontroles blijven gelden. Controleer vooraf dat de oude app het huidige schema en de huidige data kan gebruiken. Er bestaat geen apart `dg-site-rollback`-commando.

Een approllback draait database, bucket, Auth of providerconfiguratie niet terug. Ook automatische health-rollback bewijst die compatibiliteit niet. Bij een gecommitte databasewijziging met later mislukte appactivatie is de uitrol gedeeltelijk; behoud backup en historie en gebruik een afzonderlijk beoordeeld database-/providerherstelplan.

Leg na de echte uitvoering vast: volledige bron-/workflow-/runtime-SHA, CI-/database-/provisioning-/deploy-runs, entry-/helper-/toolchaindigests, release-inventarisdigest, configuratieversie, migratiechecksums, backup/herstelbewijs, service-identiteit/werkmap/loopbackbinding, publieke healthidentiteit en resterende acceptatie. Werk daarna het projectprofiel en resultaatbericht bij. De tijdelijke root-SSH-toegang is na deze taak verwijderd en de weigering van nieuwe sleutel-logins is vastgelegd in het toegangscleanupbewijs. De publieke nacontrole is daarna opnieuw geslaagd; normale releases blijven via de beperkte runneractie lopen.
