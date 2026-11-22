# Verborgen technische staginguitzending

Deze helper is uitsluitend voor een geautoriseerde beheerder op
`dg-nxttrack-01` met publiek IP `128.140.93.95`. Hij leest het bestaande
root-only runtimebestand van `milobingo-staging` en controleert de staging
origin, Supabase-projectref en geverifieerde database-TLS. Hij opent geen
HTTP-authomweg en maakt geen Supabase Auth-account of beheerdersrol.

**Voer geen zware test uit zolang publieke ICE/WHIP/TURN-poorten onbereikbaar
zijn of een echte uitzending dezelfde VPS gebruikt.** Een succesvolle API-call
bewijst geen mediadoorgifte. Alle helperacties hieronder vereisen root.

Gebruik een beoordeelde checkout met de projectdependencies en de vastgelegde
Node-toolchain. De fixture blijft een concept; begin geen gewone showrunner:

```sh
sudo /opt/node-v24.18.0-linux-x64/bin/node scripts/load/staging-fixture.mjs create
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
sudo /opt/node-v24.18.0-linux-x64/bin/node scripts/load/staging-fixture.mjs inspect --manifest <manifest>
sudo /opt/node-v24.18.0-linux-x64/bin/node scripts/load/staging-fixture.mjs prepare --manifest <manifest>
```

`prepare` gebruikt dezelfde programme-controle als de app en maakt of hergebruikt
de eigen WHIP-ingress. De volledige geheime WHIP-URL en encoderinstellingen
staan uitsluitend in `<game-uuid>-session.json` naast het manifest, mode `0600`.
Bewaar of kopieer dit bestand uitsluitend via de geautoriseerde private
beheerroute. Toon het niet in terminaluitvoer, screenshots of testlogs.

Laat de testencoder vervolgens exact `programme-video` en `programme-audio`
publiceren als `programme-<game-uuid>`. Zodra echte AV-tracks binnenkomen:

```sh
sudo /opt/node-v24.18.0-linux-x64/bin/node scripts/load/staging-fixture.mjs start-hls --manifest <manifest>
sudo /opt/node-v24.18.0-linux-x64/bin/node scripts/load/staging-fixture.mjs access --manifest <manifest>
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
sudo /opt/node-v24.18.0-linux-x64/bin/node scripts/load/staging-fixture.mjs stop --manifest <manifest>
sudo /opt/node-v24.18.0-linux-x64/bin/node scripts/load/staging-fixture.mjs remove --manifest <manifest>
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
