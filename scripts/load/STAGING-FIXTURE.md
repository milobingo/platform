# Verborgen technische staginguitzending

Deze helper is uitsluitend voor een geautoriseerde beheerder op
`dg-nxttrack-01` met publiek IP `128.140.93.95`. Hij leest het bestaande
root-only runtimebestand van `milobingo-staging` en controleert de staging
origin, Supabase-projectref en geverifieerde database-TLS. Hij opent geen
HTTP-authomweg en maakt geen Supabase Auth-account of beheerdersrol.

**Voer geen zware test uit zolang publieke ICE/WHIP/TURN-poorten onbereikbaar
zijn of een echte uitzending dezelfde VPS gebruikt.** Een succesvolle API-call
bewijst geen mediadoorgifte. Alle helperacties hieronder vereisen root.

De immutable Next-release bevat geen ruwe `server/`-modules of deze helper.
Bundel hem daarom vanuit een beoordeelde commit met de bestaande, vastgelegde
projectdependencies. De bundel bevat `pg` en zijn JavaScript-dependencies;
op de VPS is geen dependency-installatie en geen kopie van secrets nodig.
De `createRequire`-banner laat de gebundelde CommonJS-code Node-builtins
laden. De optionele native PostgreSQL-driver wordt niet gebruikt.

Voer lokaal uit vanuit de repository. Begin met een schone, beoordeelde
versie van de helper, `server/`, `package.json` en `pnpm-lock.yaml`:

```sh
set -eu
git diff --exit-code HEAD -- scripts/load/staging-fixture.mjs server package.json pnpm-lock.yaml
fixture_source_sha=$(git rev-parse --verify HEAD)
fixture_bundle_dir=$(mktemp -d /tmp/milo-fixture.XXXXXX)
fixture_bundle="$fixture_bundle_dir/staging-fixture-$fixture_source_sha.mjs"
pnpm exec esbuild scripts/load/staging-fixture.mjs \
  --bundle --platform=node --format=esm --target=node24 \
  --banner:js='import {createRequire as fixtureCreateRequire} from "node:module"; const require = fixtureCreateRequire(import.meta.url);' \
  --outfile="$fixture_bundle"
chmod 600 "$fixture_bundle"
sha256sum "$fixture_bundle"
```

Verplaats alleen die codebundel via de bestaande geautoriseerde SSH-route.
Bij de huidige beheerverbinding is dat:

```sh
scp -F /home/codex/.ssh/dg-nxttrack-admin.conf "$fixture_bundle" \
  "dg-nxttrack-01-admin:/tmp/staging-fixture-$fixture_source_sha.mjs"
ssh -F /home/codex/.ssh/dg-nxttrack-admin.conf dg-nxttrack-01-admin \
  sudo -n install -d -o root -g root -m 0700 /opt/milobingo-media-tools
ssh -F /home/codex/.ssh/dg-nxttrack-admin.conf dg-nxttrack-01-admin \
  sudo -n install -o root -g root -m 0600 \
  "/tmp/staging-fixture-$fixture_source_sha.mjs" \
  "/opt/milobingo-media-tools/staging-fixture-$fixture_source_sha.mjs"
ssh -F /home/codex/.ssh/dg-nxttrack-admin.conf dg-nxttrack-01-admin \
  sudo -n sha256sum "/opt/milobingo-media-tools/staging-fixture-$fixture_source_sha.mjs"
ssh -F /home/codex/.ssh/dg-nxttrack-admin.conf dg-nxttrack-01-admin \
  rm -- "/tmp/staging-fixture-$fixture_source_sha.mjs"
```

Controleer dat de twee SHA-256-checksums gelijk zijn. Start pas een fixture
nadat de bijbehorende stagingversie is uitgerold, inclusief het verbergen
van technische fixtures in de gewone catalogi. Gebruik op de VPS de exacte
versiegebonden tool als `<tool>`. De lege procesomgeving voorkomt afwijkende
Node-/PostgreSQL-loaderopties; de helper leest zelf het beschermde staging-
runtimebestand. De fixture blijft een concept; begin geen gewone showrunner:

```sh
sudo -n env -i PATH=/usr/bin:/bin /opt/node-v24.18.0-linux-x64/bin/node <tool> create
```

Dit maakt precies één nieuwe Milo-show met een willekeurige fictieve owner,
de actuele datum, `testOnly:true` en een gebonden technische marker. Er zijn
geen gezinnen, deelnemers, boekjes, bestellingen of betalingen. Bestellen
staat uit. De gewone show- en bestelcatalogi verbergen uitsluitend deze
volledig getagde fixture; gewone showroutes behandelen het ID als onbekend.
Er wordt geen bestaande show gewijzigd.

