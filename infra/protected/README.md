# Milo: beschermde configuratie op de doel-VPS

Deze aparte broker vervangt voor gewone stagingreleases de overdracht van
GitHub-runtimegeheimen. De bestaande `/usr/local/bin/dg-site-deploy`, legacyhelper,
appunit, Caddy-configuratie en bekende releases blijven intact. Renderen is geen
installatiebewijs; vrijgave vereist CI, bronreview en afzonderlijke hostcontrole.

## Vaste interface

```text
/usr/local/bin/dg-milo-deploy deploy <40-tekens-SHA> <run-id>-<poging> <config_id>
stdin: {"githubToken":"<tijdelijk ingebouwd GITHUB_TOKEN>"}
```

Alleen deze operatie is toegestaan. Site `milobingo-staging`, host
`dg-nxttrack-01`, repository `milobingo/platform`, branch `main`, accounts
`run-mil-stg` / `build-mil-stg` / `app-mil-stg`, apppoort `4173` en service
`milobingo-staging.service` liggen vast in de geïnstalleerde bron. Er is geen
invoer voor shellcommando, repository, pad, service, poort of doelomgeving.

SHA gebruikt uitsluitend veertig kleine hextekens. Een configuratie-ID begint
alfanumeriek, bevat daarna alleen letters/cijfers/punt/underscore/koppelteken en
telt maximaal 96 tekens. Alleen root-goedgekeurde IDs worden geaccepteerd.
Een lockconflict geeft exitcode `75`; alleen die fout mag begrensd opnieuw worden
geprobeerd. Overige fouten worden niet automatisch herhaald.

## Root-only bundel

```text
/etc/dg-sites/milobingo-staging/
  protected-deploy.json                 root:root 0600
  configs/                             root:root 0700
    <config_id>/                       root:root 0700
      runtime.json                     root:root 0600
```

`runtime.json` is een gewoon JSON-object met strings. Het bevat de bestaande
`APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_STORAGE_BUCKET`, `SUPABASE_DB_CA_BASE64`, `DATABASE_URL`,
`SUPABASE_SECRET_KEY` en **de bestaande ongewijzigde** `VLAMPIE_SETTINGS_KEY`.
Optionele bestaande OpenAI-/LiveKit-fallbackwaarden mogen behouden blijven.
Providergegevens kunnen daarna via de versleutelde beheerinstellingen worden
beheerd; een providerkey is geen voorwaarde voor een infrastructuurdeploy.

Er staan geen afgeleide releasewaarden, GitHub-/SSH-/migratie-/backupcredentials,
`NODE_OPTIONS`, Resend-key of mailmodus in deze bundel. De broker genereert
release-identiteit, configuratieversie, loopbackpoort en productieruntime zelf.
`MAIL_ENVIRONMENT=staging` ligt vast; de beheeromgeving bepaalt de toegestane
mailmodus en ontvangerlijst. De staginggrens mag live verzending niet toelaten.

Seed de eerste bundel intern uit het bestaande beschermde actieve envbestand,
zonder waarden naar chat, Git of logs te schrijven en zonder shell-`source`.
Gebruik een nieuw configuratie-ID voor wijzigingen. Overschrijf een gebruikt
ID niet: de broker legt bundel- en runtimehashes per release vast. Bewaar bundels
die voor de actieve of een benodigde vorige release nodig zijn. Roteer de
encryptiesleutel alleen via een afzonderlijke gecontroleerde herencryptie.

## Bronnen en installatie

`render-deployer.py` maakt uitsluitend een nieuwe lokale reviewmap:

```sh
python3 -B infra/protected/render-deployer.py \
  --output=/tmp/milo-protected-review \
  --config-id='<bestaand-goedgekeurd-ID>' \
  --accounts-json='<bestand-met-gecontroleerde-uid-gid-metadata>'
```

Het accountbestand bevat precies de drie vaste accountnamen, elk met de echte
positieve `uid` en `gid`; geen credentials. Ontbrekende accountmetadata of
configuratie-IDs laten `policyComplete=false`. De helper weigert een incompleet
beleid. Het manifest pint iedere gerenderde executable, gate, extractor,
lockhouder, sudoersregel en policy. Het bestaande legacybestand is alleen een
ongewijzigde dependency met SHA-256
`ce93bfeffa573616394d1f28dc5dd101bc7e0ce076b7bf25b35a38827ed9aba8`.

