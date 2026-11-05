# Milo staging native wrapper, versie 1

Deze implementatie is specifiek voor Milo staging. Op 5 november 2026 is via de beheerverbinding vastgesteld dat de host geen bestaande DG-wrapper of installatiebron bevatte. Ook de lokale repositories en toegankelijke GitHub-repositories leverden uitsluitend verwijzingen op. Deze bron is daarom een nieuwe, begrensde implementatie; geen kopie van een aangetroffen centrale DG-standaard.

De bronbestanden installeren niets. Installatie volgt pas na bronreview, geslaagde CI en controle van de werkelijke host. Productie valt buiten deze procedure.

## Vaste grens

| Onderdeel | Waarde |
| --- | --- |
| Host | `dg-nxttrack-01` |
| Site | `milobingo-staging` |
| Runner | `run-mil-stg`, UID 1001 |
| Buildaccount | `build-mil-stg`, UID 990, eigen primaire groep GID 983 |
| Appaccount | `app-mil-stg`, UID 996, primaire groep GID 987 |
| Checkout | `/home/run-mil-stg/_work/platform/platform` |
| Sitepad | `/srv/sites/milobingo-staging` |
| Service | `milobingo-staging.service` |
| Bevestigde loopbackpoort | `127.0.0.1:4173` |
| Publieke origin | `https://milo-staging.dgwebservices.nl` |

De entry behoudt de vier bestaande argumenten:

```text
/usr/local/bin/dg-site-deploy milobingo-staging <vaste-checkout> <volledige-SHA> <run-ID>-<poging>
```

`deploy-entry.py` draait zonder Python-zoekpaden uit de omgeving (`-I`), controleert host/caller/argumenten en de ingestelde helperhash, en geeft uitsluitend de 21 beoordeelde runtimevariabelen als begrensde JSON via stdin door. De sudo-aanroep krijgt een lege, vaste procesomgeving. Migratie-, backup-, restore- en GitHub-credentials worden niet doorgegeven. De bron bevat nog `__HELPER_SHA256__`; een ongerenderde entry weigert uitvoering.

`deploy-helper.py` herhaalt de vier argumentcontroles, sudo-identiteit en hostcontrole. De helper accepteert geen vrij shellcommando, pad, poort of servicenaam. De enige rootconfiguratie is `/etc/dg-sites/milobingo-staging.deploy.json`, root:root `0600`, met precies deze velden:

```json
{
  "node": "/opt/node-v24.18.0-linux-x64/bin/node",
  "pnpm": "/opt/dg-toolchains/pnpm/11.25.0/bin/pnpm",
  "port": 4173
}
```

Alle padcomponenten en symlinkdoelen van de toolchain moeten van root zijn en mogen niet door groep/anderen worden gewijzigd. De helper controleert Node `24.18.0` en pnpm `11.25.0` binnen het geïsoleerde buildaccount.

## Build en sealing

De globale `/run/lock/dg-build.lock` voorkomt gelijktijdige native builds. Een bestaand root:dg-build `0660` lockbestand is toegestaan in de root-owned sticky lockdirectory; symlinks en hardlinks worden geweigerd. Vooraf blijven minimaal 4 GiB en 50.000 vrije inodes beschikbaar op build- en sitefilesystem. Voor het kopiëren komt de gemeten artifactomvang daar bovenop.

De helper laat Git als runner uitsluitend `HEAD` controleren en `git archive` voor de exacte goedgekeurde SHA uitvoeren. De tar wordt nooit als root uitgepakt. Uitpakken, versiecontroles, de vergrendelde installatie en alle repositorycode/lifecycle-scripts draaien als `build-mil-stg` in tijdelijke systemd-units, met `env -i`, een eigen tijdelijk HOME, `ProtectHome`, `ProtectSystem`, een beperkt schrijfpad, `NoNewPrivileges` en een eigen cgroup. Elke unit heeft een maximale looptijd. Bij beëindiging ruimt systemd ook achtergrondprocessen uit die cgroup op. Het buildaccount heeft geen runner-/appgroepen en krijgt geen runtimecredentials.

