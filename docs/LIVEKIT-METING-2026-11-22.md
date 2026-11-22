# Milo-uitzending: werkelijke metingen op 22 november 2026

**Status: stagingopstelling; niet vrijgegeven voor 200 kijkers.** De app,
versiegebonden media-infra en herhaalbare tests zijn gebouwd. De beschikbare
publieke mediaproef faalt op ICE. Er is geen geslaagde 200-kijkersproef,
werkelijke HLS-uitzending of fysieke tv-repetitie om als bewijs op te voeren.

## Omgeving en bron

De bestaande stagingrelease bij aanvang was
`9e7aa7c8c33bf244ebdaca1ac69d2d060aecd598`, release `44138490024-1`, op
`https://milo-staging.dgwebservices.nl`. De geverifieerde show-VPS is
`dg-nxttrack-01` / `NXTTRACK1`, Hetzner-ID `144079944`, `128.140.93.95`,
`fsn1-dc14`, vier AMD EPYC-Genoa-vCPU's, 7745 MiB RAM. Voor installatie waren
circa 5259 MiB RAM en 63 GiB schijf beschikbaar; hostload circa 0,2.

De externe generator is de afzonderlijke VPS `codex-worker-01`, Hetzner-ID
`152038521`, `65.108.158.112`, `hel1-dc2`, twaalf vCPU's en circa 23 GiB RAM.
Dit is een externe datacenternetwerkroute, geen mobiel thuisnetwerk of wifi-tv.
Er zijn geen echte kinderen, deelnemersoproepen, boekjes of bestellingen
gebruikt. Een read-only statuscontrole vond geen showwijziging in de laatste
vijf minuten; twee oude open shows waren sinds 15/16 november onveranderd.
Deze shows zijn niet aangepast of geannuleerd.

Milo-productie bleef op `aab35f80b96422a617f7fd9d247d498753757442`, release
`43911040530-1`. De productie-appservice liep sinds 16 november ononderbroken.
De zeven andere Caddy-sitefragmenten hebben na installatie dezelfde hash als
ervoor. De gecontroleerde bestaande Milo-, Dartflow- en Socialhero-healthroutes
gaven HTTP 200. Geen andere projectconfiguratie is vervangen.

## Uitgevoerde proeven

| Proef | Werkelijke uitvoering | Resultaat |
| --- | --- | --- |
| Host/SSH/TLS/API-inventaris | Bestaande admin- en deployroute, juiste instance/IP, Caddy 2.11.8, huidige sites/firewall/listeners | Gecontroleerd |
| Room/WHIP/API-contract | Nieuwe besloten tijdelijke room; CreateRoom, ListParticipants, CreateIngress zonder transcode, ListIngress, foutieve SDP op echte publieke WHIP-route, ListEgress, cleanup | Acht controles geslaagd; geen echte media-encoder gestart |
| Egress-schema/toelating | Exacte `StartEgress`-MediaSource met bewust ontbrekende tracks | Aanvraag geaccepteerd als `EGRESS_STARTING`; verwachte terminale 404 door ontbrekende tracks. Geen encodingbewijs; stopresponse time-out, cleanup afzonderlijk gecontroleerd |
| Herstartbestendige OBS-ingang | Eén tijdelijke Ingress aangemaakt; alleen eigen Redis herstart; daarna ID, streamkey, room en publisher vergeleken | Ongewijzigd teruggevonden; API hersteld; ingang en room opgeruimd; geen media of show aangemaakt |
| Lokale testbron-audio | Vijf echte Chromium-WebAudio-metingen vóór en na de MediaStreamDestination, zonder netwerkverbinding | Circa 0,0566 RMS, actieve audiotrack. Bewijst de audiogenerator, geen publieke overdracht of hoorbaar tv-geluid |
| HTTPS-bandbreedtemarge | 15 seconden bron op maximaal 400 Mbit/s; target → externe generator via publieke HTTPS 443 | 750.000.000 bytes in 15,13084 s: **396,54 Mbit/s**; tijdelijke route/server opgeruimd |
| Nieuwe TCP/TURN-poorten | Externe TCP- en UDP-pogingen; lokale allowregels; packet capture op target eth0 | Nieuwe TCP 7881/5349 time-out; geen bijbehorende pakketten gezien op target; extra netwerkfilter moet worden gecontroleerd |
| Publieke WebRTC, één bron/browser | Nieuwe afgeschermde room; eth0-only ICE; echte SDK-publisher | ICE mislukt: `could not establish pc connection`; geen publieke AV-acceptatie |
| Browserbediening | Echte Chromium op 390 en 1366 pixels, gesimuleerde transport-/Cast-SDK | Bediening, kaart/chat, herstel, tv-status en gehoord-bord gecontroleerd; geen hardwarebewijs |

Het API-contractbewijs staat in
[`verification/program-broadcast/2026-11-22-api-contract.json`](../verification/program-broadcast/2026-11-22-api-contract.json).
Het [Egress-schemabewijs](../verification/program-broadcast/2026-11-22-egress-schema.json),
de [Redis-herstartproef](../verification/program-broadcast/2026-11-22-redis-restart.json)
en de [lokale audiometingen](../verification/program-broadcast/2026-11-22-source-audio.json)
vermelden hun beperkte scope afzonderlijk.
Netwerk-, status- en verbindingsbewijzen staan in
[`verification/media/load/2026-11-22`](../verification/media/load/2026-11-22).
De browserbeelden staan in [`verification/media/browser`](../verification/media/browser).

