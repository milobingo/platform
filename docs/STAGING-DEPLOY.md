# Milo stagingdeployment

Staging is geautoriseerd voor `https://milo-staging.dgwebservices.nl`, site `milobingo-staging` op `dg-nxttrack-01`. Productie valt buiten deze opdracht. De native hostvoorzieningen zijn geïnstalleerd; de app en hosted databasemigratie zijn op dit overdrachtsmoment nog niet uitgevoerd. Databaseherstel, runtimeprovisioning en appacceptatie blijven afzonderlijke gates.

## Bevestigde stand

De [hostcontrole van 5 november, 16:27:48 UTC](../verification/staging-host.json) bevestigt:

- Runner `dg-nxttrack-01-nxttrack-staging`, gebruiker `run-mil-stg` UID 1001, checkout `/home/run-mil-stg/_work/platform/platform`.
- Afzonderlijk buildaccount `build-mil-stg` UID 990/GID 983 zonder aanvullende groepen; appaccount `app-mil-stg` UID 996/GID 987.
- Native Node `24.18.0`, pnpm `11.25.0` en PostgreSQL-clients `psql`, `pg_dump`, `pg_restore` `17.11`.
- Geïnstalleerde root-owned entry/helper, beperkte sudoers-regel, Milo-appunit en Caddyfragment. Eén toegestane en zes verboden sudo-policyproeven zijn geslaagd; daarbij is geen deployment uitgevoerd.
- Rootprofiel met de vaste toolchainpaden en loopbackpoort `4173`; afzonderlijke buildroot en private backuplocatie `/var/backups/milobingo-staging` mode `0700`.
- Actieve Caddy en werkend HTTPS met geldig certificaat. HTTP `502`, een ontbrekende `current`, een inactieve/uitgeschakelde appunit en een lege poort `4173` bevestigen dat de app nog niet actief is.

De eerste hostinspectie vond geen bestaande DG-wrapper, installatiebron of siteregistratie. Deze host gebruikt daarom de nieuwe **Milo-specifieke native wrapper versie 1**. Dit is een eerste inrichting, geen installatie van een aangetroffen centrale standaard. Het vierargumentencontract, de buildisolatie en automatische rollback staan in [STAGING-NATIVE-WRAPPER.md](STAGING-NATIVE-WRAPPER.md); installatiehashes en rechten staan in [STAGING-HOST.md](STAGING-HOST.md).