De tijdelijke build staat onder `/var/lib/dg-build/milobingo-staging`, root:build-mil-stg `0710`. De helper kopieert uitsluitend `.next/standalone`, inclusief de vooraf door het project verpakte `public`, `.next/static` en `drizzle`. De kopie loopt via vastgehouden directorydescriptors met `O_NOFOLLOW`; bestanden moeten regulier zijn en één link hebben. Speciale bestanden, omgevingsbestanden, externe/absolute links en linkcycli worden geweigerd. Interne relatieve pnpm-links blijven geldig. De output wordt root:app-mil-stg, directories `0550`, bestanden `0440` of `0550` voor uitvoerbare bestanden.

Tijdens die kopie wordt een SHA-256 berekend over gesorteerde namen, bestandstypen, inhoud, uitvoerbaarheid en symlinkdoelen. De root-only `.release.json` bevat deze digest, volledige commit-SHA, run-ID, configuratieversie, poort, helperdigest en toolchainversies/binarydigests. Dit is een versie-1-inventarisdigest, geen tarbestanddigest.

## Runtime en activatie

Runtimewaarden worden afzonderlijk opgeslagen in `/etc/dg-sites/milobingo-staging.runtime.d/<release>.env`, directory root:root `0700`, bestand root:root `0600`. De release bevat alleen een door root gemaakte `.runtime.env`-symlink naar dit bestand. De runtimewaarden komen daardoor niet in een releasearchief van de appboom terecht. De helper controleert dezelfde 21 sleutelnamen als de workflow, exacte stagingorigin/project/bucket, keytypen, metadata, de vastgelegde poort en geverifieerde database-TLS zonder query-overrides voor host/account/TLS.

De systemd-unit moet deze combinatie gebruiken:

```ini
WorkingDirectory=/srv/sites/milobingo-staging/current/.next/standalone
EnvironmentFile=/srv/sites/milobingo-staging/current/.runtime.env
ExecStart=/opt/node-v24.18.0-linux-x64/bin/node /srv/sites/milobingo-staging/current/.next/standalone/server.js
```

De app en bijbehorende runtimeconfiguratie wisselen samen via één atomische `current`-symlink. De helper herstart uitsluitend `milobingo-staging.service` en controleert loopback-health op de exacte SHA, run-ID en configuratieversie. Bij mislukking herstelt hij een vooraf gezond bevonden vorige release met bijbehorend envbestand. Mislukt ook die healthcontrole, of bestaat geen gezonde voorganger, dan stopt hij de Milo-service. De eerste mislukte activatie verwijdert `current`. De helper schakelt de service niet zelfstandig voor boot in; de beheerder kan dat na een geslaagde eerste healthcontrole doen.

Alle bekende releases en bijbehorende private envbestanden blijven behouden. Zodra twee releases bestaan, blijven er dus minimaal twee beschikbaar. De helper verwijdert geen onbekende releases, backups of andere sites. Tijdelijke buildbestanden van zijn eigen poging worden opgeruimd. Backups blijven buiten deze helper onder `/var/backups/milobingo-staging`.

De appboom is tijdens runtime alleen-lezen. De huidige app gebruikt externe PostgreSQL/private-objectopslag en gebundelde assets. Er is geen algemene schrijfbare Next-cache toegevoegd; controleer het echte stagingverkeer op cachefouten voordat extra cachefunctionaliteit wordt geactiveerd.

## Installatie en bewijs

De beheerder controleert eerst de volledige bron en de CI voor dezelfde commit. Installeer de helper root-owned onder `/usr/local/libexec/dg-milobingo-deploy-helper`, bereken de helper-SHA-256 en render alleen die digest in de entry. Installeer de entry root-owned onder `/usr/local/bin/dg-site-deploy` en stel de hash van die gerenderde entry in als GitHub-stagingvariabele `DG_DEPLOY_WRAPPER_SHA256`. Houd ook de helperhash vast in het installatiebewijs. Een helperwijziging vereist herreview, nieuwe entry/hash en hernieuwde CI; blind vervangen verbreekt de entrycontrole.