Een vroege diagnostische verbinding decodeerde kort beeld voordat alle
serverprocessen met de eth0-filter opnieuw gestart waren. Het gebruikte
kandidaat-IP was niet vastgelegd en audio had geen gemeten energie. Dit telt
uitdrukkelijk niet mee als publieke beeld-/geluidstest of latencyresultaat.
Na de expliciete herstart faalde de publieke ICE-verbinding.

De beschikbare beheerverbinding toont de lokale UFW en procesconfiguratie,
maar geen gekoppelde Hetzner-firewall, uitgaande providerregels of
abonnementsbundel. De gebruiker heeft de concrete vraag gekregen TCP
7881/5349 en UDP 7882/7885/3480 voor beide IP-versies te controleren. Dit is
nog geen bewijs dat juist de inkomende Hetzner-firewall de enige oorzaak is;
ook de uitgaande regels van de generator moeten bij herhaling worden gecontroleerd.

## Gevraagde belastingniveaus

Een mislukte publieke enkele mediaverbinding is geen zinvol uitgangspunt
voor zware opschaling op een gedeelde VPS. Daarom zijn de volgende fases niet
gestart. Het harnas houdt de vereiste aantallen en werkelijke duur vast; de
resultaten zijn niet uit bandbreedteberekening of gesimuleerde spelers afgeleid.

| Niveau | Vereiste duur op volledige bezetting | Uitgevoerd | AV-succes / bitrate / CPU / RAM / TX / verlies / reconnects | E2E p50 / p95 |
| --- | --- | --- | --- | --- |
| 25 WebRTC | 5 min | Nee | Niet gemeten | Niet gemeten |
| 50 WebRTC | 5 min | Nee | Niet gemeten | Niet gemeten |
| 100 WebRTC | 5 min | Nee | Niet gemeten | Niet gemeten |
| 150 WebRTC | 5 min | Nee | Niet gemeten | Niet gemeten |
| 200 WebRTC | 20 min | Nee | Niet gemeten | Niet gemeten |
| 150 WebRTC + 50 HLS | 10 min | Nee | Niet gemeten | Niet gemeten |

De doelen ≥99% geslaagde verbindingen bij 200 kijkers en p95 ≤1 seconde
WebRTC-/≤8 seconden tv-vertraging zijn **niet aangetoond**. TURN-belasting,
decodevastlopers, tijd tot eerste beeld en langere reconnectstabiliteit zijn
evenmin gemeten op de bedoelde publieke route.

Geen Chromecast, Google TV, AirPlay-ontvanger of fysieke OBS-installatie was
vanuit de ontwikkelomgeving bedienbaar. Apparaatgebonden E2E-percentielen,
daadwerkelijke programma-audio in OBS, privé/live-trackisolatie met twee
echte testapparaten, terugkeer na caststop en de tijdige tv-bingoclaim moeten
nog worden gerepeteerd. Gebruik uitsluitend volwassen testers en fictieve
kindprofielen. Een modeltest onder een aangenomen tv-vertraging kan de
claimregels controleren, maar vervangt deze tv-meting niet.

## Capaciteit en verkeer

Het ingestelde profiel is 720p/30 fps, H.264 1186 kbit/s + audio 64 kbit/s,
totaal circa 1,25 Mbit/s. WHIP geeft één laag door zonder hercodering; HLS
gebruikt één H.264/AAC-transcodering per uitzending. Een lagere kwaliteitslaag
is niet beschikbaar of als werkend geverifieerd.

Tweehonderd kijkers vragen theoretisch circa 250 Mbit/s aan media, exclusief
protocoloverhead, hertransmissies en andere apps. Bij twee uur kijken is dat
circa 225 GB uitgaand mediaverkeer; tien zulke shows circa 2,25 TB vóór
protocoloverhead. Dit is een raming, geen gemeten showverbruik. De HTTPS-proef laat op
dat moment voldoende netwerkmarge zien, maar bewijst geen SFU-/encoder-CPU,
buffering, TURN-capaciteit of gegarandeerde hostcapaciteit.

**Aanbeveling voor de première: geen nieuwe eigen uitzendroute voor 200
kijkers vrijgeven totdat de volledige proef slaagt.** Er is nog geen lager
gelijktijdig kijkersaantal stabiel gedurende de vereiste meetduur bewezen.
Laat de bestaande uitzendroute beschikbaar zolang die vrijgave ontbreekt.
De verkeersbundel en het verwachte aantal shows moeten met het daadwerkelijke
Hetzner-account worden vergeleken; via SSH is die bundel niet vastgesteld.
Er is geen nieuw betaald streamingabonnement aangemaakt.

## Herhalen en vrijgeven

Volg [LIVEKIT-STAGING.md](LIVEKIT-STAGING.md) voor de bediening, poorten,
configuratie en rollback en [MEDIA-BELASTINGTEST.md](MEDIA-BELASTINGTEST.md)
voor testbron, externe generator, fasebewaking en metingen. Controleer eerst
publieke ICE en TURN met vastgelegd geselecteerd IP/poort, hoorbare audio,
werkelijke codec, fps en bitrate. Het harnas weigert een te lichte bron als
bewijs voor het afgesproken 1,25-Mbit/s-profiel.

Voer daarna alle fases uit, inclusief browserdecode naast werkelijke
RTP-ontvangst, een werkelijk actieve app-HLS-route, frame-tijdcodes en fysieke
tv-proeven. Leg testduur, netwerk, bron, sampleaantal en p50/p95 vast. Pas na
die resultaten kan een capaciteit/bitrate voor de première worden aanbevolen
en een aparte productie-uitrol worden afgesproken.
