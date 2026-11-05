# Milo staging: hostinrichting en overdracht

Staging is geautoriseerd; productie valt buiten deze opdracht. Op 5 november 2026 is de host eerst als runner en daarna met de tijdelijke beheerverbinding geïnspecteerd. Die inspecties vonden geen geïnstalleerde DG-deploywrapper of herbruikbare installatiebron. Er is daarom een nieuwe, specifiek voor Milo begrensde **native wrapper versie 1** gebouwd en beoordeeld. De bron en 23 lokale tests zijn beschikbaar; de wrapper is op dit overdrachtsmoment **nog niet geïnstalleerd**. Installatie vereist groene CI op de exacte commit die deze bron bevat. Zie [STAGING-NATIVE-WRAPPER.md](STAGING-NATIVE-WRAPPER.md) voor het volledige contract.

## Bevestigde bestemming en huidige hoststaat

De eerste runnerinspectie is [Actions-run 42051941726](https://github.com/milobingo/platform/actions/runs/42051941726). Latere rootinspectie en gerichte bootstrap bevestigen onderstaande gegevens. Een vermelding als voorbereid is geen bewijs van een actieve apprelease.

| Onderdeel | Bevestigd |
| --- | --- |
| Repository / integratiebranch / environment | `milobingo/platform`, `main`, `staging` |
| Host / besturingssysteem | `dg-nxttrack-01`, Ubuntu 24.04 |
| Tailscale-beheerhost | `100.111.66.17` |
| Tijdelijke beheerverbinding | Root-SSH werkt uitsluitend vanaf Tailscale-peer `100.79.0.26`; toegang is begrensd tot twee uur en wordt na de taak opgeruimd. |
| Staging-origin / DNS A | `https://milo-staging.dgwebservices.nl`, `128.140.93.95` op het inspectiemoment |
| Runnernaam | `dg-nxttrack-01-nxttrack-staging` |
| Runnerlabels | `self-hosted`, `Linux`, `X64`, `dg-milobingo-01`, `dg-nxttrack-01`, `milobingo`, `staging` |
| Runneraccount | `run-mil-stg`, UID `1001`, lid van `dg-build` |
| Exacte checkout | `/home/run-mil-stg/_work/platform/platform` |
| Geïsoleerd buildaccount | `build-mil-stg`, UID `990`, eigen primaire groep GID `983` |
| Appaccount / groep | `app-mil-stg`, UID `996`, GID `987` |
| Site-ID / siteroot | `milobingo-staging`, `/srv/sites/milobingo-staging`, `root:app-mil-stg` mode `0750` |
| Bestaande persistente appmap | `/srv/sites/milobingo-staging/shared`; bestaande inhoud behouden |
| Gereserveerde apppoort | `127.0.0.1:4173`, gekozen na controle van de werkelijke sockets en het lege siteregister |
| Native Node | `24.18.0`, `/opt/node-v24.18.0-linux-x64/bin/node`, officiële distributie en SHA256 gecontroleerd |
| Native pnpm | `11.25.0`, `/opt/dg-toolchains/pnpm/11.25.0/bin/pnpm`, vastgezet geïnstalleerd met uitgeschakelde installatiescripts |
| Voorbereide buildroot | `/var/lib/dg-build/milobingo-staging`, `root:build-mil-stg` mode `0710` |
| Voorbereide backuplocatie | `/var/backups/milobingo-staging`, runner-owned mode `0700`, onder een root-beheerde oudermap |
| Supabase staging | `lfsdgxcpdyghidzkzzvn`, `https://lfsdgxcpdyghidzkzzvn.supabase.co` |
| Bevestigde private bucket | `milo-staging` |

De eerste inspectie vond geen native Node/pnpm, deploywrapper, PostgreSQL-clienttools of Milo-appservice; de runner had geen sudo-bevoegdheid. Dat is de **beginsituatie**. Inmiddels zijn de hierboven genoemde Node/pnpm-toolchain, buildidentiteit, paden, poortreservering en rootprofiel voorbereid. Rootinspectie bevestigde dat `/etc/dg-sites` aanvankelijk leeg was en dat onder de beheer-/root-/optpaden geen bestaande DG-wrapperbron beschikbaar was. De interne Node van GitHub Actions is niet gebruikt als app- of native buildtoolchain.

Caddy had bij inspectie alleen zijn bestaande standaardsite op HTTP-poort 80 en een include voor sitefragmenten. Er is nog geen bewezen Milo-HTTPS-activatie. Wrapperinstallatie, beperkte sudoers-regel, Milo-service, Caddyfragment, PostgreSQL-clienttools en herstelvoorzieningen moeten vóór een echte release gecontroleerd worden afgerond. Er is nog geen hosted databasemigratie of applicatieactivatie uitgevoerd.

Het nieuwe root-only profiel `/etc/dg-sites/milobingo-staging.deploy.json`, mode `0600`, is voorbereid met dit specifieke versie-1-contract:

```json
{
  "node": "/opt/node-v24.18.0-linux-x64/bin/node",
  "pnpm": "/opt/dg-toolchains/pnpm/11.25.0/bin/pnpm",
  "port": 4173
}
```

Dit is geen aangetroffen centrale DG-standaard. De nieuwe Milo-implementatie controleert precies deze velden, toolchainpaden en eigendomsgrenzen.

## Resterende installatie

Werk uitsluitend binnen Milo staging. Behoud bestaande andere apps, runners, services, Caddyconfiguratie en gegevens. Deel geen toegangssleutels of secretwaarden in chat, Git of logs.

1. **Bevestig de exacte bron en CI.** De wrapperbron staat in `infra/staging/deploy-entry.py` en `deploy-helper.py`; lees daarnaast het [versie-1-contract](STAGING-NATIVE-WRAPPER.md). Groene CI voor een oudere TLS- of procedurecommit keurt nieuwere wrappercode niet goed. Houd volledige bron-SHA, workflow-SHA en later runtime-SHA afzonderlijk bij.
2. **Installeer de beoordeelde helper en entry.** Installeer als root onder `/usr/local/libexec/dg-milobingo-deploy-helper` en `/usr/local/bin/dg-site-deploy`. Bereken de helperdigest en render die in de entry; de ongerenderde bron met `__HELPER_SHA256__` weigert uitvoering. Alle padcomponenten en bestanden zijn root-owned en niet schrijfbaar voor runner, build of app. Leg versie, helperhash en de hash van de gerenderde entry vast. De laatste wordt `DG_DEPLOY_WRAPPER_SHA256` in GitHub environment `staging`.
3. **Verleen alleen de vaste Milo-actie.** De runner mag uitsluitend de beoordeelde helper voor de vaste site en checkout via sudo aanroepen. Gebruik de vastgelegde argumentvalidatie en waar beschikbaar een commandodigest/argumentregex. Valideer met `visudo -cf` en positieve én negatieve `sudo -n`-proeven. Geen algemene shell, `NOPASSWD: ALL`, `sudo -E`, vrije systemctl-opdracht of onbeperkte environmentdoorvoer.
4. **Controleer rootpaden en de gedeelde lock.** Bevestig siteroot, releases, afzonderlijke buildroot en `/run/lock/dg-build.lock`. De build-, runner- en app-UID/GID blijven gescheiden; het buildaccount krijgt geen aanvullende groepen. Controleer onder de lock vrije bytes en inodes voor bestaande app, bronarchief, dependencies, build, sealing en herstelpunten. De wrapper bewaart minimaal 4 GiB/50.000 inodes als marge en telt de gemeten artifactomvang daar bij het kopiëren bij op.
5. **Installeer de vaste Milo-service en het Caddyfragment.** Het bijgewerkte servicevoorbeeld bevat het bevestigde Node-binarypad en de releasegebonden envsymlink; het Caddyvoorbeeld gebruikt `127.0.0.1:4173`. Valideer de unit met `systemd-analyze verify` en de volledige actieve Caddyconfiguratie met `caddy validate`. Integreer uitsluitend het Milo-fragment via de bestaande include en controleer publieke DNS/TLS. De app luistert niet rechtstreeks op een publiek adres of op 80/443.
6. **Rond databasebeheer en herstel af.** Gebruik de readonly-audit om de werkelijke PostgreSQL-versie, tabellen, historie, privileges en bucket te leren kennen. Lever daarna passende `psql`, `pg_dump` en `pg_restore`, een afzonderlijke lege lokale hersteltestdatabase en een aparte backupencryptiesleutel. De database-/rolstaat is na de eerste TLS-fout nog onbekend. Gebruik nooit een andere appdatabase als hersteldoel.
7. **Herhaal de releasepreflight.** Pas bij overeenkomende wrapperhash, toolchain, caller/host/workspace, poort, configuratie, capaciteit, databasegate en runtimebevoegdheden mag het normale releasepad activeren. De tijdelijke root-SSH-toegang wordt na afronding verwijderd; de workflow gebruikt de beperkte runneractie.

De native wrapper voert repositorycode nooit als root uit. Git-archivering draait als runner; uitpakken, installatiescripts en build draaien als `build-mil-stg` in begrensde tijdelijke systemd-units zonder runtimecredentials. De roothelper kopieert en verzegelt alleen gecontroleerde standalone-output. De 23 lokale tests en onafhankelijke bronreview bewijzen deze lokale proceduregrenzen, geen uitgevoerde hostdeployment.

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

Vóór iedere toegestane schemawijziging vereist [STAGING-DATABASE.md](STAGING-DATABASE.md) een versleutelde volledige dump en echte herstelproef, met overeenkomende gegevenschecksums, eigenaarschap, grants en RLS. De backupkey en herstelverbinding zijn nog niet aangeleverd; ontbrekende waarden blokkeren toepassing. Databasebackups omvatten geen Storage-objectbytes of volledige clusterrolconfiguratie. Bewaar die herstelpaden waar nodig afzonderlijk.

Bewaar actieve en vorige gezonde releases, hun private envbestanden en het releasegebonden herstelpunt. De wrapper verwijdert uitsluitend tijdelijke bestanden van zijn eigen poging en bewaart alle bekende releases; verdere retentie/cleanup vereist een gecontroleerd beheerpad. Een approllback draait database, Auth, Storage of providerinstellingen niet terug.

Lever na de echte installatie terug: volledige bron-SHA/CI-run, wrapper-/helper-/toolchaindigests, unit/Caddy- en poortbewijs, effectieve UID/GID/werkmap, allowlists/configuratieversie, migratiehistorie en backup-/herstelbewijs. Na activatie volgen de publieke nacontrole en echte gebruikersacceptatie. Health-200 bewijst geen OTP/Google, regierol, gezin/boekjes/PDF, mailbezorging of bel-/uitzendketen. Het DG-mailgateway-/outboxcontract blijft afzonderlijk aan te sluiten.