Alle geïnstalleerde code en padcomponenten blijven root-owned en niet schrijfbaar
voor runner, build, app, groep of anderen. De beperkte sudoersregel pint de
helperdigest en vaste argumenten met `NOSETENV`. Controleer de gerenderde policy,
werkelijke identiteiten, bestanden, hashes en sudoers met een digest-ondersteunende
`visudo` voordat de workflow de nieuwe entry gebruikt. Geef de runner geen
algemene sudo-, systemctl-, installatie- of Caddy-rechten.

## Release- en herstelgrens

De runner checkt geen applicatiecode uit. De root-owned gate controleert zelfstandig
repository, main-afstamming, volledige SHA, de nieuwste eigen `ci.yml`-run en diens
geslaagde `verify`-job plus de werkelijke lopende handmatige deployworkflowpoging.
GitHub publiceert dispatchinputs niet via het runbewijs: dit is geen cryptografisch
bewijs van het SHA-inputveld; kandidaat-SHA en CI worden afzonderlijk gecontroleerd.
Alleen HTTPS naar de vaste GitHub-/codeload-hosts en het exacte bronarchief is
toegestaan. Het token gaat niet naar de bronbuild, appomgeving of schijfconfiguratie.

Extractie, toolchaincontrole, `pnpm install --frozen-lockfile` en `pnpm build` lopen
als `build-mil-stg` in begrensde systemd-units met schone omgeving. Zij krijgen geen
runtime-, database-, provider- of GitHub-geheimen. De onveranderde legacyprimitieven
verzegelen uitsluitend veilige reguliere output en interne relatieve symlinks.

Vóór activeren draait de CI-goedgekeurde artifact-audit
`.next/standalone/.milo/runtime-audit.mjs` als `app-mil-stg`. PID1 leest daarvoor
het root-only per-release envbestand via `EnvironmentFile`; credentialwaarden
staan niet in commandoargumenten. De audit mag alleen echte backend-/Storage-
reads uitvoeren en veilige status-JSON tonen; geen providercontact of writes.
Een mislukte audit laat `current` en de bestaande appservice ongemoeid.

Het bestaande layout blijft:

```text
releases/<sha-prefix>-<run-id>-<poging>/.next/standalone/
releases/<release>/.runtime.env -> /etc/dg-sites/milobingo-staging.runtime.d/<release>.env
releases/<release>/.release.json      # ongewijzigd v1-contract
releases/<release>/.protected.json    # bundel/runtime/broker/CI-bewijs
current -> releases/<release>
```

App en runtimeconfiguratie wisselen samen. De legacyactivatie herstelt een vooraf
gezonde voorganger met diens eigen configuratie wanneer de kandidaat faalt; faalt
ook herstel, dan stopt alleen de Milo-service. Geen database-/Storage-/Auth- of
providerinstelling wordt door een approllback teruggedraaid. Bekende releases en
private runtimebestanden worden niet automatisch verwijderd. Een afzonderlijk
runnerrollbackcommando is bewust niet toegevoegd; gericht beheerherstel blijft
beschikbaar onder de bestaande gecontroleerde procedure.

## Hostbrede lock en afbreken

De broker houdt de bestaande `/run/lock/dg-build.lock` én een eigen
`milobingo-staging.deploy.lock` vast. Dartflow blijft dezelfde globale lock
gebruiken. De onafhankelijke root-lockhouder ontvangt beide bestaande open-file
descriptions via systemd `--pipe`, bewaakt de helper via `pidfd` en stopt bij
helperdood uitsluitend de vijf eigen buildfasen plus de eigen read-only auditunit.
Hij wacht tevens totdat de exacte Milo-servicejob is afgerond. Privéwaarden en
tokens bereiken de lockhouder niet.

Vertrouwde `systemd-run --wait`- en synchrone `systemctl`-clients behouden beide
lockdescriptors via `pass_fds`; build/appunits krijgen deze descriptors niet via
D-Bus. Dit vereist de gecontroleerde systemd-v255-semantiek. Onzekere cleanup houdt
de locks vast en vraagt gericht rootherstel. Verwijder of vervang lockbestanden
nooit. Hard beëindigen van alle onafhankelijke lockhouders valt buiten deze grens.

Een helpercrash tijdens activatie kan Python-exceptionrollback omzeilen. Controleer
daarna de werkelijke SHA/configuratie, service en publieke health; herstel zo nodig
gericht. De lockhouder claimt geen crashherstel van applicatiestatus.

Offline tests gebruiken echte `fork`, `SCM_RIGHTS`, `pidfd`, `SIGKILL` en `flock`,
plus negatieve CI-, bron-, bundle-, environment- en sandboxproeven. Zij vervangen
geen werkelijke systemd/OFD/kill-/rollbackproef en nacontrole van beide Dartflow-
omgevingen op de doelhost.
