# Milo stagingdeployment

De gebruiker heeft op 5 november 2026 stagingdeployment geautoriseerd. Het doel is `https://milo-staging.dgwebservices.nl`, site `milobingo-staging` op `dg-nxttrack-01`. Productie valt buiten deze opdracht. Er is nog geen stagingapp geactiveerd of hosted databasemigratie uitgevoerd.

## Huidige stand en eerste uitvoering

De [eerste hostinspectie](https://github.com/milobingo/platform/actions/runs/42051941726) bevestigde de runner `dg-nxttrack-01-nxttrack-staging`, gebruiker `run-mil-stg` UID 1001, workspace `/home/run-mil-stg/_work/platform/platform`, groep `dg-build` en appaccount `app-mil-stg` UID 996. De sitebasis bestaat; bij inspectie waren ruim 150 GB en 9 miljoen inodes vrij. Capaciteit wordt vóór een release opnieuw gemeten.

Die eerste runnerinspectie vond geen native toolchain, deploywrapper, PostgreSQL-clients of Milo-service. Latere geautoriseerde rootinspectie bevestigde dat `/etc/dg-sites` aanvankelijk leeg was en dat er ook in de beheer-/root-/optpaden geen bestaande DG-wrapperbron beschikbaar was. Inmiddels werkt tijdelijke root-SSH vanaf uitsluitend Tailscale-peer `100.79.0.26`, begrensd tot twee uur en met cleanup na de taak. De volgende hostonderdelen zijn gericht voorbereid:

- Node `24.18.0` onder `/opt/node-v24.18.0-linux-x64`, met officiële distributiechecksumcontrole; pnpm `11.25.0` onder `/opt/dg-toolchains/pnpm/11.25.0`, zonder installatiescripts uitgevoerd.
- Het afzonderlijke buildaccount `build-mil-stg`, UID 990/GID 983, met `/var/lib/dg-build/milobingo-staging` als root:build `0710`.
- Loopbackpoort **4173**, na controle van sockets en siteregister; rootprofiel `/etc/dg-sites/milobingo-staging.deploy.json` mode `0600` met de vaste Node-/pnpm-paden en poort.
- Private backups onder `/var/backups/milobingo-staging`, runner-owned `0700`, buiten de app-owned `shared`-map.

Omdat geen bestaande DG-wrapper beschikbaar bleek, is een **nieuwe Milo-specifieke native wrapper versie 1** gebouwd. [STAGING-NATIVE-WRAPPER.md](STAGING-NATIVE-WRAPPER.md) beschrijft de bron, isolatie, hashes, vierargumenteninterface en automatische rollback. De 23 lokale tests en onafhankelijke bronreview zijn geslaagd. De helper/entry zijn nog niet geïnstalleerd; dat volgt uitsluitend na groene CI op de exacte commit die deze wrapper bevat. Caddy had bij inspectie alleen de standaard HTTP-site en een include voor sitefragmenten; Milo-service/Caddy/TLS-activatie zijn nog niet bewezen. Zie [STAGING-HOST.md](STAGING-HOST.md) voor de resterende installatie.

Procedurecommit `cad5c82e95c72141313cb9cdf4882cf594421dea` heeft [groene CI](https://github.com/milobingo/platform/actions/runs/42055666740). De [eerste deploypoging](https://github.com/milobingo/platform/actions/runs/42056457151) stopte op ontbrekende hostbootstrap, vóór checkout/runtime-secrets/migraties/activatie. De [eerste readonly-databaseaudit](https://github.com/milobingo/platform/actions/runs/42056451922) stopte veilig op `SELF_SIGNED_CERT_IN_CHAIN`.

De publieke Supabase-CA is daarna gecontroleerd en als stagingvariabele `SUPABASE_DB_CA_BASE64` geplaatst; certificaat- en hostnaamcontrole blijven aan. De TLS-correctie heeft [groene CI-run 42058318577](https://github.com/milobingo/platform/actions/runs/42058318577). De [nieuwe audit 42061456116](https://github.com/milobingo/platform/actions/runs/42061456116) verbond met geverifieerde CA, maar stopte op de interne `pg_stat_ssl`-controle achter de sessiepooler; de transportcontrole wordt daarvoor gecorrigeerd. Databaseversie, werkelijke rollen, app-tabellen en migratiehistorie blijven daarom onbekend. Een groene CI voor een oudere commit vervangt niet de vereiste CI voor de releasecommit met de nieuwe wrapper.

De lokale regressies, standalonebuild, typecheck, lint, actionlint en browsertests zijn procedurebewijs. De databasechecks omvatten een echte PostgreSQL 17.11-dump/restore met encryptie, gegevenschecksums, eigenaarschap, ACL en RLS. Dit is geen bewijs van hosted herstel, OTP-mail of stagingacceptatie.

## Environmentconfiguratie

[GitHub environment staging](https://github.com/milobingo/platform/settings/environments) bevat de volgende benoemde runtimewaarden. Secretwaarden worden niet in documentatie, CLI-argumenten of logs getoond.

| Bestaande variabelen | Bestaande secrets |
| --- | --- |
| `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_DB_CA_BASE64` | `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `VLAMPIE_SETTINGS_KEY` |
| `OPENAI_TEXT_MODEL`, `OPENAI_SPEECH_MODEL`, `LIVEKIT_URL` | `OPENAI_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |

Supabase staging blijft project `lfsdgxcpdyghidzkzzvn`, privébucket `milo-staging`. Maak geen vervangend project aan. De verbonden Supabase-accounts hebben geen toegang tot dit project; het gecontroleerde databasepad gebruikt de bestaande GitHub-environmentconfiguratie.

| Releaseconfiguratie | Soort en huidige invulling |
| --- | --- |
| `DG_STAGING_PORT` | Environment variable, geplaatst als `4173`. |
| `DG_CONFIG_VERSION` | Environment variable, geplaatst als `v1`; wordt door de workflow naar runtime `CONFIG_VERSION` gemapt. |
| `DG_DEPLOY_WRAPPER_SHA256` | Environment variable, nog vast te leggen als hash van de daadwerkelijk geïnstalleerde **gerenderde entry**. De helperhash wordt daarin gepind. |
| `MIGRATION_DATABASE_URL` | Nog aan te leveren deployment-only secret: geautoriseerde beheerverbinding, gescheiden van de beperkte app-login. |
| `BACKUP_ENCRYPTION_KEY` | Nog aan te leveren afzonderlijke deployment-only secret, 64 hextekens. |
| `RESTORE_TEST_DATABASE_URL` | Nog aan te leveren deployment-only secret voor de afzonderlijke lege lokale `milo_restore_test_*`-database. |

`DATABASE_BACKUP_DIRECTORY` is in de workflow vastgezet op **`/var/backups/milobingo-staging`**. De app-runtime krijgt geen migratie-, backup-, herstel- of GitHub-credentials. De bestaande `DATABASE_URL` moet nog op werkelijk least-privilege loginrechten worden gecontroleerd; aanwezigheid van de secret bewijst dat niet. De runtimegate weigert beheer-/RLS-bypassrechten en onverwachte rollidmaatschappen.

## Releasepad

1. Integreer bron en lockfile op `main`, inclusief de beoordeelde native wrapper en documentatie. Kies één volledige 40-teken releasecommit en laat de eigen **CI** daarop slagen. De gate controleert ook main-afkomst, workflow-SHA en de succesvolle vereiste verify-job.
2. Rond de eenmalige hostinstallatie uit [STAGING-HOST.md](STAGING-HOST.md) af: helper/gerenderde entry, hashes, beperkte sudoers-regel, appunit, Caddyfragment, PostgreSQL-tools en herstelvoorzieningen. Installeer geen nieuwere wrapperbron op basis van alleen CI voor een oudere commit.
3. Start zo nodig **Inspect Milo staging** voor nieuw hostbewijs. **Audit Milo staging database** is een afzonderlijke readonly-diagnose, eveneens gebonden aan exacte groene CI. Zij kan met tijdelijke Actions-tools draaien voordat alle native voorzieningen gereed zijn. De eerste diagnose mag de bestaande `DATABASE_URL` inventariseren; zij verandert geen schema, bucket of app. Pending migraties, onleesbare historie of andere blokkades geven een rode audit.
4. Beoordeel SQL-checksums en de werkelijke database-/rolstaat. Volg [STAGING-DATABASE.md](STAGING-DATABASE.md). Configureer de aparte migratieverbinding en de beperkte runtime-login. Bestaande onbeheerde applicatietabellen of drift worden nooit gereset of stilzwijgend geadopteerd.
5. Start **Deploy Milo staging** vanuit `main`, met de volledige `release_sha`. `apply_database` staat standaard uit. Schakel het uitsluitend voor de afzonderlijk beoordeelde ontbrekende bootstrap/bucket in wanneer backup en echte herstelproef volledig ingericht zijn. De workflow berekent de manifesthash van de geselecteerde, door CI gecontroleerde bron en geeft die expliciet aan `--apply` door. Ontbrekende backup-/herstelconfiguratie blijft een blokkade, ook bij nul app-tabellen.
6. De workflow verifieert runner/caller/host/workspace/checkout, wrapperhash, toolchain, configuratienamen, vrije bytes/inodes en de eigen groene CI. Databasebeheer gebruikt alleen binnen die stap de naar `DATABASE_URL` gemapte `MIGRATION_DATABASE_URL`. Na eventuele toepassing volgt opnieuw een readonly-audit en een afzonderlijke controle van de beperkte app-databaselogin.
7. De entry wordt uitsluitend aangeroepen met deze vier argumenten:

   ```text
   milobingo-staging
   /home/run-mil-stg/_work/platform/platform
   <volledige release-SHA>
   <GitHub run-ID>-<pogingnummer>
   ```

   De roothelper controleert de argumenten opnieuw, gebruikt de hostbrede build-lock en archiveert de exacte commit als runner. Uitpakken, installatiescripts en native build draaien als afzonderlijke `build-mil-stg`-identiteit in begrensde systemd-units met een lege gecontroleerde omgeving. Runtimecredentials komen pas na build/sealing in een afzonderlijk root-only envbestand terecht.
8. De helper activeert app en env samen via `current`, herstart alleen de Milo-service en controleert loopback-health op SHA/run/configuratie. De workflow controleert daarna publieke HTTPS, dezelfde volledige identiteit, demoassets, anonieme toegangsweigering en uitgeschakelde ontwikkelaanmelding. Een mislukte nacontrole maakt de deployment niet succesvol.

De service leest `EnvironmentFile=/srv/sites/milobingo-staging/current/.runtime.env` en start rechtstreeks `/opt/node-v24.18.0-linux-x64/bin/node` met `current/.next/standalone/server.js`. Een vast envbestand buiten deze releasekoppeling zou automatische rollback breken. Het bijgewerkte servicevoorbeeld en Caddyfragment gebruiken de bevestigde paden en poort 4173; hun aanwezigheid in Git bewijst geen installatie.

Buildconfiguratie bevat geen providersecrets of browservariabelen. De 21 runtimekeys staan in `scripts/deploy/release-preflight.mjs` en de wrapper; de entry geeft uitsluitend deze waarden als begrensde JSON via sudo-stdin door. `GITHUB_TOKEN`, de migratieverbinding, backupkey en herstelverbinding worden niet doorgegeven. Deployment start geen betaalde AI-call, OTP-mail of echte uitzending.

## Acceptatie, herstel en bewijs

De automatische nacontrole bewijst bereikbaarheid en toegangsgrenzen. OTP/Google met echte accounts, bewuste regietoekenning, gezin/boekjes/PDF en de bel-/uitzendketen blijven releasegebonden acceptatiestappen volgens [RUNBOOK.md](RUNBOOK.md). De DG-mailgateway/outbox vereist nog het afgesproken gatewaycontract. Registreer niet-uitgevoerde controles als openstaand.

Native wrapper versie 1 bewaart alle bekende releases en private envbestanden. Bij mislukte nieuwe activatie herstelt hij automatisch een vooraf gezond bevonden vorige app én het bijbehorende envbestand. Mislukt die rollback, dan stopt de service. Bij de eerste mislukte activatie zonder gezonde voorganger stopt de service en verdwijnt `current`. Er is geen apart handmatig `dg-site-rollback`-commando; een aanvullende herstelactie wordt gericht als beheerhandeling uitgevoerd volgens het beoordeelde versie-1-contract.

Een approllback draait database, bucket, Auth of providerinstellingen niet terug. Bij een gecommitte databasewijziging met later mislukte appactivatie is de uitrol gedeeltelijk. Bewaar backup en historie, controleer de nog actieve app en gebruik een apart herstelplan voor database/providerconfiguratie. Reset nooit een omgeving om historieverschillen te verbergen.

Leg na de echte uitvoering vast: volledige bron-/workflow-/runtime-SHA, CI- en deploy-run, entry-/helper-/toolchaindigests, release-inventarisdigest, configuratieversie, migratiechecksums, backup/herstelbewijs, service-eigenaar/werkmap/loopbackbinding, publieke healthidentiteit en resterende acceptatiestappen. Werk dan `PROJECTPROFIEL.json` en het resultaatbericht bij. Verwijder de tijdelijke root-SSH-toegang na de taak; de normale releasebediening blijft de beperkte runneractie.