De uitvoer noemt alleen metadata en het manifestpad:
`/var/lib/milobingo-media/fixtures/<game-uuid>.json`. Deze root-only directory
heeft mode `0700`; manifesten hebben mode `0600` en bevatten **geen sleutels,
JWT's of WHIP-/HLS-links**. De vaste manifestvelden zijn:

```json
{
  "format": 1,
  "tag": "milo-staging-media-v1",
  "origin": "https://milo-staging.dgwebservices.nl",
  "gameId": "<uuid>",
  "ownerId": "<fictieve-uuid>",
  "marker": "<uuid>",
  "createdAt": 0,
  "room": "programme-<game-uuid>",
  "generation": "<32-kleine-hextekens>",
  "status": "active"
}
```

`createdAt` is in het echte manifest een positieve tijdstempel. Een gedeeltelijk
mislukte creatie behoudt het manifest als `pending` voor onderzoek en herstel.
Maak niet steeds nieuwe fixtures bij een fout; controleer het gemelde ID.

Vervang `<manifest>` hieronder door het ontvangen absolute manifestpad:

```sh
sudo -n env -i PATH=/usr/bin:/bin /opt/node-v24.18.0-linux-x64/bin/node <tool> inspect --manifest <manifest>
sudo -n env -i PATH=/usr/bin:/bin /opt/node-v24.18.0-linux-x64/bin/node <tool> prepare --manifest <manifest>
```

`prepare` gebruikt dezelfde programme-controle als de app en maakt of hergebruikt
de eigen WHIP-ingress. De volledige geheime WHIP-URL en encoderinstellingen
staan uitsluitend in `<game-uuid>-session.json` naast het manifest, mode `0600`.
Bewaar of kopieer dit bestand uitsluitend via de geautoriseerde private
beheerroute. Toon het niet in terminaluitvoer, screenshots of testlogs.

Laat de testencoder vervolgens exact `programme-video` en `programme-audio`
publiceren als `programme-<game-uuid>`. Zodra echte AV-tracks binnenkomen:

```sh
sudo -n env -i PATH=/usr/bin:/bin /opt/node-v24.18.0-linux-x64/bin/node <tool> start-hls --manifest <manifest>
sudo -n env -i PATH=/usr/bin:/bin /opt/node-v24.18.0-linux-x64/bin/node <tool> access --manifest <manifest>
```

`start-hls` werkt de actuele generatie in het manifest bij. Daarna ververst
`access` het private sessiebestand met een kijktoken en een getekende HLS-link
voor de **echte app-route**. Dit vervangt de eerdere WHIP-gegevens in dat
sessiebestand; laat de encoder eerst zijn private instellingen inlezen.
Een kijktoken is 120 seconden geldig voor een nieuwe verbinding. Geef bij
latere testniveaus verse tokens uit met de geautoriseerde loadprocedure.
De HLS-link is standaard vier uur geldig; dit is voldoende voor één volledige
proef van circa een uur. Link én elk segment vereisen die beperkte toegang.
`access` beweert niet dat de playlist of fysieke tv al afspeelt.

De loadconfiguratie moet het exacte manifest, show-ID, room en de nieuwste
generatie vastleggen. Alleen een actieve, private, volledige fixturemarker
mag de normale `milo-staging-load-`-roombeperking vervangen. Ondersteun geen
vrije roomnaam of een productie-origin als uitzondering.

Afronden en opruimen:

```sh
sudo -n env -i PATH=/usr/bin:/bin /opt/node-v24.18.0-linux-x64/bin/node <tool> stop --manifest <manifest>
sudo -n env -i PATH=/usr/bin:/bin /opt/node-v24.18.0-linux-x64/bin/node <tool> remove --manifest <manifest>
```

`remove` controleert opnieuw tag, owner, marker, conceptstatus, nul echte
gegevens en nul gekoppelde administratie. Bij gewijzigde identiteit of echte
boekjes, deelnemers, bestellingen, chat-/betaalrecords of een lopende
beheeractie stopt hij. Hij weigert vreemde publishers/ingresses en sluit
eerst uitsluitend de gebonden egress, ingress en room. Bij ontbrekende
providerbevestiging blijft de databasefixture bestaan voor herstel. Daarna
verwijdert hij via een exacte ID/owner/revision/document-vergelijking de eigen
show en alleen de eigen HLS-directory. Een concurrerende wijziging blokkeert
de verwijdering. Het credentialbestand verdwijnt; het manifest blijft als
`removed` met tijdstempel voor audit. Andere shows en accounts blijven intact.

Lokale veiligheidstests (SQLite, fictieve personen, geen echte providercalls):

```sh
node tests/check-staging-programme-fixture.mjs
```

De fixture is tijdens de eerste implementatie niet op de VPS aangemaakt,
omdat de externe mediapoorten nog geblokkeerd waren.
