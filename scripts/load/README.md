# Milo staging: media- en belastingproef

De volledige Nederlandse procedure, meetdefinities en open hardwarecontroles staan in [MEDIA-BELASTINGTEST.md](../../docs/MEDIA-BELASTINGTEST.md). Alle artefacten van de uitgevoerde eerste proeven staan onder [verification/media/load/2026-11-22](../../verification/media/load/2026-11-22).

```bash
node tests/check-media-load.mjs
node tests/check-media-load-browser.mjs /private/chromium/chrome /private/local-opus-proof.json
bash scripts/load/install-lk.sh /private/milo-load-tools
node scripts/load/run-staging-media.mjs --preflight /private/config.json /private/results
node scripts/load/run-staging-media.mjs --connectivity /private/config.json /private/one-viewer
```

Gebruik `staging-media.example.json` uitsluitend als voorbeeld; nulbandbreedte, verouderde inventaris en placeholders blokkeren een zware proef bewust. De echte configuratie en credentials blijven buiten Git met rechten `0600`. `--connectivity` is maximaal één bron en één browser, geen capaciteitstest. Geselecteerde ICE-IP-adressen en poorten moeten de **publieke** route bewijzen; een werkende Tailscale-route telt niet.

Voor de bedoelde Ingress-route gebruik je `sourceRoute: "browser-whip-test"` en de volledige private `/whip/<streamkey>` uit de eigen fixture-ingress. De testbrowser onderhandelt H.264/Opus, verzamelt zijn volledige ICE-offer en publiceert via WHIP. Dit is een echte Ingress-proef, maar geen verklaring dat fysieke OBS gebruikt is. `direct-sdk-diagnostic-source` blijft een expliciet benoemde diagnostische route.

```bash
# In een afzonderlijk terminalvenster, alleen op de bevestigde externe generator:
node scripts/load/run-staging-media.mjs --source /private/config.json /private/source-results

# Pas na echt beeld, audio, bitrate, fps, externe ICE en veilige hostinventaris:
node scripts/load/run-staging-media.mjs --run /private/config.json /private/capacity-results
```

Na een gerichte verbetering mag uitsluitend de oorspronkelijke gemengde fase opnieuw worden gemeten:

```bash
node scripts/load/run-staging-media.mjs --retry-mixed /private/config.json /private/new-mixed-results /private/capacity-results/report.json
```

Dit vereist een beëindigd rapport met alle zes volledige meetfases, vijf geslaagde WebRTC-niveaus inclusief twintig minuten bij 200 kijkers, dezelfde host/origin/private fixture en nul achtergebleven testkijkers. Alle verse inventaris-, DNS-, netwerk- en hostveiligheidscontroles blijven gelden. De resultaatmap moet nieuw zijn. Het oude rapport blijft ongewijzigd en zijn SHA-256 wordt vóór en na de proef gecontroleerd. De herhaling is altijd 150 WebRTC + 50 HLS gedurende minstens tien minuten; hij bewijst alleen die nieuwe gemengde meting. Een nieuwe HLS-generatie binnen dezelfde fixture kan nodig zijn na een encoderwijziging en wordt opnieuw tegen de private manifest gevalideerd.

De HLS-browser bewaart daarbij actuele afspeeltijd, bufferbereiken, voorwaartse buffer, werkelijke `latency`/`targetLatency` en maximaal 32 recente HLS-foutgebeurtenissen, inclusief niet-fatale bufferonderbrekingen. Eventgegevens bevatten uitsluitend tijd, type, detailcode en fataliteit; geen stream-URL, headers of fouttekst. Het afspeelbeleid en de catchupinstellingen worden door deze diagnostiek niet gewijzigd. De algemene `stalls`-teller met een drempel van drie seconden sluit kortere beeldonderbrekingen niet uit; de beeldtijdcodes en HLS-events moeten ook worden beoordeeld.

`announcementsPath` moet naar een vooraf opgenomen technische WAV met Nederlandse nummeraankondigingen wijzen om gesproken nummers te testen. Zonder dit bestand levert de bron uitsluitend een herkenbaar gelabelde diagnostische toon. Er worden geen echte gezinnen gebeld en geen spraak-API's gebruikt.

De reproduceerbare offline bron kan met eSpeak NG 1.51 worden gemaakt:

```bash
python3 scripts/load/make-dutch-announcements.py --espeak /private/espeak-ng --data-parent /private/lib-parent --output /private/dutch-numbers.wav
```

Gebruik een lokaal geïnstalleerde of uit de eigen Ubuntu-pakketten uitgepakte binary; `--data-parent` is alleen nodig bij een uitgepakte installatie en wijst naar de map met `espeak-ng-data`. Bijbehorende dynamische libraries moeten via de eigen lokale `LD_LIBRARY_PATH` bereikbaar zijn. Er is geen systeeminstallatie of betaalde API nodig. Het script maakt 75 Nederlandse nummeraankondigingen met stilte tot precies 15 seconden per cue, totaal 1125 seconden, plus een JSON met teksten en SHA-256. Dit is herkenbare technische spraak, geen nabootsing van Milo.

