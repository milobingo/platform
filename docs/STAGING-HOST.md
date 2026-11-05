# Milo staging: hostinrichting en overdracht

Staging is geautoriseerd; productie valt buiten deze opdracht. De specifiek voor Milo begrensde **native wrapper versie 1**, beperkte sudoers-regel, appunit en Caddyfragment zijn geïnstalleerd. De app is nog niet geactiveerd. De onafhankelijke readonly-hostcontrole van **5 november 2026, 16:27:48 UTC** staat in [verification/staging-host.json](../verification/staging-host.json). Die bevat uitsluitend openbare configuratie, hashes, bestandsrechten, service-/socketstatus en CI-identiteiten; geen runtimewaarden of private credentials. Zie [STAGING-NATIVE-WRAPPER.md](STAGING-NATIVE-WRAPPER.md) voor het implementatiecontract.

## Bevestigde bestemming en huidige hoststaat

De eerste runnerinspectie is [Actions-run 42051941726](https://github.com/milobingo/platform/actions/runs/42051941726). Latere rootbootstrap en de onafhankelijke hostcontrole bevestigen onderstaande gegevens. Een geïnstalleerde hostvoorziening is geen bewijs van een actieve apprelease.

| Onderdeel | Bevestigd |
| --- | --- |
| Repository / integratiebranch / environment | `milobingo/platform`, `main`, `staging` |
| Host / besturingssysteem | `dg-nxttrack-01`, Ubuntu 24.04 |
| Tailscale-beheerhost | `100.111.66.17` |
| Tijdelijke beheerverbinding | Root-SSH werkt uitsluitend vanaf Tailscale-peer `100.79.0.26`; toegang is begrensd tot twee uur en wordt na de taak opgeruimd. |
| Staging-origin / DNS A | `https://milo-staging.dgwebservices.nl`, `128.140.93.95` op het inspectiemoment |
| Runnernaam | `dg-nxttrack-01-nxttrack-staging` |
| Runnerlabels | `self-hosted`, `Linux`, `X64`, `dg-milobingo-01`, `dg-nxttrack-01`, `milobingo`, `staging` |
| Runneraccount | `run-mil-stg`, UID `1001`, primaire GID `1002`, aanvullend `dg-build` GID `1001` |
| Exacte checkout | `/home/run-mil-stg/_work/platform/platform` |
| Geïsoleerd buildaccount | `build-mil-stg`, UID `990`, eigen primaire groep GID `983` |
| Appaccount / groep | `app-mil-stg`, UID `996`, GID `987` |
| Site-ID / siteroot | `milobingo-staging`, `/srv/sites/milobingo-staging`, `root:app-mil-stg` mode `0750` |
| Bestaande persistente appmap | `/srv/sites/milobingo-staging/shared`; bestaande inhoud behouden |
| Gereserveerde apppoort | `127.0.0.1:4173`, gekozen na controle van de werkelijke sockets en het lege siteregister |
| Native Node | `24.18.0`, `/opt/node-v24.18.0-linux-x64/bin/node`, officiële distributie en SHA256 gecontroleerd |
| Native pnpm | `11.25.0`, `/opt/dg-toolchains/pnpm/11.25.0/bin/pnpm`, vastgezet geïnstalleerd met uitgeschakelde installatiescripts |
| Geïnstalleerde buildroot | `/var/lib/dg-build/milobingo-staging`, `root:build-mil-stg` mode `0710`; buildaccount heeft uitsluitend zijn eigen groep |
| Private backuplocatie | `/var/backups/milobingo-staging`, `run-mil-stg:run-mil-stg` mode `0700`, onder een root-beheerde oudermap |
| Native PostgreSQL-clienttools | `psql`, `pg_dump`, `pg_restore` versie `17.11`, onder `/usr/lib/postgresql/17/bin` |
| Native entry / helper | `/usr/local/bin/dg-site-deploy`, `/usr/local/libexec/dg-milobingo-deploy-helper`, beide `root:root` mode `0755` |
| Sudoers | `/etc/sudoers.d/milobingo-staging-deploy`, `root:root` mode `0440`; één toegestane en zes verboden policy-listproeven geslaagd |
| Milo-appservice | `milobingo-staging.service`, geladen maar `inactive/dead`, `disabled`, `MainPID=0`; account `app-mil-stg` |
| Caddy / HTTPS | Caddy actief; poort `443` luistert; publieke TLS-controle geslaagd, HTTP `502` zolang de app ontbreekt |
| Actieve apprelease | `current` ontbreekt en poort `4173` luistert niet op het inspectiemoment |
| Supabase staging | `lfsdgxcpdyghidzkzzvn`, `https://lfsdgxcpdyghidzkzzvn.supabase.co` |
| Bevestigde private bucket | `milo-staging` |

De eerste inspectie vond geen native Node/pnpm, deploywrapper, PostgreSQL-clienttools of Milo-appservice; de runner had geen sudo-bevoegdheid. Dat is de **beginsituatie**. Rootinspectie vond evenmin een herbruikbare DG-wrapperbron. De nieuwe Milo-implementatie en bovenstaande hostvoorzieningen zijn inmiddels geïnstalleerd. De interne Node van GitHub Actions wordt niet als app- of native buildtoolchain gebruikt.

Caddy importeert het Milo-fragment via de bestaande `/etc/caddy/sites/*.caddy`-include. De publieke controle bevestigt een geldig HTTPS-certificaat en HTTP `502`; dit bewijst de proxy/TLS-inrichting, terwijl de app-upstream nog ontbreekt. De hostcontrole voert geen databaseverbinding, migratie, helperaanroep of gebruikersacceptatie uit.

Het geïnstalleerde root-only profiel `/etc/dg-sites/milobingo-staging.deploy.json`, mode `0600`, heeft precies dit openbare versie-1-contract:

```json
{
  "node": "/opt/node-v24.18.0-linux-x64/bin/node",
  "pnpm": "/opt/dg-toolchains/pnpm/11.25.0/bin/pnpm",
  "port": 4173
}
```

Dit is geen aangetroffen centrale DG-standaard. De nieuwe Milo-implementatie controleert precies deze velden, toolchainpaden en eigendomsgrenzen.

## Installatiebewijs en resterende releasegates

Werk uitsluitend binnen Milo staging. Behoud bestaande andere apps, runners, services, Caddyconfiguratie en gegevens. Deel geen toegangssleutels of secretwaarden in chat, Git of logs.

De geïnstalleerde wrapperbron hoort bij commit `06ea22275661cb0c5edd2c1352737b377573d1b5`, met [geslaagde CI 42062188288](https://github.com/milobingo/platform/actions/runs/42062188288). De latere provisioningcommit `528dc6b06e6a924edabe752eb21b65155fa5470c` heeft eveneens [geslaagde CI 42063259923](https://github.com/milobingo/platform/actions/runs/42063259923). Nieuwere database-/herstelwijzigingen vereisen hun eigen geslaagde CI en worden niet door deze twee runs goedgekeurd.

| Geïnstalleerd bestand | SHA-256 |
| --- | --- |
| Entry | `aee3e1e2e76f05d99f668ed7c756802da82033c4983216b90d7ea50de9f49bc7` |
| Helper | `ce93bfeffa573616394d1f28dc5dd101bc7e0ce076b7bf25b35a38827ed9aba8` |

Alle gecontroleerde installatiebestanden zijn root-owned en niet schrijfbaar voor runner, build of app. De sudoers-regel gebruikt de helperdigest en een vaste argumentgrens. Alleen de policy voor de juiste Milo-helper/site/checkout/SHA/run-combinatie is toegestaan; een andere site, checkout, ongeldige SHA, extra argument, rootshell en directe systemctl-aanroep zijn geweigerd. Dit waren uitsluitend `sudo -l`-controles; de helper is niet uitgevoerd.

Siteroot en `releases` zijn `root:app-mil-stg 0750`; de externe runtime-envdirectory is `root:root 0700`. De globale lock is `root:dg-build 0660`. De geïnstalleerde appunit heeft de verwachte appidentiteit, werkmap, readonly filesystem en uitsluitend `shared` als expliciet schrijfpad. De unit en het Caddyfragment hebben dezelfde hashes als de beoordeelde bronvoorbeelden.

1. **Rond het databaseherstelbewijs af.** Gebruik de exacte CI-goedgekeurde databaseprocedure, passende PostgreSQL-clients, een afzonderlijke lokale hersteltestdatabase en de private backupconfiguratie. Vergelijk bron en herstel inclusief gegevens, eigenaarschap, ACLs, RLS en extensionmetadata. Gebruik geen andere appdatabase als hersteldoel.
2. **Pas het schema en de beperkte runtime-login gecontroleerd toe.** Alleen de afzonderlijke databaseworkflow mag na het herstelbewijs migreren. De runtime-login en geheime URL-wissel vereisen daarna een onafhankelijke geverifieerde verbinding. Een beheerverbinding blijft buiten de appomgeving.
3. **Voer de normale release en acceptatie uit.** Herhaal wrapperhash, toolchain, caller/host/workspace, poort, configuratie, capaciteit, databasegate en runtimebevoegdheden. Laat de wrapper de exacte release activeren en controleer loopback én publieke health op SHA/run/configuratie. Schakel de appservice pas na succesvolle eerste health voor boot in en voer gebruikersacceptatie uit. Ruim daarna de tijdelijke root-SSH-toegang op.

De native wrapper voert repositorycode nooit als root uit. Git-archivering draait als runner; uitpakken, installatiescripts en build draaien als `build-mil-stg` in begrensde tijdelijke systemd-units zonder runtimecredentials. De roothelper kopieert en verzegelt alleen gecontroleerde standalone-output. De 23 lokale tests en bronreview bewijzen proceduregrenzen; de nieuwe hostcontrole bewijst installatie en proxy/TLS, nog geen uitgevoerde appdeployment.

## App, runtimeconfiguratie en rollback

Het concrete releasecontract is:

```text
/srv/sites/milobingo-staging/
  releases/<sha-prefix>-<run-id>-<poging>/
    .next/standalone/server.js
    .next/standalone/public/
    .next/standalone/.next/static/
    .next/standalone/drizzle/
    .runtime.env -> /etc/dg-sites/milobingo-staging.runtime.d/<release>.env
    .release.json
  current -> releases/<release>
  shared/
```

Private envbestanden staan buiten de appboom: root:root `0600` onder een root-only directory `0700`. De systemd-manager leest ze via de symlink; app, runner en build krijgen geen leesrecht op het bestand. De app krijgt alleen de expliciete runtimewaarden als procesomgeving. De unit gebruikt:

```ini
WorkingDirectory=/srv/sites/milobingo-staging/current/.next/standalone
EnvironmentFile=/srv/sites/milobingo-staging/current/.runtime.env
ExecStart=/opt/node-v24.18.0-linux-x64/bin/node /srv/sites/milobingo-staging/current/.next/standalone/server.js
```

Gebruik hier geen vast `milobingo-staging.runtime.env`: de app en zijn configuratie moeten samen wisselen bij activatie en rollback. Het standalonepakket bevat expliciet `public`, `.next/static`, `drizzle` en getraceerde `pg`/`ws`-afhankelijkheden. De appboom blijft alleen-lezen; alleen de daarvoor bestemde `shared`-map is schrijfbaar. Activeer geen algemene schrijfbare Next-cache zonder de werkelijke behoefte en het pad te testen.

De versie-1-helper maakt `current` atomisch, herstart alleen `milobingo-staging.service` en verlangt health met de volledige SHA, run-ID en configuratieversie. Bij mislukking herstelt hij een vooraf gezond bevonden vorige release met bijbehorend envbestand. Faalt ook dat, dan stopt hij de service. Bij de eerste mislukte activatie zonder gezonde voorganger stopt de service en wordt `current` verwijderd. Er is geen apart `dg-site-rollback`-commando geïmplementeerd of aangetroffen; verzin geen subcommando. Handmatig herstel blijft een gerichte beheerhandeling volgens het beoordeelde contract.

## Configuratie, backup en acceptatie

De 21 runtimekeys zijn vastgelegd in de wrapper en `scripts/deploy/release-preflight.mjs`. De build krijgt geen runtime-, migratie-, backup- of GitHub-credentials. `DATABASE_URL` van de app is een afzonderlijke beperkte login in `milo_backend`; een beheerverbinding als appruntime wordt geweigerd. `MIGRATION_DATABASE_URL` hoort uitsluitend bij databasebeheer en wordt alleen binnen die stap naar de CLI-naam `DATABASE_URL` gemapt. De publieke CA in `SUPABASE_DB_CA_BASE64` houdt databasecertificaat- en hostnaamcontrole actief.

De backuplocatie is **`/var/backups/milobingo-staging`**, niet een directory onder de app-owned `shared`-map: de app mag het backupdoel niet via een beschrijfbare oudermap kunnen vervangen. Controleer vrije bytes/inodes op die locatie én op het werkelijke PostgreSQL-herstelvolume. Een loopback-TCP-verbinding bewijst niet dat beide op hetzelfde filesystem staan.

Vóór iedere toegestane schemawijziging vereist [STAGING-DATABASE.md](STAGING-DATABASE.md) een versleutelde volledige dump en echte herstelproef, met overeenkomende gegevenschecksums, eigenaarschap, grants en RLS. Aanwezige private sleutels of een voorbereide herstelserver vervangen dit bewijs niet; ontbrekende of afwijkende verificatie blokkeert toepassing. Databasebackups omvatten geen Storage-objectbytes of volledige clusterrolconfiguratie. Bewaar die herstelpaden waar nodig afzonderlijk.

Bewaar actieve en vorige gezonde releases, hun private envbestanden en het releasegebonden herstelpunt. De wrapper verwijdert uitsluitend tijdelijke bestanden van zijn eigen poging en bewaart alle bekende releases; verdere retentie/cleanup vereist een gecontroleerd beheerpad. Een approllback draait database, Auth, Storage of providerinstellingen niet terug.

Het installatiebewijs bevat bron-SHA/CI-runs, wrapper-/helper-/toolchaindigests, unit/Caddy- en poortstatus en effectieve UID/GID/werkmap. Migratiehistorie, backup-/herstelbewijs, een actieve release en echte gebruikersacceptatie moeten afzonderlijk worden toegevoegd zodra ze zijn uitgevoerd. Health-200 bewijst geen OTP/Google, regierol, gezin/boekjes/PDF, mailbezorging of bel-/uitzendketen. Het DG-mailgateway-/outboxcontract blijft afzonderlijk aan te sluiten.
