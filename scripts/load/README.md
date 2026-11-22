# Milo staging: media- en belastingproef

De volledige Nederlandse procedure, meetdefinities en open hardwarecontroles staan in [MEDIA-BELASTINGTEST.md](../../docs/MEDIA-BELASTINGTEST.md). Alle artefacten van de uitgevoerde eerste proeven staan onder [verification/media/load/2026-11-22](../../verification/media/load/2026-11-22).

```bash
node tests/check-media-load.mjs
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

`announcementsPath` moet naar een vooraf opgenomen technische WAV met Nederlandse nummeraankondigingen wijzen om gesproken nummers te testen. Zonder dit bestand levert de bron uitsluitend een herkenbaar gelabelde diagnostische toon. Er worden geen echte gezinnen gebeld en geen spraak-API's gebruikt.

Het harnas voert 25/50/100/150 WebRTC-kijkers elk vijf minuten, 200 kijkers twintig minuten en daarna 150 WebRTC + 50 HLS tien minuten uit, met echte RTP-ontvangst en afzonderlijke echte browserdecode. Een mislukte verbinding, onveilige hostbelasting of gemist doel stopt de volgende niveaus. `Ctrl+C` stopt de eigen testclients en de eigen WHIP-sessie; geen spelstatus wordt hervat.

De optionele, aparte `probe-https-margin.py /private/result.json` test gedurende 15 seconden maximaal 400 Mbit/s op de vooraf gecontroleerde eigen VPS. Hij gebruikt alleen een tijdelijke, extern IP-beperkte HTTPS-route en herstelt het oorspronkelijke Caddy-fragment met digestcontrole. De opdracht is een beheerhandeling: eerst de doelhost en afwezigheid van een echte uitzending controleren. Deze proef vervangt geen UDP/TURN- of 200-kijkersproef.

Fysieke Chromecast/Google TV, AirPlay, een echte OBS-encoder, privéregie-audio/live-audio en claimtiming op een tv blijven afzonderlijke verplichte repetities. Rapporten bevatten daarvoor expliciete niet-uitgevoerdvelden totdat werkelijk bewijs beschikbaar is. HTTP-segmenten zijn geen bewijs van tv-beeld en audio.