| Bron / controle | Bevestigd resultaat |
| --- | --- |
| Wrapperbron `06ea22275661cb0c5edd2c1352737b377573d1b5` | [CI 42062188288](https://github.com/milobingo/platform/actions/runs/42062188288) geslaagd. |
| Provisioningbron `528dc6b06e6a924edabe752eb21b65155fa5470c` | [CI 42063259923](https://github.com/milobingo/platform/actions/runs/42063259923) geslaagd. |
| Herstelmetadatafix `0a7cfa32850bade3206f7e6f61188a3564ead0ae` | [CI 42065193147](https://github.com/milobingo/platform/actions/runs/42065193147) geslaagd. De daaropvolgende restore stopte vóór migratie op de ontbrekende interne rol `pgbouncer`; de letterlijke rolprefixselectie is hiervoor gecorrigeerd. |
| Readonly-databaseaudit | [Run 42062775524](https://github.com/milobingo/platform/actions/runs/42062775524) bevestigde geverifieerde databaseverbinding en inventarisatie; de verwachte ontbrekende migratie blokkeerde de audit. Dit is geen toegepaste migratie. |
| Eerste database-apply | [Run 42065993828](https://github.com/milobingo/platform/actions/runs/42065993828) stopte tijdens de scratchrestore, vóór migratie. De bron bleef ongewijzigd; versleutelde dump en metadata zijn behouden. |
| Tweede database-apply | [Run 42068032013](https://github.com/milobingo/platform/actions/runs/42068032013), na [groene CI 42067369331](https://github.com/milobingo/platform/actions/runs/42067369331), stopte vóór migratie op de native eventtrigger-eigenaarsregel. De beperkte compatibiliteitsvoorziening op scratch wordt daarom afzonderlijk getest. |
| Private bootstrapoverdracht | [Run 42062776243](https://github.com/milobingo/platform/actions/runs/42062776243) geslaagd; de aparte migratieverbinding is geconfigureerd. |
| Herstelvoorzieningen | Backupencryptiesleutel geconfigureerd en afzonderlijke lokale scratchverbinding geauthenticeerd. Een volledige herstelproef is nog niet uitgevoerd. |

Een groene CI op een oudere commit keurt nieuwere bron niet goed. Gebruik één volledige, expliciet gekozen main-SHA en wacht op succesvolle eigen CI voor precies die bron. Lokale regressies en loopback-PostgreSQL-tests bewijzen proceduregrenzen; zij bewijzen geen hosted herstel of gebruikersacceptatie.

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
| `MIGRATION_DATABASE_URL` | Afzonderlijke beheerverbinding geconfigureerd; uitsluitend voor databasebeheer. |
| `BACKUP_ENCRYPTION_KEY` | Afzonderlijke deployment-only sleutel geconfigureerd; geen app-runtimewaarde. |
| `RESTORE_TEST_DATABASE_URL` | Afzonderlijke lokale scratchverbinding geconfigureerd en geauthenticeerd; authenticatie vervangt geen herstelproef. |

`DATABASE_BACKUP_DIRECTORY` staat vast op `/var/backups/milobingo-staging`, buiten de app-owned `shared`-map. Controleer capaciteit op zowel backup- als herstelvolume. De appomgeving krijgt geen migratie-, backup-, herstel- of GitHub-credentials.

De bestaande `DATABASE_URL` is nog geen bewijs van een beperkte runtime-login. Behoud de beheerverbinding afzonderlijk als `MIGRATION_DATABASE_URL`; vervang het appsecret uitsluitend na de geverifieerde provisioning hieronder. De runtimegate weigert beheerrechten, RLS-bypass en onverwachte rollidmaatschappen.

## Eerste bootstrap: vaste volgorde

Alle onderstaande workflows worden handmatig vanuit `main` gestart. Ze delen concurrencygroep `milobingo-staging`, controleren de eigen exacte groene CI en gebruiken de bevestigde stagingrunner. De bron staat al in `main`; start de volgende stappen pas wanneer de gekozen volledige SHA daadwerkelijk groene CI heeft.

1. **Bevestig bron, CI en herstelserver.** Controleer de volledige 40-teken `release_sha`, beoordeelde migraties en clientmajor. Volg [STAGING-DATABASE.md](STAGING-DATABASE.md) en [STAGING-RESTORE-SCRATCH.md](STAGING-RESTORE-SCRATCH.md). De scratchdatabase is afzonderlijk en mag geen app- of andere sitedatabase zijn. Een readonly-audit mag de staat inventariseren, maar verandert niets. De eenmalige credentialoverdracht is reeds uitgevoerd en is geen normale deployvoorwaarde.
2. **Start `Apply Milo staging database`**, bestand `staging-database-apply.yml`, met die `release_sha`. Deze workflow gebruikt uitsluitend `MIGRATION_DATABASE_URL` als beheerverbinding. Hij berekent de manifesthash van de exacte CI-goedgekeurde bron, maakt vóór schemawijzigingen een versleutelde volledige dump en herstelt die werkelijk in scratch. Gegevenschecksums, eigenaarschap, ACLs, RLS en extensionmetadata moeten overeenkomen. Ontbrekend of afwijkend bewijs stopt vóór de migratie. Bewaar de veilige `backupId`, release-SHA en bewijsmetadata uit de geslaagde uitvoering; geen credentialwaarden.
3. **Start `Provision Milo staging runtime login`**, bestand `staging-runtime.yml`, met **dezelfde `release_sha`** en de exacte `backup_id` uit stap 2. Het herstelbewijs mag maximaal één uur oud zijn en moet aan dezelfde release/migratiehistorie zijn gebonden. De workflow maakt uitsluitend de ontbrekende vaste login `milo_staging_runtime`, geeft de beoordeelde backendrechten en verifieert daarna werkelijk de nieuwe authenticatie, TLS en minimale bevoegdheden. Een bestaande login wordt niet overschreven of automatisch van wachtwoord veranderd.
4. **Laat de bevoegde rootbootstrap de private runtimeoverdracht verwerken.** Pas na een geslaagde provisioningworkflow én onafhankelijke verificatie van de nieuwe login wordt de gegenereerde URL via de afgebakende secret-writeprocedure als GitHub-stagingsecret `DATABASE_URL` geplaatst. De beheerverbinding blijft `MIGRATION_DATABASE_URL`. Consumeer de private `runtime-output.json` zonder waarden te loggen en verwijder hem onmiddellijk na verwerking. Het gewone workflowtoken heeft hiervoor geen secret-writebevoegdheid. Een aanwezig bestand of een gedeeltelijk geslaagde run geeft geen toestemming om de URL te publiceren; bij onzekere commit/nacontrole blijft het bestand voor gecontroleerd herstel behouden en stopt deployment.
5. **Start `Deploy Milo staging`**, bestand `deploy-staging.yml`, met de gekozen volledige `release_sha` en **`apply_database: false`**. De database is in dit eerste bootstraptraject reeds afzonderlijk toegepast en de beperkte runtime-login is nu beschikbaar. Gebruik de gecombineerde apply-optie niet om de voorafgaande gates over te slaan. De deployworkflow controleert opnieuw host/caller/workspace/checkout, wrapperhash, toolchain, configuratie, capaciteit, databasegereedheid en de beperkte appverbinding.
6. **Bevestig de app en publieke nacontrole.** De native wrapper bouwt en activeert de exacte release; de workflow controleert daarna publieke HTTPS, volledige SHA/run/configuratie, demoassets, anonieme autorisatie en uitgeschakelde ontwikkelaanmelding. Een mislukte nacontrole maakt de deployment niet succesvol. Schakel de service pas na geslaagde eerste health voor boot in en voer de afzonderlijke gebruikersacceptatie uit.

Als het herstelbewijs verloopt of bron, schema of historie niet overeenkomen, herstel dan eerst de afzonderlijke gate. Een nieuwe backup of aangepast bootstrapplan wordt expliciet beoordeeld; verwijder geen historie en reset geen omgeving om verschillen te verbergen.

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

De automatische publieke nacontrole bewijst appbereikbaarheid, release-identiteit, demoassets en toegangsgrenzen. De volgende controles zijn op dit moment **niet uitgevoerd**: echte OTP-mail en Google-login, bewuste regietoekenning, gezinnen/boekjes/PDF met echte accounts, betaald provider-/modeltoegangsgebruik en de daadwerkelijke bel-/uitzendketen met audio. Voer deze releasegebonden uit volgens [RUNBOOK.md](RUNBOOK.md). Het DG-mailgateway-/outboxcontract blijft afzonderlijk aan te sluiten. Noteer iedere niet-uitgevoerde controle als openstaand; gezondheid van de demo is geen volledige showacceptatie.

Native wrapper versie 1 bewaart bekende releases en bijbehorende private envbestanden. Bij een mislukte nieuwe activatie herstelt hij automatisch een vooraf via health gezond bevonden vorige app met het bijbehorende envbestand. Mislukt ook de rollback-health, dan stopt de service. Bij de eerste mislukte activatie zonder gezonde voorganger stopt de service en verdwijnt `current`.

Voor een bewuste approllback kiest de beheerder een eerder bekende, compatibele main-SHA met geslaagde eigen CI en start **dezelfde `Deploy Milo staging`-workflow**, met die volledige `release_sha` en `apply_database: false`. Alle gewone gates en healthcontroles blijven gelden. Controleer vooraf dat de oude app het huidige schema en de huidige data kan gebruiken. Er bestaat geen apart `dg-site-rollback`-commando.

Een approllback draait database, bucket, Auth of providerconfiguratie niet terug. Ook automatische health-rollback bewijst die compatibiliteit niet. Bij een gecommitte databasewijziging met later mislukte appactivatie is de uitrol gedeeltelijk; behoud backup en historie en gebruik een afzonderlijk beoordeeld database-/providerherstelplan.

Leg na de echte uitvoering vast: volledige bron-/workflow-/runtime-SHA, CI-/database-/provisioning-/deploy-runs, entry-/helper-/toolchaindigests, release-inventarisdigest, configuratieversie, migratiechecksums, backup/herstelbewijs, service-identiteit/werkmap/loopbackbinding, publieke healthidentiteit en resterende acceptatie. Werk daarna het projectprofiel en resultaatbericht bij. Verwijder de tijdelijke root-SSH-toegang na de taak; normale releases blijven via de beperkte runneractie lopen.
