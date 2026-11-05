# Milo stagingdeployment

De gebruiker heeft op 5 november 2026 stagingdeployment geautoriseerd. Het doel is `https://milo-staging.dgwebservices.nl`, site `milobingo-staging` op `dg-nxttrack-01`. Productie is geen onderdeel van deze procedure.

## Aangetroffen inrichting

De [hostinspectie van 5 november](https://github.com/milobingo/platform/actions/runs/42051941726) bevestigt de runner `dg-nxttrack-01-nxttrack-staging`, gebruiker `run-mil-stg`, workspace `/home/run-mil-stg/_work/platform/platform`, groep `dg-build` en appaccount `app-mil-stg`. De sitebasis bestaat. Er is voldoende vrije ruimte; de aangetroffen host heeft ruim 150 GB en 9 miljoen vrije inodes.

Dezelfde inspectie vindt geen geïnstalleerde `dg-site-deploy`/`dg-site-rollback`, deploymentversies van Node/pnpm, PostgreSQL-clienttools of Milo-appservice. De runner kan geen sudo-opdrachten uitvoeren. Caddy draait, maar heeft geen Milo-siteconfiguratie en luistert nog niet op HTTPS. De staging-URL is daardoor nog niet beschikbaar. Geen applicatierelease of hosted migratie is geactiveerd.

De groene inspectierun bewijst dat de runner opdrachten uitvoert; hij keurt de host niet automatisch goed voor deployment. De releaseworkflow stopt op ontbrekende voorwaarden vóór backup, migratie, build of activatie.

Lokaal zijn de 37 contractcheck-scripts geslaagd, inclusief tien releasecontroles en zeven database-deploytests op PostgreSQL 17.11. De laatste omvatten een echte versleutelde dump/restore met gegevens-, eigenaarschap-, ACL- en RLS-vergelijking. De standalonebuild, typecheck, lint, workflowvalidatie met actionlint 1.7.12 en acht browsertests zijn geslaagd. Dit zijn lokale procedurebewijzen; het zijn geen stagingacceptatie of hosted herstelbewijs.

## Eenmalige inrichting

Laat een beheerder met sudo op de doelhost de stappen in [STAGING-HOST.md](STAGING-HOST.md) afronden. De huidige Codex-sessie heeft geen SSH-beheersleutel voor `root` of `dgadmin` op deze host. De repo bevat service-/Caddyvoorbeelden om dit gericht voor Milo af te maken; geen scripts die andere sites herconfigureren.

In [GitHub environment staging](https://github.com/milobingo/platform/settings/environments) zijn de onderstaande runtimeconfiguratienamen al aanwezig. Alleen namen en publieke projectidentiteiten zijn geïnspecteerd; secretwaarden zijn niet opgehaald.

| Bestaande variabelen | Bestaande secrets |
| --- | --- |
| `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_STORAGE_BUCKET` | `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `VLAMPIE_SETTINGS_KEY` |
| `OPENAI_TEXT_MODEL`, `OPENAI_SPEECH_MODEL`, `LIVEKIT_URL` | `OPENAI_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |

Supabase staging is project `lfsdgxcpdyghidzkzzvn`, private bucket `milo-staging`. Maak hiervoor geen vervangend project aan. De verbonden Supabase-accounts van deze sessie hebben geen toegang tot dit project; het gecontroleerde databasepad gebruikt de bestaande GitHub-environmentconfiguratie.

Voeg na hostinrichting toe:

| Naam | Soort | Invulling |
| --- | --- | --- |
| `DG_DEPLOY_WRAPPER_SHA256` | Environment variable | SHA-256 van de daadwerkelijk geïnstalleerde en beoordeelde rootwrapper. Geen hash van een willekeurig bestand of fictieve versie. |
| `DG_STAGING_PORT` | Environment variable | Door de beheerder gecontroleerde vrije loopbackpoort, gelijk aan service en Caddy. |
| `DG_CONFIG_VERSION` | Environment variable | Niet-geheime configuratieversie; verhoog bij relevante omgevingswijzigingen. |
| `MIGRATION_DATABASE_URL` | Environment secret | Aparte beheerverbinding van het stagingproject voor databaseaudit, migraties en backups. De app gebruikt `DATABASE_URL` met een beperkte login die lid is van `milo_backend`, zonder superuser, rol-/databasebeheer of RLS-bypass. |
| `BACKUP_ENCRYPTION_KEY` | Environment secret | Afzonderlijke 32-byte sleutel als 64 hextekens voor AES-256-GCM-backups. Bewaar ook gecontroleerd buiten GitHub voor herstel. |
| `RESTORE_TEST_DATABASE_URL` | Environment secret | Afzonderlijke lege lokale hersteltestdatabase, loopback, naam `milo_restore_test_*`. Geen staging- of productiedatabase. |

Gebruik voor migraties een projectgebonden directe PostgreSQL- of sessiepoolerverbinding op 5432; een transaction pooler op 6543 is ongeschikt. Laat de procedure TLS en projectidentiteit controleren. Backup-/restorecredentials en de migratieverbinding gaan niet naar de applicatie. De afgeschermde backuplocatie is `/srv/sites/milobingo-staging/shared/backups`; laat de beheerder de juiste private toegang voor de deploygebruiker inrichten. Raadpleeg [STAGING-DATABASE.md](STAGING-DATABASE.md) voor het vereiste databasecontract, de backupbewijzen en de behandeling van bestaande tabellen.

## Release uitvoeren

1. Integreer bron en lockfile op `main`. Kies één volledige 40-teken commit. Laat de workflow **CI** op die exacte commit slagen; browseracceptatie draait tegen het gebouwde standalonepakket.
2. Start **Inspect Milo staging infrastructure** indien hostinrichting is veranderd. Beoordeel de gevonden hostinformatie; de muterende deploy heeft daarnaast eigen harde voorcontroles.
   **Audit Milo staging database** is een afzonderlijke read-only diagnose. Deze kan met tijdelijk gecachete Actions-tools al draaien vóór de native hosttoolchain is ingericht. Hij gebruikt de bestaande databaseverbinding alleen voor inventarisatie en verandert geen schema, bucket of app. Ontbrekende migraties of andere blokkades geven een rode audit met concrete redenen.
3. Start **Deploy Milo staging** vanuit `main`, met de gekozen `release_sha`. Kies database toepassen uitsluitend als de read-only audit aangeeft dat migraties of de bevestigde private bucket ontbreken en backup/herstel volledig is ingericht. Bestaande onbeheerde applicatietabellen of schemadrift vereisen eerst afzonderlijke vergelijking en review.
4. De workflow controleert de eigen groene CI en main-afkomst, exact runneraccount/host/workspace/checkout, wrapperhash, toolchain, configuratienamen en vrije bytes/inodes. De wrapper verzorgt de hostbrede build-lock, installatie uit het lockfile, native build en activatie. Runtime-secrets blijven buiten het buildproces.
5. De databasecontrole inventariseert historie, checksums, tabellen, RLS/grants en de private bucket. Toepassen vereist een versleutelde backup met echte herstelproef. Een tweede audit moet gereed melden voordat de applicatie wordt geactiveerd.
6. `dg-site-deploy` krijgt uitsluitend de bestaande vier argumenten:

   ```text
   milobingo-staging
   /home/run-mil-stg/_work/platform/platform
   <volledige release-SHA>
   <GitHub run-ID>-<pogingnummer>
   ```

7. Na activatie controleert de workflow publieke HTTPS, volledige health-revision, release-ID en configuratieversie, demo en assets, anonieme toegangsweigering en uitgeschakelde ontwikkelaanmelding. Leg de run-URL en actieve release vast. Een mislukte nacontrole maakt de deployment niet succesvol.

Buildconfiguratie bevat geen browservariabelen of providersecrets. De runtime-allowlist staat als `RUNTIME_KEYS` in `scripts/deploy/release-preflight.mjs`. Alleen de benoemde applicatiewaarden gaan naar de runtime; `GITHUB_TOKEN`, backupkey en herstelverbinding blijven erbuiten. Er wordt tijdens deployment geen betaalde AI-call, OTP-mail of echte uitzending gestart.

## Acceptatie en herstel

De automatische nacontrole bewijst bereikbaarheid en toegangsgrenzen. OTP/Google met echte accounts, regierollen, gezin/boekjes/PDF en de bel-/uitzendketen blijven releasegebonden acceptatiestappen volgens [RUNBOOK.md](RUNBOOK.md). De DG-mailgateway/outbox vereist nog het afgesproken gatewaycontract. Sla die controles niet als geslaagd op als ze niet zijn uitgevoerd.

De rootwrapper moet de vorige compatibele release bewaren en bij mislukte activatie de gedocumenteerde approllback ondersteunen. Omdat deze wrapper nog niet aanwezig is, staat er bewust geen verzonnen rollbackcommando in deze procedure. Leg vóór de eerste activering het werkelijke rollbackcommando en vorige release vast. Bij de allereerste release kan er nog geen vorige applicatierelease zijn.

Een approllback draait database, bucket, Auth- of providerinstellingen niet terug. Als de databasewijziging al is toegepast, noteer dat als gedeeltelijke uitrol en controleer compatibiliteit met de vorige applicatie. Gebruik databaseherstel alleen via het bewaarde backup-/herstelbewijs en een apart beoordeeld herstelplan. Reset nooit een omgeving om historieverschillen te verbergen.

Bewaar per release bron-SHA, workflow-SHA, CI-run, deploy-run, wrapperhash, Node/pnpm-versies, configuratieversie, backup-/herstelbewijs, migratiechecksums, actieve health-identiteit en resterende acceptatiestappen. `PROJECTPROFIEL.json` houdt onbekende gegevens op `null` totdat ze op de doelhost zijn bevestigd.