De sudoers-regel mag uitsluitend `run-mil-stg` toegang geven tot die root-owned helper, met de vaste site/workspace en beperkte SHA/run-argumenten. Geen algemene shell, `sudo -E`, `env_keep` voor runtimewaarden, algemene systemctl-rechten of schrijfbare rootconfiguratie. Gebruik waar ondersteund een sudoers-commandodigest en argumentregex; valideer de daadwerkelijke regel met `visudo -cf` en positieve/negatieve `sudo -n`-proeven. De helper herhaalt de argumentvalidatie onafhankelijk van sudoers.

De bestaande GitHub-deployworkflow levert vooraf het exacte eigen main/CI-bewijs en de database-/least-privilegecontroles. De helper krijgt geen GitHub-token en voert die externe CI-gate niet opnieuw uit. Hij bevestigt onafhankelijk de checkout-HEAD en archive-SHA. Publieke HTTPS-health, demoassets, anonieme autorisatie en uitgeschakelde lokale login blijven de controle na activatie in de workflow.

Lokaal:

```bash
python3 -B tests/check-native-deployer.py
```

De 23 offline tests controleren onder andere werkelijke tar-padontsnappingen, speciale/hardlinked bestanden, externe/indirecte symlinks, een bestand dat vlak vóór openen door een externe symlink wordt vervangen, build-omgevingsisolatie, uitsluitend runtime-JSON via sudo-stdin, exclusieve private envbestanden, de inhoudsdigest, runtime/TLS-grenzen, capaciteit en activatie/rollback met geïnjecteerde servicecallbacks. Hiervoor worden geen sudo, systemd, hostdeploy of providerdiensten gebruikt. Eigendomswijzigingen zijn alleen in de lokale copyfixtures vervangen; `O_NOFOLLOW`, echte bestandssysteemaanvallen en readonly-modi worden daadwerkelijk uitgevoerd. Daarnaast zijn alle 37 symlinks van het bestaande lokale standalone-artifact descriptorgewijs gecontroleerd: 3.079 entries, 289.006.296 reguliere bestandsbytes; geen wijzigingen.

Bewaar bij de eerste echte deploy de CI-run, bron-SHA, gerenderde entry/helperhashes, rootprofiel zonder secrets, release-inventarisdigest, loopback- en publieke healthidentiteit en controle van service-eigenaar/loopbackbinding. Offline tests vervangen dit hostbewijs niet.

## Eenmalige private credentialoverdracht

`staging-credentials.yml` is uitsluitend een handmatige bootstrapstap voor de bestaande stagingsecrets. Dezelfde eigen main/CI-gate, stagingomgeving, runneridentiteit en gedeelde deploymentconcurrency gelden. Na checkout van de exacte goedgekeurde SHA schrijft `prepare-credentials.mjs` alleen `DATABASE_URL` en `SUPABASE_SECRET_KEY` naar `/var/backups/milobingo-staging/bootstrap-inputs.json`, zonder providerverzoeken of databasewijzigingen. De root-owned bovenliggende directories mogen niet schrijfbaar zijn voor andere accounts; de uiteindelijke directory is van de runner en `0700`. Een vastgehouden directorydescriptor, `O_EXCL` en `O_NOFOLLOW` voorkomen padvervanging en overschrijven. Het JSON-bestand is begrensd en `0600`.

De bevoegde rootbootstrap consumeert dit bestand pas na de geslaagde workflow, gebruikt het voor de afzonderlijke migratieverbinding en de afgeleide beperkte runtimeverbinding, en verwijdert het onmiddellijk na gebruik. Controleer vervolgens alleen dat het bestand afwezig is. Publiceer de inhoud nooit in chat, logs, artifacts of Git. Deze stap maakt geen extra account of credential aan en wijzigt zelf geen GitHub-secrets.
