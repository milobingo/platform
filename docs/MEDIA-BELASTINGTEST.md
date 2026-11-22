# Eigen LiveKit: herhaalbare stagingproef

Deze proef is uitsluitend voor de bevestigde eigen stagingdienst. Een geslaagde unitcheck, WebSocket-handshake, `200 OK` of aangemaakte HLS-playlist is geen bewijs van 200 afspelende kijkers. Productie wordt door dit harnas niet gewijzigd.

## Bronnen en vastgezette gereedschappen

Op 22 november 2026 gecontroleerde officiële releases: [LiveKit 1.13.11](https://github.com/livekit/livekit/releases/tag/v1.13.11), [Ingress 1.6.0](https://github.com/livekit/ingress/releases/tag/v1.6.0), [Egress 1.15.0](https://github.com/livekit/egress/releases/tag/v1.15.0) en [CLI 2.20.1](https://github.com/livekit/livekit-cli/releases/tag/v2.20.1). De installatie/configuratie van de diensten staat bij de media-infrastructuur; het harnas gebruikt de vastgezette appafhankelijkheden `livekit-client` en `hls.js`.

De [officiële CLI-belastingtest](https://docs.livekit.io/reference/developer-tools/livekit-cli/perf/) ontvangt echte RTP-tracks, maar bewijst geen browserdecode. Daarom zijn steeds drie echte Chromium-spelers onderdeel van het totale kijkersaantal. De overige kijkers ontvangen audio én video met de Go-client van `lk`. Het harnas leest de echte tracktabel: bij een extern gepubliceerde bron rapporteert CLI 2.20.1 ten onrechte nul *verwachte* tracks; alleen een melding “verbonden” of “2/0” telt niet als geslaagde AV-ontvangst.

[WHIP zonder transcoding](https://docs.livekit.io/transport/media/ingress-egress/ingress/transcode/) levert alleen de kwaliteitslagen die de bron daadwerkelijk publiceert. Ons profiel is één H.264-videolaag, 1280×720, 30 fps, 1.186 Mbit/s video en 64 kbit/s Opus-audio. Een lagere laag is niet verondersteld of als beschikbaar gemeld. [Egress](https://docs.livekit.io/transport/media/ingress-egress/egress/outputs/) maakt per uitzending één HLS-feed; de 50 HLS-kijkers mogen geen 50 encoders starten.

## Voorwaarden en configuratie

1. Controleer de werkelijke doelhost, DNS, TLS, UDP, TURN, host- én providerfirewall. Leg CPU, geheugen, medebewoners en netwerkcapaciteit vast. Gebruik geen wildcard die naar een andere VPS wijst.
2. Controleer via een read-only databasequery dat geen echte uitzending bezig is. Verwijder of annuleer geen bestaande shows voor deze proef.
3. Gebruik een externe generator met aantoonbaar minstens 350 Mbit/s ontvangstruimte, voldoende vrij geheugen en CPU. Een virtuele NIC-snelheid of abonnementsvermelding vervangt geen meting. Voer de begrensde netwerkproef pas op de eigen bevestigde IP-adressen uit.
4. Maak een **nieuw besloten technisch staging-spel zonder echte gezinnen, boekjes of bestellingen** voor de complete app-/HLS-proef. Noteer UUID, generatie en de bestaande `programme-<UUID>`-room. Koppel de HLS-capability aan precies die show en generatie. Test nooit een bestaand spel. Een losse diagnostische room mag `milo-staging-load-...` heten.
5. Kopieer `scripts/load/staging-media.example.json` buiten Git en zet bestandrechten op `0600`. Voor een programme-room zijn `fixtureGameId`, `fixtureGeneration`, `testOnly: true`, `fixturePrivacy: "no-real-families"` en `fixtureAttestationReference` verplicht. Kopieer via de geautoriseerde SSH-route de door `staging-fixture.mjs` beheerde private manifest uit `/var/lib/milobingo-media/fixtures/<UUID>.json` naar `fixtureManifestPath` op de externe generator (ook `0600`). Het harnas vereist de juiste `milo-staging-media-v1`-tag, origin, UUID, actieve status, room en huidige generatie; een oude/verwijderde fixture wordt geweigerd. Na generatieverandering door `start-hls` moeten manifest én configuratie worden ververst. Vermeld de daadwerkelijke private HLS-mediaplaylist, `hlsPathPrefix` en `hlsRoomBindingReference`. Dit is de media-variant `live.m3u8`, geen masterplaylist.
6. Bewaar uitsluitend `{ "apiKey": "…", "apiSecret": "…" }` in het afzonderlijke private credentialbestand. Zet geen sleutel of getekende HLS-URL in logs, Git of commandoregelargumenten. Het harnas leest de bestandsnaam uit de private configuratie. Voeg alle geverifieerde gezondheidspaden van medebewoners aan `criticalHealthUrls` toe.

Bij bron en kijkers op dezelfde externe generator delen ze dezelfde systeemklok: de relatieve klokfout is nul. Bij OBS op een andere computer moet de gemeten foutgrens tussen bron- en kijkerklokken in het bewijs staan; zonder die controle geen millisecondeclaim over beeldvertraging.

```bash
bash scripts/load/install-lk.sh /private/milo-load-tools
node tests/check-media-load.mjs
node scripts/load/run-staging-media.mjs --preflight /private/config.json /private/results
```

`--preflight` doet uitsluitend read-only inventarisatie, DNS- en gezondheidscontroles. `--connectivity` probeert maximaal één uitgever en één browserkijker, zonder de onbewezen 350 Mbit/s-capaciteit als geslaagd te markeren. Een succesvolle verbinding moet werkelijk gedecodeerd bewegend beeld en niet-stille audio opleveren. `sourceRoute: "browser-whip-test"` gebruikt de volledige private fixture-WHIP-endpoint; de browser onderhandelt H.264 en Opus, publiceert een volledige ICE-offer als `application/sdp` en beëindigt uitsluitend die eigen WHIP-sessie met `DELETE`. De geselecteerde ICE-IP-adressen/poorten en werkelijke codec/fps worden gemeten. Dit bewijst geen fysieke OBS-encoder of capaciteit.

## Testbeeld, geluid en meetmethode

`--source` publiceert een herkenbaar afgeschermd technisch beeld met beweging, 75 leesbare nummers, één uitgelicht nummer, zichtbare UTC-tijdcode en een binaire tijdstreep met CRC. De browser leest de tijd **uit het gedecodeerde beeld**, niet uit een apart databericht of netwerk-RTT. De tijdcode wordt één keer per seconde per browser gemeten. CRC-fouten en ontbrekende metingen worden geteld, niet verzonnen. Bronencode, netwerk, jitterbuffer en decode zijn daarmee inbegrepen; een headless browser vertegenwoordigt geen fysieke tv.

Voor de definitieve OBS/WHIP-route neemt OBS ditzelfde testbeeld op en publiceert de programmamix met de bedoelde encoderinstellingen. Gebruik een vooraf opgenomen technische WAV met hoorbare Nederlandse nummeraankondigingen via `announcementsPath`; geen echte gesprekken. Zonder die WAV gebruikt de diagnostische bron alleen een hoorbare toon en wordt dat expliciet als zodanig vastgelegd. Het optionele `--source`-pad gebruikt bij `browser-whip-test` werkelijk Ingress en bij `direct-sdk-diagnostic-source` rechtstreeks de SDK; geen van beide bewijst op zichzelf een fysieke OBS-installatie.

`scripts/load/make-dutch-announcements.py` maakt zonder API een technische WAV met 75 Nederlandse aankondigingen in cues van precies 15 seconden via lokaal eSpeak NG 1.51. De canvasbron leest het nummer uit dezelfde WAV-afspeeltijd; de UTC-beeldtijdcode blijft een aparte meetklok. De [harnasprocedure](../scripts/load/README.md) bevat de reproduceerbare opdracht. Het script schrijft ook cue-teksten en een bestandsdigest; dit is technische testspraak en geen oordeel over Milo’s stemkwaliteit.

## Werkelijke meetniveaus

```bash
node scripts/load/run-staging-media.mjs --run /private/config.json /private/results
```

| Niveau | CLI-ontvangers | WebRTC-browserdecode | HLS HTTP / browserdecode | Minimale meetduur na verbinden |
| --- | ---: | ---: | ---: | ---: |
| 25 WebRTC | 22 | 3 | 0 | 5 minuten |
| 50 WebRTC | 47 | 3 | 0 | 5 minuten |
| 100 WebRTC | 97 | 3 | 0 | 5 minuten |
| 150 WebRTC | 147 | 3 | 0 | 5 minuten |
| 200 WebRTC | 197 | 3 | 0 | 20 minuten |
| Gemengd 150 + 50 | 147 | 3 | 49 / 1 | 10 minuten |

De meetduur begint na de verbindingsfase én de eerste onafhankelijke serverwaarneming van het volledige kijkersaantal. De vastgezette [CLI-broncode](https://github.com/livekit/livekit-cli/blob/v2.20.1/pkg/loadtester/loadtest.go#L355) wacht eerst op alle joinpogingen en start daarna `--duration`; het harnas geeft daarbovenop 15 seconden observatiemarge. Alleen de werkelijk waargenomen aaneengesloten volle bezetting telt mee. Een te kort venster slaagt niet. Er komen maximaal vijf nieuwe CLI-kijkers per seconde bij. De HLS-clients beginnen bij het actuele livepunt en halen één segment op het normale kijktempo op; zij downloaden geen archief en halen gemiste segmenten niet in een burst in. Eén extra HLS-browser binnen de 50 decodeert dezelfde feed met `hls.js`; HTTP-segmentontvangst wordt nooit als afspeelbewijs gerapporteerd.

Het harnas stopt opschaling bij een gemist niveau, een onbereikbare medebewoner, meer dan 90% host-CPU, onvoldoende vrij geheugen (minstens 1 GiB én 12% reserve), minder dan 5 GiB vrije schijf, geheugen-PSI, een nieuwe kernel-OOM of uitgaand verkeer boven 80% van de bevestigde linkcapaciteit. `Ctrl+C` stopt alleen deze eigen testclients; het wijzigt geen spelstatus of trekkingsblokkade. Bewaak daarnaast de externe generator: een overbelaste generator is geen bewijs dat de SFU te klein is.

De read-only SSH-sampler leest de eigen LiveKit-Prometheusroute uitsluitend via `127.0.0.1:6798/metrics`: SFU-pakketbytes, verbindingen, deelnemers, tracks en proces-CPU/geheugen. [LiveKit 1.13.11](https://github.com/livekit/livekit/blob/v1.13.11/pkg/service/turn.go#L155) exposeert bij embedded TURN geen afzonderlijk geattribueerde TURN-bytesteller. Daarom leest de sampler aanvullend de vier named counters `udp_in`, `udp_out`, `tls_in`, `tls_out` uit de door root beheerde nftables-observatietabel `inet milo_media_turn_observe`. Die tellen uitsluitend eth0-verkeer op de eigen UDP3480/TCP5349-listeners, inclusief protocoloverhead, zonder payloads of beleid te wijzigen. Per fase worden echte byte-/pakketdelta's en p50/p95 van de gecombineerde in-/uitvoersnelheid berekend. Ontbrekende tellers, gewijzigde handles of dalende counters worden als ontbrekend/reset gemeld; zij worden niet in een nulmeting omgezet. Deze meting is hostbreed voor de eigen TURN-dienst, niet per room. De aparte geforceerde relayproef blijft nodig om de terugvalroute te bewijzen.

Een niveau slaagt pas met minstens 99% echte AV-ontvangst, voldoende tijdcodewaarnemingen en WebRTC p95 ≤ 1 seconde. Daarnaast moeten de echte browsermetingen minstens 80% van het gekozen totale bitrateprofiel en gemiddeld minstens 27 gedecodeerde frames per seconde halen; 200 ontvangers van een sterk onderbelaste testkaart bewijzen het gekozen 30fps-profiel niet. De bewegende textuur in de bron voorkomt een bijna stilstaand testbeeld; bron-RTP-statistieken leggen werkelijke bitrate, codec, encode-fps en eventuele encoder-CPU-beperking afzonderlijk vast. De gemengde proef vereist bovendien 49 werkelijk ophalende HLS-clients, één werkelijk afspelende HLS-browser en HLS p95 ≤ 8 seconden. Het resultaat bevat ruwe CLI-logs, per-browser RTC-statistieken, HLS-verzoeken, hostwaarnemingen, aantallen en percentielen. De uitkomst is geen productievrijgave.

Elke echte WebRTC-browser moet in **alle** waarnemingen binnen de volledige meetbezetting daadwerkelijk 1280×720 decoderen. Afmetingen ontbreken of een decoder zakt naar 480p? Dan kan de profielproef niet slagen, ook niet bij een goede mediane bitrate. De periodieke controle vereist daarnaast recente niet-stille PCM, maximaal 20 seconden oud bij de nummeraankondiging om de 15 seconden; alleen historische RMS of doorgaande stille RTP-pakketten volstaat niet.

De HLS-browser draait de exacte probebundel als lokaal Playwright-fulfilled document onder de eigen stagingorigin. Alleen dit document en zijn script worden lokaal geleverd. Echte playlist- en segmentrequests houden hun ongewijzigde capability en app-origin, zodat de bestaande CORS-beveiliging werkelijk wordt gebruikt. Dit is expliciet een mediaspelerproef en geen repetitie van de volledige familie-UI of login.

Voor de gemengde meetduur moeten alle 49 HTTP-kijkers continu recente opeenvolgende segmenten op kijktempo ophalen én moet de HLS-browser recent beeld en geluid hebben. Een enkele geslaagde download per kijker telt niet als tien minuten belasting. Na het begin van het volledige meetvenster stopt een requestfout, gemiste segmentcontinuïteit of onbereikbare kijker de proef. Het rapport bewaart per HTTP-kijker de werkelijke ononderbroken duur, gedownloade mediaseconden en fout-/stalltellers; iedere kijker moet zelf minstens 600 seconden volhouden. Het technische aankondigingsbestand bevat daarvoor ten minste iedere 15 seconden hoorbaar geluid; een historische audioactivatie wordt niet als blijvend afspelen geaccepteerd.

## Wat afzonderlijk gerepeteerd moet worden

- Instappen midden in een ronde, netwerkuitval/hervatten en het actuele bord bij terugkeer; een herverbinding mag geen bal vrijgeven.
- Echte showcue met dezelfde getoonde en gesproken bal, zonder vroeg onthullend mobiel bord tijdens tv-weergave; claimtest aan de rand van het officiële venster met gemeten tv-vertraging.
- Een fictief privéregiegesprek en daarna bewust live zetten, met afzonderlijke audio-opnamen: geen backstage/fluistertrack in programmamix, geen eigen echo en correcte retourweergave.
- Een fysieke Chromecast/Google TV en, indien beschikbaar, AirPlay. Noteer merk, model, firmware, sender, netwerk, bronklokken, meetduur, p50/p95, caststop en herstel van telefoonweergave. “Niet beschikbaar” blijft een open test; Chromium-HLS is geen Chromecast of AirPlay.

Rond af door uitsluitend de eigen fixture-ingress en egress te stoppen, de eigen tijdelijke fixture/capabilities ongeldig te maken en segmenten volgens het bestaande bewaarbeleid op te ruimen. Trek geen bestaande providercredentials in en wijzig geen oude shows. Behoud het bewijs buiten de secretbestanden.

## Verkeer en premièrecapaciteit

Bij 200 kijkers × 1.25 Mbit/s is de theoretische media-uitvoer 250 Mbit/s, ongeveer 112.5 GB per uur vóór protocoloverhead en hertransmissies. De complete genoemde proef vergt theoretisch circa 71.5 GB media-uitvoer plus overhead. Een première van twee uur bij dit profiel vraagt circa 225 GB plus overhead. Vergelijk het **gemeten** verkeer, de overige projecten en het verwachte aantal shows met de werkelijke Hetzner-bundel. Een niet ingeziene bundel of niet uitgevoerde 200-kijkersproef wordt niet voldoende verklaard.
