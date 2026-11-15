# Milo-productie: host voorbereiden zonder publiceren

`prepare-host.py` is een handmatige beheerhelper voor uitsluitend
`dg-nxttrack-01` en het beoordeelde `profile.proposed.json`. Zij bevat geen
credentialwaarden en krijgt geen runner-sudoersregel. Uitvoeren vereist root.
De app, Caddy en bestaande runners worden door de helper nooit gestart,
herladen, gestopt of ingeschakeld. De echte productieacceptatie blijft verplicht.

Leg eerst een actuele read-only baseline vast: listeners, alle bestaande
service-identiteiten en releases, `/etc/caddy/Caddyfile` en de zeven bestaande
hostfragmenten. Controleer vrije poort 4178 opnieuw. Beoordeel de helperbytes
vóór overdracht naar een nieuwe root-only reviewmap op de doelhost.

## Accounts en renderen

```sh
sudo python3 -I /root/milo-production-review/prepare-host.py prepare-accounts
sudo python3 -I /root/milo-production-review/prepare-host.py accounts
```

Dit maakt uitsluitend de drie eigen systeemaccounts en eigen directories.
Accounts hebben een eigen primaire groep en `nologin`; alleen `run-mil-prd`
krijgt `dg-build` erbij. Een bestaand account, directory of bestand met
afwijkende identiteit of rechten wordt geweigerd. Er wordt geen gedeeld
lockbestand vervangen. De echte UID/GID-paren staan zonder secrets in
`/root/milo-production-bootstrap/production-accounts.json`. Kopieer alleen die
openbare metadata naar de ontwikkelomgeving.

Gebruik de bestaande renderer; verzin geen UID/GID-paren en render niet als
root vanuit een schrijfbare applicatiecheckout op de doelhost:

```sh
node scripts/deploy/protected-production-render.mjs \
  --profile=infra/production/profile.proposed.json \
  --accounts=/tmp/milo-production-accounts.json \
  --config-ids=/tmp/milo-production-config-ids.json \
  --output=/tmp/milo-production-rendered
```

Het configuratiebestand bevat precies `["production-2026-11-15-v1"]`. Controleer
alle gerenderde bytes en bronpinnen en noteer onafhankelijk de SHA-256 van
`manifest.json`. Draag de gehele reviewmap over naar een nieuwe root-owned map
onder `/root`. Gebruik de genoteerde digest bij beide acties:

```sh
sudo python3 -I /root/milo-production-review/prepare-host.py review-bundle \
  --bundle=/root/milo-production-rendered --manifest-sha256=<beoordeelde-digest>
sudo python3 -I /root/milo-production-review/prepare-host.py install-bundle \
  --bundle=/root/milo-production-rendered --manifest-sha256=<beoordeelde-digest>
```

De installatie controleert bestandenset, inhoud, doelpaden, modi, profielpin,
werkelijke accounts en `visudo`. Zij publiceert atomair zonder overschrijven.
De appunit, broker, policy, sudoers, eigen Caddy-beheerblokkade en runnerunit
worden geïnstalleerd. Een eigen appunit-drop-in vereist de beheerblokkade;
de exact gerenderde appunit zelf blijft ongewijzigd. Het Caddyfragment blijft buiten de live import als
`/etc/dg-sites/milobingo-production/site.caddy.prepared`. Daardoor kan een reload
van een ander project Milo niet voortijdig publiceren. De twee publieke
repositorybestanden `profile.json` en `deploy-production.yml` worden afzonderlijk
via Git beoordeeld en gecommit; de hosthelper schrijft ze niet naar een checkout.

## Afzonderlijke GitHub-runner

De runner gebruikt uitsluitend `/home/run-mil-prd/actions-runner`, eigen
werkmappen en `milobingo-production-runner.service`. Kopieer geen bestaande
`.runner`, `.credentials*`, `.env`, `.path`, werkmap of registratie van staging.
Download de officiële Linux x64 runnerdistributie vanaf `actions/runner`, pin
release en SHA-256 en controleer die vóór uitpakken. Pak alleen in de nieuwe
lege runnerdirectory uit, als `run-mil-prd`; voer distributiecode nooit als root
uit. Installeer eventuele ontbrekende systeemdependencies afzonderlijk nadat
de werkelijke dependencycontrole ze heeft aangetoond.

Vóór registratie voert root de eigen beheerblokkade uit en controleert haar:

```sh
sudo /usr/local/libexec/milobingo-production-guard-control-plane.py --install
sudo /usr/local/libexec/milobingo-production-guard-control-plane.py --check
```

Dit voegt uitsluitend zes UID-ownerregels toe: de drie eigen accounts naar
Caddy-poort 2019 op IPv4-loopback en IPv6-loopback. Bestaande UFW/Tailscale-
en SocialHero-regels worden niet gewijzigd. De eigen oneshot-unit herstelt de
regels bij starten; de runnerunit vereist die unit.

Maak via de GitHub API een eenmalig registratietoken voor `milobingo/platform`.
Breng het uitsluitend via beschermd stdin over. Een vertrouwde rootprocessor
leest het begrensd en start `config.sh` met de runner-UID/GID, de echte groepen,
een schone tijdelijke procesomgeving en `ACTIONS_RUNNER_INPUT_TOKEN`; zet het
token niet in shellargumenten, bestanden, logs, chat of GitHub-secrets. De
[officiële runnerbron](https://github.com/actions/runner/blob/main/src/Runner.Listener/CommandSettings.cs)
ondersteunt deze invoer en verwijdert de variabele na inlezen.

De vaste niet-geheime configuratieargumenten zijn:

```text
--unattended
--url https://github.com/milobingo/platform
--name dg-nxttrack-01-milobingo-production
--labels dg-nxttrack-01,milobingo-production,production
--work /home/run-mil-prd/_work
```

Gebruik geen `--replace`. Leg alleen runner-ID, naam, labels en status vast;
geen autorisatiebestanden. In deze voorbereidingsfase blijft de runnerunit
gestopt. Een latere gerichte `daemon-reload`/inschakeling van uitsluitend de twee
eigen nieuwe units is een afzonderlijke beheeractie. De productie-appunit en
Caddy blijven daarbij ongemoeid.

## Vrijgave

Dit is hostvoorbereiding. Databasebackup met echte restore, schema, beperkte
runtime-login, de root-only runtimebundel, Auth-configuratie en de vijf echte
stagingacceptaties worden afzonderlijk uitgevoerd. Maak geen `passed`-record op
basis van simulaties. Publiceer het Caddyfragment pas na review van de volledige
Caddyconfiguratie en de gecontroleerde releaseprocedure. De productiegate wordt
niet aangepast of overgeslagen. Vergelijk daarna de baseline en controleer de
health van alle bestaande sites.