De canvasbron kiest het uitgelichte getal uit de actuele afspeeltijd van **dezelfde WAV**: cue 1 op 0 seconden, cue 2 op 15 seconden, tot cue 75 en daarna terug naar 1. Pauzeren of bufferen kan daardoor geen andere UTC-klok vooruit laten lopen ten opzichte van de spraak. De ingebakken UTC-beeldtijdcode voor de meting blijft onafhankelijk. Deze klok betreft alleen de technische testbron; de bestaande showregels worden niet gewijzigd.

De afzonderlijke browserregressie gebruikt de exacte ontvanger met echte lokale Opus-peerverbindingen; uitsluitend SDK-signaling is vervangen door een lokale fixture. Daarmee controleert hij dat een spelend audio-element de Chromium-decoder activeert en de analyser werkelijk PCM ontvangt. De generator houdt zijn eigen uitvoer stil met elementvolume nul en meet de ontvangen track vóór die volumeregeling. `totalAudioEnergy` alleen kan in die opstelling nul blijven; echte PCM en gedecodeerde samples zijn nodig. De harnasontvanger meet audio iedere 50 milliseconden, onafhankelijk van videoframes, zodat korte aankondigingen niet tussen meetmomenten verdwijnen. Deze lokale regressie is geen bewijs voor de publieke mediaserver.

Het harnas voert 25/50/100/150 WebRTC-kijkers elk vijf minuten, 200 kijkers twintig minuten en daarna 150 WebRTC + 50 HLS tien minuten uit, met echte RTP-ontvangst en afzonderlijke echte browserdecode. Een mislukte verbinding, onveilige hostbelasting of gemist doel stopt de volgende niveaus. `Ctrl+C` stopt de eigen testclients en de eigen WHIP-sessie; geen spelstatus wordt hervat.

Na een geslaagde meetfase worden de daadwerkelijk ontvangende browserpagina’s als `<fase>-decoder.png` en, indien aanwezig, `<fase>-hls-decoder.png` opgeslagen. Daarmee kan de leesbaarheid van het geleverde beeld worden beoordeeld; dit zijn geen broncanvasscreenshots. Node handelt SIGINT en SIGTERM zelf af terwijl Playwright de browser beschikbaar houdt voor expliciete mediacleanup. De lokale browserregressie test beide echte signalen en controleert daarna dat de echte peerverbindingen en audiocontexten gesloten zijn.

Iedere WebRTC-browser moet gedurende het meetvenster werkelijk 1280×720 blijven decoderen en minstens elke 20 seconden hoorbare PCM ontvangen. Een lagere resolutie, ontbrekende decoderstatistiek, historische audioactivatie of stille Opus-pakketten kan geen profielacceptatie opleveren. Per browser worden alle waargenomen afmetingen en eventuele afwijkingen opgeslagen.

De HLS-probe krijgt zijn eigen lokaal geleverde document en JavaScript onder de geverifieerde stagingorigin via Playwright-routefulfillment. De daadwerkelijke getekende playlist- en segmentrequests blijven ongewijzigd en doorlopen de echte app/CORS-controle. Een loopback-origin wordt door die controle terecht geweigerd. Dit test de mediaspeler en capabilityroute, geen gezinslogin of volledige familie-UI.

De gemeten meetduur start pas bij onafhankelijk vastgestelde volle bezetting; de CLI krijgt 15 seconden extra observatiemarge. De SSH-sampler leest intern Prometheus op loopback6798 en de vier eigen TURN-kerneltellers uit `inet milo_media_turn_observe`. Geen meting of een counterreset levert geen acceptatie op. TURN-counters omvatten de eigen listeners op de host, geen afzonderlijke roomtoerekening.

De optionele, aparte `probe-https-margin.py /private/result.json` test gedurende 15 seconden maximaal 400 Mbit/s op de vooraf gecontroleerde eigen VPS. Hij gebruikt alleen een tijdelijke, extern IP-beperkte HTTPS-route en herstelt het oorspronkelijke Caddy-fragment met digestcontrole. De opdracht is een beheerhandeling: eerst de doelhost en afwezigheid van een echte uitzending controleren. Deze proef vervangt geen UDP/TURN- of 200-kijkersproef.

Fysieke Chromecast/Google TV, AirPlay, een echte OBS-encoder, privéregie-audio/live-audio en claimtiming op een tv blijven afzonderlijke verplichte repetities. Rapporten bevatten daarvoor expliciete niet-uitgevoerdvelden totdat werkelijk bewijs beschikbaar is. HTTP-segmenten zijn geen bewijs van tv-beeld en audio.
