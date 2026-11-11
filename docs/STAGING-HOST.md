# Milo staging: hostinrichting en overdracht

Sinds 11 november 2026 gebruikt staging de [beschermde deploybroker](BESCHERMDE-CONFIGURATIE.md). De oude directe sudo-bevoegdheid voor de legacywrapper is ingetrokken; die helper blijft intern als vastgepinde library aanwezig. De appunit en Caddy-route blijven behouden. Gebruik voor volgende releases [STAGING-DEPLOY.md](STAGING-DEPLOY.md) en voor de actuele release [STAGING-RESULTAAT.md](STAGING-RESULTAAT.md).

De rest van dit document bewaart de historische bootstrap en controles van 5 november. Genoemde GitHub-secrets, sudo-grants en installatiecommando's beschrijven die toenmalige situatie; voer ze niet opnieuw uit als actuele configuratieprocedure. Productie heeft een [afzonderlijke procedure](PRODUCTIE-DEPLOY.md).

## Uitgevoerde database- en runtimecontroles

De [databaseapply 42073060158](https://github.com/milobingo/platform/actions/runs/42073060158) voor bron `10a9c351fb9c7e501ff9996291518bedb8ed7c8d` is geslaagd na de eigen groene CI. Vóór de schemawijziging is de volledige versleutelde Supabase-backup werkelijk hersteld en vergeleken, inclusief gegevens, eigenaarschap, grants, RLS, eventtriggers en extensiemetadata. Daarna zijn de 18 applicatietabellen en checksumhistorie atomair aangebracht; `pending` is leeg. Het [herstelbewijs](../verification/staging-restore-proof.json), [applybewijs](../verification/staging-database-apply.json) en [offhost-escrowbewijs](../verification/staging-backup-escrow.json) registreren deze uitvoering zonder secretwaarden. Versleutelde dump, metadata en sleutelherstelpad zijn buiten de deploymenthost veiliggesteld.

De [runtimebootstrap 42073332963](https://github.com/milobingo/platform/actions/runs/42073332963) heeft de beperkte login gecommit, waarna de nieuwe poolerverbinding authenticatiefout `28P01` gaf. De private overdracht bleef behouden. Onafhankelijke readonly-verificatie heeft de directe IPv6-projectverbinding met **hetzelfde wachtwoord** geverifieerd: werkelijk geautoriseerde TLS, hostnaamcontrole, uitsluitend `milo_backend` als lidmaatschap, geen beheer-/bypassrechten en toegang tot alle 18 tabellen. De oorspronkelijke beheerlogin is met hetzelfde oorspronkelijke wachtwoord eveneens rechtstreeks via geverifieerde TLS gecontroleerd. Er is geen wachtwoordreset of extra rolgrant uitgevoerd. Zowel het GitHub-appsecret `DATABASE_URL` als `MIGRATION_DATABASE_URL` gebruikt nu de directe projecthost op poort 5432, elk met de eigen rol. Zie [runtimebewijs](../verification/staging-runtime-verification.json).

De [backendacceptatie](../verification/staging-backend-acceptance.json) heeft met de echte beperkte login CRUD en rollback op een unieke gezinsrij gecontroleerd. Roltoekenning, schema-aanmaak en lezen van migratiehistorie zijn daadwerkelijk geweigerd met `42501`. Een privé JSON-object is opgeslagen, teruggelezen, anoniem geweigerd en verwijderd met bevestigde afwezigheid. De tijdelijke scratchserver, verbindingstunnel en `RESTORE_TEST_DATABASE_URL` zijn na de bewijsveiligstelling verwijderd; zie [cleanupbewijs](../verification/staging-scratch-cleanup.json). Een nieuwe muterende migratie vereist een nieuwe afzonderlijke lege herstelomgeving.

De [native deploy 42076441650](https://github.com/milobingo/platform/actions/runs/42076441650) is volledig geslaagd voor bron `985ed0d8aeac3ef7f7b2960d0a03a047e8a1d161`, na [eigen groene CI 42075300318](https://github.com/milobingo/platform/actions/runs/42075300318). Zowel `release-gate`, `deploy` als `verify-public` zijn geslaagd: publieke HTTPS-health met exacte release-identiteit, demoassets, anonieme toegangsgrenzen en uitgeschakelde lokale ontwikkelaanmelding. De [backendacceptatie](../verification/staging-backend-acceptance.json) is om 17:37 UTC opnieuw op deze actieve bron uitgevoerd, inclusief bevestigde cleanup. Ook de [acht publieke browsertests](../verification/staging-browser-tests.json) zijn geslaagd, inclusief mobiele demoweergave en toegangsgrenzen. Echte account-, mail-, provider- en showacceptatie blijven afzonderlijke stappen.

Het [actieve hostbewijs](../verification/staging-release.json) bevestigt na de laatste deployment release-ID `42076441650-1`, configuratie `staging-2026-11-05-v1`, service `active/running` en `enabled`, werkelijk proces-UID `996`/GID `987` en uitsluitend listener `127.0.0.1:4173`. Het [publieke bewijs](../verification/staging-public.json) bevestigt health en anonieme sessie met HTTP `200`, geconfigureerde Auth zonder lokale login, afwijzing van een vreemde origin met `403`, vervalste identiteit met `401` en lokale login met `403` zonder sessiecookie.

Een [werkelijke handmatige hersteloefening](../verification/staging-recovery.json) heeft onder de geïnstalleerde helper en build-lock de eerdere volledig geslaagde release `42075923621-1` met het bijbehorende private envbestand geactiveerd en exact gezond bevonden. Daarna is de laatste release `42076441650-1` met zijn eigen envbestand teruggezet en opnieuw exact gezond bevonden. Beide releases hebben bron `985ed0d8aeac3ef7f7b2960d0a03a047e8a1d161`. Runtimewaarden zijn daarbij niet uitgelezen. Dit is een handmatige oefening met gekoppelde app/configuratie; automatische fout-rollback en databaseherstel zijn hierbij niet geïnjecteerd of uitgevoerd.

De [definitieve toegangscleanup](../verification/staging-access-cleanup.json) is op 5 november om 17:41:04 UTC uitgevoerd: de taakgebonden rootuitzondering, de beheersleutel en de opruimtimer zijn verwijderd of gestopt; nieuwe logins met beide tijdelijke sleutels zijn geweigerd. Lokale sleutels, private bootstrapkopieën, de oude pooleroverdracht en diagnostische logs zijn verwijderd. Actieve release-envbestanden, versleutelde backups en het private escrow-/sleutelherstelpad zijn behouden met de vereiste bestandsrechten. De [publieke nacontrole na intrekking](../verification/staging-public.json) is om 17:41:05 UTC opnieuw geslaagd.

## Historische bootstrapinventaris — 5 november 2026, 16:27:48 UTC

De [onafhankelijke hostcontrole](../verification/staging-host.json) legde onderstaande installatiegegevens vast vóór de eerste appactivatie. De toenmalige `inactive`-, ontbrekende `current`- en HTTP `502`-regels zijn historische waarnemingen en beschrijven niet de huidige appstatus. De controle bevat uitsluitend openbare configuratie, hashes, bestandsrechten en service-/socketmetadata. De eerste runnerinspectie is [Actions-run 42051941726](https://github.com/milobingo/platform/actions/runs/42051941726).

| Onderdeel | Vastgelegd bij bootstrap |
| --- | --- |
| Repository / integratiebranch / environment | `milobingo/platform`, `main`, `staging` |
| Host / besturingssysteem | `dg-nxttrack-01`, Ubuntu 24.04 |
| Tailscale-beheerhost | `100.111.66.17` |
| Tijdelijke beheerverbinding bij bootstrap | De taakgebonden toegang vanaf Tailscale-peer `100.79.0.26` is om 17:41 UTC ingetrokken. Rootuitzondering, beheersleutel en timer zijn verwijderd; beide nieuwe sleutel-logins zijn geweigerd. Zie [toegangscleanup](../verification/staging-access-cleanup.json). |
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
| Milo-appservice bij historische inspectie | `milobingo-staging.service`, toen geladen maar `inactive/dead`, `disabled`, `MainPID=0`; account `app-mil-stg` |
| Caddy / HTTPS bij historische inspectie | Caddy actief; poort `443` luisterde; publieke TLS-controle geslaagd, toen HTTP `502` zonder app-upstream |
| Apprelease bij historische inspectie | `current` ontbrak en poort `4173` luisterde toen niet; latere native activatie staat hierboven |
| Supabase staging | `lfsdgxcpdyghidzkzzvn`, `https://lfsdgxcpdyghidzkzzvn.supabase.co` |
| Bevestigde private bucket | `milo-staging` |

De eerste inspectie vond geen native Node/pnpm, deploywrapper, PostgreSQL-clienttools of Milo-appservice; de runner had geen sudo-bevoegdheid. Dat is de **beginsituatie**. Rootinspectie vond evenmin een herbruikbare DG-wrapperbron. De nieuwe Milo-implementatie en bovenstaande hostvoorzieningen zijn inmiddels geïnstalleerd. De interne Node van GitHub Actions wordt niet als app- of native buildtoolchain gebruikt.

Caddy importeert het Milo-fragment via de bestaande `/etc/caddy/sites/*.caddy`-include. De historische HTTP `502` bevestigde op dat moment proxy/TLS zonder app-upstream. De bootstrapcontrole zelf voerde geen databaseverbinding, migratie, helperaanroep of gebruikersacceptatie uit; die latere controles hebben hun eigen bewijs.

De productiegrens tussen Caddy en Next standalone is expliciet begrensd. Next kan `Request.url` opbouwen met de interne listener `127.0.0.1:4173`, ook wanneer de publieke `Host` behouden is. De Node-adapter mag die interne origin uitsluitend vervangen door de vooraf geconfigureerde HTTPS-`APP_URL` wanneer productie draait met `HOSTNAME=127.0.0.1`, de interne host en poort exact met `HOSTNAME`/`PORT` overeenkomen, zowel `Host` als `X-Forwarded-Host` exact de geconfigureerde publieke host bevatten en `X-Forwarded-Proto` exact `https` is. De forwarded headers kiezen zelf geen origin. Oorspronkelijke `Origin`- en `Sec-Fetch-Site`-headers blijven behouden en worden door de bestaande same-origincontrole beoordeeld.

Caddy moet daarom de publieke `Host` doorgeven en de proxyheaders zelf zetten of overschrijven; door een client aangeleverde forwarded headers mogen deze grens niet bepalen. De app luistert uitsluitend op loopback, niet op een publiek interface. Een andere bindhost, poort of proxyheader geeft geen toestemming om te canoniseren. Deze voorwaarden zijn onderdeel van het runtimecontract, geen algemene toestemming om forwarded headers te vertrouwen.

Het geïnstalleerde root-only profiel `/etc/dg-sites/milobingo-staging.deploy.json`, mode `0600`, heeft precies dit openbare versie-1-contract:

```json
{
  "node": "/opt/node-v24.18.0-linux-x64/bin/node",
  "pnpm": "/opt/dg-toolchains/pnpm/11.25.0/bin/pnpm",
  "port": 4173
}
```

Dit is geen aangetroffen centrale DG-standaard. De nieuwe Milo-implementatie controleert precies deze velden, toolchainpaden en eigendomsgrenzen.

## Installatiebewijs en proceduregrenzen

Werk uitsluitend binnen Milo staging. Behoud bestaande andere apps, runners, services, Caddyconfiguratie en gegevens. Deel geen toegangssleutels of secretwaarden in chat, Git of logs.

De geïnstalleerde wrapperbron hoort bij commit `06ea22275661cb0c5edd2c1352737b377573d1b5`, met [geslaagde CI 42062188288](https://github.com/milobingo/platform/actions/runs/42062188288). Iedere latere release vereist eigen geslaagde CI voor precies die bron; installatiebewijs keurt geen nieuwere bron goed.

| Geïnstalleerd bestand | SHA-256 |
| --- | --- |
| Entry | `aee3e1e2e76f05d99f668ed7c756802da82033c4983216b90d7ea50de9f49bc7` |
| Helper | `ce93bfeffa573616394d1f28dc5dd101bc7e0ce076b7bf25b35a38827ed9aba8` |

Alle gecontroleerde installatiebestanden zijn root-owned en niet schrijfbaar voor runner, build of app. De sudoers-regel gebruikt de helperdigest en een vaste argumentgrens. Alleen de policy voor de juiste Milo-helper/site/checkout/SHA/run-combinatie is toegestaan; een andere site, checkout, ongeldige SHA, extra argument, rootshell en directe systemctl-aanroep zijn geweigerd. Deze oorspronkelijke policyproeven waren uitsluitend `sudo -l`-controles; ze voerden de helper niet uit. De latere native deployment is afzonderlijk geregistreerd.

Een aanvullende [negatieve rookproef om 16:55:42 UTC](../verification/staging-wrapper-denial.json) heeft de geïnstalleerde entry als runner daadwerkelijk aangeroepen met nul runtimekeys en zonder credentials. De helper weigerde met exitcode `1` en de verwachte generieke foutmelding. `current` bleef afwezig en de appservice bleef `inactive/dead`, `MainPID=0`. Dit bevestigt de entry-/sudo-/helperketen; de generieke fout onderscheidt geen afzonderlijke interne caller-, profiel- of runtimevalidatiestap en bewijst geen succesvolle deployment.

Siteroot en `releases` zijn `root:app-mil-stg 0750`; de externe runtime-envdirectory is `root:root 0700`. De globale lock is `root:dg-build 0660`. De geïnstalleerde appunit heeft de verwachte appidentiteit, werkmap, readonly filesystem en uitsluitend `shared` als expliciet schrijfpad. De unit en het Caddyfragment hebben dezelfde hashes als de beoordeelde bronvoorbeelden.

Voor de eerste bootstrap zijn het databaseherstelbewijs, de schema-aanmaak en de onafhankelijke runtimecontrole inmiddels uitgevoerd. Voor iedere volgende release blijven wrapperhash, toolchain, caller/host/workspace, poort, configuratie, capaciteit, databasegate en runtimebevoegdheden verplicht. De publieke release-identiteit, anonieme autorisatie en gebruikersacceptatie blijven afzonderlijke gates. Schakel de appservice pas na geslaagde eerste health voor boot in en registreer de feitelijke status in het resultaatdocument. De tijdelijke root-SSH-toegang is na deze taak ingetrokken en gecontroleerd; gewone releases gebruiken de beperkte runneractie.

De native wrapper voert repositorycode nooit als root uit. Git-archivering draait als runner; uitpakken, installatiescripts en build draaien als `build-mil-stg` in begrensde tijdelijke systemd-units zonder runtimecredentials. De roothelper kopieert en verzegelt alleen gecontroleerde standalone-output. De 23 lokale tests en bronreview bewijzen proceduregrenzen; het historische hostbewijs bewijst installatie en proxy/TLS. De uitgevoerde native deployment en geslaagde publieke gate hebben afzonderlijke workflowregistraties.

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

Het installatiebewijs bevat bron-SHA/CI-runs, wrapper-/helper-/toolchaindigests, unit/Caddy- en poortstatus en effectieve UID/GID/werkmap. Migratiehistorie, backup-/herstelbewijs, runtime- en backendacceptatie zijn afzonderlijk geregistreerd. Actuele publieke releaseacceptatie en echte gebruikersacceptatie staan in het resultaatdocument. Health-200 bewijst geen OTP/Google, regierol, gezin/boekjes/PDF, mailbezorging of bel-/uitzendketen. Het DG-mailgateway-/outboxcontract blijft afzonderlijk aan te sluiten.
