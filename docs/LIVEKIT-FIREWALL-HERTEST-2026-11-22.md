# LiveKit: publieke hertest op 22 november 2026

<!-- RUN_STATUS_BEGIN -->
**Gemeten mediacapaciteit: 200 WebRTC-kijkers twintig minuten en 150 WebRTC + 50 HLS-kijkers tien minuten geslaagd na de HLS-verbetering. Een aanvullende HLS-browserdiagnose toont nog frameverlies. Fysieke OBS-/tv-/belrepetities en productie-uitrol blijven open. De oorspronkelijke HLS-doelmis blijft in dit rapport staan.**
<!-- RUN_STATUS_END -->
Deze proefopstelling is niet naar productie uitgerold. Dit is de hertest
na de melding dat de firewall is bijgewerkt. Het [eerdere meetrapport](LIVEKIT-METING-2026-11-22.md) blijft
de geschiedenis van de toen mislukte publieke ICE-proef.
De nieuwe bewijsbestanden staan in
[verification/media/load/2026-11-22-firewall-retry](../verification/media/load/2026-11-22-firewall-retry).

**Huidige stagingversie:** `d7d14958afe1b000d6da4f4310c0aab02c88da36`,
release `45056211553-1`. De eerste 25→200-WebRTC-duurproef gebruikte de
hieronder afzonderlijk genoemde eerdere app- en meetsoftwareversies.

## Omgeving en versies

- Show-VPS: `dg-nxttrack-01`, Hetzner FSN1, vier vCPU's, circa 7,56 GiB RAM,
  publiek `128.140.93.95` en `2a01:4f8:c015:60a6::1`. Bestaande Caddy op
  HTTPS 443 blijft de app en andere projecten bedienen.
- Generator: `codex-worker-01`, Hetzner HEL1, twaalf vCPU's, `65.108.158.112`.
  Echte publieke verbinding tussen twee VPS'en; geen Tailscale-mediapad,
  wifi, mobiel netwerk of tv-netwerk.
- Appversie van de eerste 25→200-WebRTC-proef: `556ccfab07f5e76c9e87b307e70bc00591a43238`, release
  `45045655508-1`, op de doelhost gecontroleerd om 16:50:18 UTC.
- Meetsoftware van die eerste proef: `cb794920f298a850ce4e9c01b2d7d69733d29457`, inclusief de
  decoder-/720p-correcties uit `7e2f25ce004376e05776c445b78d299f907c0770`;
  LiveKit CLI `2.20.1`, echte Chromium-decoders naast CLI-RTP-ontvangers.
- SFU: LiveKit `1.13.11`, upstreamcommit
  `385aa40f9292fe1db8caad87301e4b285b7c198a`, met uitsluitend de TLS-poortpatch.
  Image `milo-livekit-staging:1.13.11-turn-tls-port-v1`,
  image-ID `sha256:da859cfc55bdf8a1f8bddc86f61647323114236f8bdde15a9aed944648459472`,
  binary-SHA-256 `4c2fb55fd6b065a292c03c8f84fca248d7fa268ca9a04fe279f250e7af69e1ed`.
  De externe build gebruikte twee CPU's en 2 GiB geheugen; runtime-UID
  `65532:65532` bleef behouden.

De [SFU-build](../verification/media/load/2026-11-22-firewall-retry/sfu-build.json)
en [activatie](../verification/media/load/2026-11-22-firewall-retry/sfu-activation.json)
leggen hashes, vier gerichte Go-tests en vervanging van uitsluitend de eigen
SFU vast. Caddy-hashes en andere mediacontainer-ID's bleven gelijk; de
productie-appservice is daarbij niet herstart. De
[andere gecontroleerde sites](../verification/media/load/2026-11-22-firewall-retry/neighbor-health.json)
gaven HTTP 200.

## Vier bevindingen uit echte media

1. **WHIP-tracknamen.** De Ingress 1.6.0-bypass stuurt SDP door naar de SFU.
   LiveKit 1.13.11 maakt daarbij `synthesized-camera` en
   `synthesized-microphone`, ook wanneer CreateIngress andere namen opslaat.
   App/server gebruiken nu precies deze twee namen met de gereserveerde
   programmapublisher. De strikte scheiding van privé-/backstageaudio blijft
   behouden; een providerfixturetest controleert ook de HLS-trackselectie.
2. **Audio-decodertest.** Er kwamen Opus-pakketten binnen, maar Chromium
   activeerde de decoder nog niet voor de WebAudio-analyser. Een werkelijk
   afspelend media-element activeert deze nu; volume nul houdt alleen de
   testmachine stil. De analyser meet ontvangen PCM vóór die uitvoerdemping.
   Recente PCM en afspeelstatus zijn vereist, niet alleen RTP-bytes of een
   eerdere activatie. Dit is geen claim over hoorbaar geluid op een fysieke tv.
3. **Werkelijke 720p.** De browserencoder verlaagde een 720p-canvas naar
   480×270. De WHIP-bron gebruikt nu `maintain-resolution`; de test controleert
   werkelijk gedecodeerde 1280×720-frames gedurende de volledige bezetting.
   Het profiel is 30 fps, H.264 1186 kbit/s plus Opus 64 kbit/s: circa
   1,25 Mbit/s, één laag zonder WHIP-hercodering. Een lagere laag is niet bewezen.
4. **TURN/TLS-advertentie.** Upstream adverteerde 443 terwijl de eigen
   listener op 5349 staat en Caddy 443 gebruikt. De reproduceerbare
   [providerpatch](../infra/media/LIVEKIT-PATCH.md) adverteert de ingestelde
   TLS-poort. Dynamische credentials, TTL, UDP, certificaten en een ingestelde
   443-configuratie behouden het bestaande gedrag.

De eerste TLS-listenerdiagnose herschreef alleen in het geheugen van de
testkijker de geadverteerde 443 naar 5349. Die bewees de listener, **niet** de
ongewijzigde appfallback. Na activatie van de patch is opnieuw echte media
ontvangen met de normale serveradvertentie en SDK, zonder URL-/poortoverride.
Dat tweede bewijs is de acceptatie van de TLS-route.
TURN/TLS is hier op 5349 getest; een netwerk dat uitsluitend uitgaand TCP
443 toestaat valt buiten dit bewijs. Caddy blijft op 443 en is niet voor
TURN omgebouwd.

## Korte publieke controles

| Route | Werkelijke controle | Resultaat en grens |
| --- | --- | --- |
| TCP | Extern naar 443, 7881 en 5349 | Alle verbonden, circa 39 ms; geen mediacapaciteitsbewijs |
| HTTPS-netwerkmarge | 750 MB target → generator in 15,23 s, begrensd op 400 Mbit/s | 393,90 Mbit/s; tijdelijke route opgeruimd, geen WebRTC-capaciteitsbewijs |
| WHIP → WebRTC-browser | Werkelijke H.264/Opus-bron, publieke SFU-IPv6 op 7882 | 1280×720 gedecodeerd, PCM circa 0,214 RMS, nul gemeten pakketverlies; geen duur-/200-kijkersbewijs |
| TURN/UDP | Eén kijker, twaalf controlemetingen, 11,04 s tussen eerste/laatste | A/V `relayProtocol:udp`, UDP 3480, 720p/PCM 0,228 RMS; beeld p50/p95 72/82 ms, 11 tijdcodes; nul verlies, drie freezes samen 0,616 s |
| TURN/TLS na patch | Eén kijker, twaalf controlemetingen, 11,04 s tussen eerste/laatste, geen override | A/V `relayProtocol:tls`, eigen TLS 5349, 720p/PCM 0,222 RMS; beeld p50/p95 80/94 ms, 11 tijdcodes; nul verlies, twee freezes samen 0,401 s |
| HLS-browser | Eén echte externe Chromium-decoder, eigen getekende app-playlist, 20,06 s | 1280×720, 30,01 fps, PCM maximaal 0,241 RMS, nul dropped frames/HTTP-fouten; beeld p50/p95 **6871/6882 ms**, 20 tijdcodes. Geen tv-, Cast-, AirPlay- of OBS-meting |

Bij native TLS: gedecodeerd 28,71 fps, circa 1,237 Mbit/s ontvangen media,
eerste beeld 845 ms en eerste hoorbare PCM 8030 ms inclusief bronstilte.
De gekozen A/V-relay wees naar publieke SFU `128.140.93.95:7882`, met
`turns:milo-staging.dgwebservices.nl:5349?transport=tcp` en credentials uit
de normale JoinResponse. De hosttellers groeiden uitsluitend op de gekozen
TURN-route: 2.843.640 bytes bij UDP, 3.525.293 bytes bij native TLS. Deze
tellers omvatten protocoloverhead en zijn hostbreed.

Bewijs: [TCP](../verification/media/load/2026-11-22-firewall-retry/external-tcp.json),
[HTTPS-marge](../verification/media/load/2026-11-22-firewall-retry/https-margin.json),
[WHIP/AV](../verification/media/load/2026-11-22-firewall-retry/public-whip-av.json),
[UDP](../verification/media/load/2026-11-22-firewall-retry/turn-udp.json),
[eerste TLS-diagnose](../verification/media/load/2026-11-22-firewall-retry/turn-tls-listener-diagnostic.json),
[native TLS](../verification/media/load/2026-11-22-firewall-retry/turn-tls-native-final.json)
en [HLS-browser](../verification/media/load/2026-11-22-firewall-retry/hls-single-browser.json).

## Capaciteitsproef

Deze tabellen volgen uitsluitend het werkelijke
[capaciteitsrapport](../verification/media/load/2026-11-22-firewall-retry/capacity/report.json).
Een lopende of niet gestarte fase telt niet als geslaagd. De publieke WHIP-bron
toont beweging, grote cijfers, tijdcode en vooraf opgenomen Nederlandse
nummeroproepen. Geen echte gezinnen of kinderen worden gebeld.

De meetduur begint bij onafhankelijk geobserveerde volledige bezetting.
Per WebRTC-fase: drie echte browserdecoders plus CLI-kijkers die echte audio-
en videopakketten ontvangen. Gemengd: aanvullend één echte HLS-decoder en
49 continu volgende HLS-clients. De duurproef gebruikt publieke directe
UDP-WebRTC. TURN/UDP en TURN/TLS zijn daarnaast elk kort met één echte
ontvanger getest; er is geen capaciteitsbewijs voor 200 gelijktijdige
TURN-relayontvangers.
De proef belast echte mediatracks met drie WebRTC-decoders en bij de
gemengde fase één HLS-decoder. Er draaien geen 200 volledige
gezinsapp-, chat- of bestelbrowserflows. Het capaciteitsadvies geldt daarom
voor de gemeten mediaroute onder dit profiel en netwerk; appcontract- en
browserchecks uit CI vormen afzonderlijk bewijs, geen algemene garantie
voor alle premièreflows tegelijk.
CRC-gecontroleerde frame-tijdcodes meten
bron → browserbeeld met dezelfde generator-klok. Netwerk-RTT telt niet als
beeldvertraging. CPU/TX zijn hostmetingen inclusief andere diensten; RAM is
het minimum beschikbare hostgeheugen, niet uitsluitend het SFU-proces.

De decoder-screenshots tonen duidelijk leesbare cijfers op het technische
720p-testbeeld in Chromium. Ze beoordelen niet de volledige showdecor-layout
of de leesbaarheid op een fysieke tv.

<!-- CAPACITY_RESULTS_BEGIN -->
Rapportstand: 17:48:18 UTC. Bron: uitsluitend het capaciteitsrapport; een lopende fase is geen geslaagde duurproef.

| Fase | Vereiste volle bezetting | Werkelijke duur | AV-succes | Status | WebRTC p50/p95 ms · aantal | HLS p50/p95 ms · aantal |
| --- | --- | --- | --- | --- | --- | --- |
| 25 WebRTC | 300 s | 312,5 s | 25/25 (100,0%) | Geslaagd | 82 / 121 · 931 | n.v.t. |
| 50 WebRTC | 300 s | 311,4 s | 50/50 (100,0%) | Geslaagd | 107 / 144 · 948 | n.v.t. |
| 100 WebRTC | 300 s | 309,9 s | 100/100 (100,0%) | Geslaagd | 140 / 201 · 980 | n.v.t. |
| 150 WebRTC | 300 s | 314,1 s | 150/150 (100,0%) | Geslaagd | 171 / 212 · 1014 | n.v.t. |
| 200 WebRTC | 1200 s | 1211,7 s | 200/200 (100,0%) | Geslaagd | 214 / 236 · 3713 | n.v.t. |
| 150 WebRTC + 50 HLS | 600 s | 614,1 s | 150/150 (100,0%); HLS 49/49 HTTP, decoder ja | Doel gemist | 164 / 195 · 1901 | 8229 / 8271 · 636 |

| Afgeronde fase | Media Mbit/s p50/p95 | Decode-fps p50/p95 | Resolutie gedurende volle bezetting | Eerste beeld ms p50/p95 | Reconnects / freezes | CLI-pakketverlies maximaal |
| --- | --- | --- | --- | --- | --- | --- |
| 25 WebRTC | 1,236 / 1,236 | 29,76 / 29,76 | 1280x720; alle controles goed | 534 / 549 | 0 / 9 | 0,00% |
| 50 WebRTC | 1,236 / 1,236 | 29,58 / 29,58 | 1280x720; alle controles goed | 534 / 555 | 0 / 3 | 0,00% |
| 100 WebRTC | 1,236 / 1,236 | 29,08 / 29,08 | 1280x720; alle controles goed | 532 / 609 | 0 / 4 | 0,00% |
| 150 WebRTC | 1,233 / 1,233 | 28,67 / 28,67 | 1280x720; alle controles goed | 519 / 525 | 0 / 3 | 0,00% |
| 200 WebRTC | 1,235 / 1,235 | 29,43 / 29,43 | 1280x720; alle controles goed | 521 / 535 | 0 / 55 | 0,00% |
| 150 WebRTC + 50 HLS | 1,235 / 1,235 | 29,23 / 29,23 | 1280x720; alle controles goed | 497 / 563 | 0 / 16 | 0,00% |

| Afgeronde fase | Host-CPU % p50/p95/max | Beschikbaar RAM min GiB | Host-TX Mbit/s p50/p95/max | TURN UDP/TLS bytes | SFU-Prometheusmetingen |
| --- | --- | --- | --- | --- | --- |
| 25 WebRTC | 29,3 / 32,3 / 33,3 | 4,60 | 34,0 / 34,5 / 34,8 | 94468 / 472142 | 54 |
| 50 WebRTC | 35,3 / 38,0 / 38,4 | 4,54 | 67,8 / 68,9 / 69,1 | 216812 / 1082032 | 55 |
| 100 WebRTC | 41,6 / 45,2 / 46,6 | 4,38 | 135,8 / 137,3 / 137,7 | 451656 / 2321794 | 57 |
| 150 WebRTC | 46,1 / 49,5 / 51,0 | 4,22 | 203,5 / 206,1 / 206,8 | 712920 / 3587890 | 59 |
| 200 WebRTC | 51,6 / 54,7 / 56,8 | 4,03 | 270,9 / 275,0 / 278,7 | 2316456 / 10018346 | 213 |
| 150 WebRTC + 50 HLS | 52,3 / 55,5 / 57,1 | 3,95 | 277,5 / 282,1 / 284,1 | 1033640 / 4868473 | 109 |

Bitrate/fps: gemiddelden per echte browser, daarna p50/p95 over de drie browsers. Eerste beeld: drie browsermetingen. Freezes zijn cumulatieve browserstatistieken; het rapport vat browserpakketverlies niet afzonderlijk samen, daarom vermeldt de tabel expliciet het maximale CLI-trackverlies. Hostcijfers omvatten ook andere diensten en de encoder. TURN-tellers zijn de eigen listeners, hostbreed.

Gestopte fase: mixed-150-50.

Rapportfout: Opschaling gestopt: het vorige niveau haalt de gemeten doelen niet.

Rapport geëindigd: 2026-11-22T17:48:06.709Z.
<!-- CAPACITY_RESULTS_END -->

Gecomprimeerde bronlogs zijn afzonderlijk bewaard:
[oorspronkelijke HLS-ontvangst](../verification/media/load/2026-11-22-firewall-retry/capacity/mixed-150-50-hls.json.gz),
[oorspronkelijke HLS-decoder](../verification/media/load/2026-11-22-firewall-retry/capacity/mixed-150-50-hls-browser.jsonl.gz),
[r2-HLS-ontvangst](../verification/media/load/2026-11-22-firewall-retry/mixed-one-second-r2/mixed-150-50-hls.json.gz)
en [r2-HLS-decoder](../verification/media/load/2026-11-22-firewall-retry/mixed-one-second-r2/mixed-150-50-hls-browser.jsonl.gz).
De zes oorspronkelijke CLI-logs staan in het
[capaciteitsarchief](../verification/media/load/2026-11-22-firewall-retry/capacity).

De oorspronkelijke gemengde proef met segmenten van twee seconden hield
150 WebRTC- en 50 HLS-kijkers 614,1 seconden vast. Alle 49 HTTP-kijkers
bleven de liveplaylist en segmenten volgen en de vijftigste HLS-kijker
decodeerde werkelijk beeld en audio. Het vertragingsdoel werd gemist:
HLS p95 **8271 ms** ligt boven het streefmaximum van 8000 ms. WebRTC bleef
p95 195 ms; de drie WebRTC-decoders voldeden aan de resolutie-, bitrate- en
fps-gates. Een HLS-verbeterproef wordt afzonderlijk vastgelegd; deze
oorspronkelijke uitkomst blijft behouden.

De [afzonderlijke HLS-decodeanalyse](../verification/media/load/2026-11-22-firewall-retry/mixed-hls-decode-quality.json)
meet 17.874 nieuw weergegeven frames over 603,5 seconden tussen de eerste
en laatste samples binnen volle bezetting: 29,62 fps. De teller voor
gedropte frames groeide daar van 14 naar 185, dus 171 extra; de eindcontrole
over de hele fase telde 19.389 frames waarvan 185 gedropt. Er waren geen
reconnects of disconnects. De probe telde nul stalls met een drempel van
drie seconden; een waargenomen vertragingstap van circa 1,98 seconde valt
buiten die teller. PCM bereikte 0,288 RMS; het grootste geobserveerde gat
sinds hoorbare PCM was 12,356 seconden, inclusief stiltes in de bron.
De oorspronkelijke lange HLS-samples registreerden geen videobreedte en
hoogte. Het eerdere 20s-bewijs van 720p bewijst daarom niet de resolutie
tijdens de gehele gemengde duurproef; de retry voegt deze meting toe.

De 200-kijkersfase hield de volle bezetting 1211,7 seconden vast: 200/200
A/V-ontvangers, geen reconnects, p95-beeldvertraging 236 ms over 3713
werkelijk gedecodeerde tijdcodes. Er waren **55 cumulatieve freeze-events
over de drie browserontvangers**; dit is geen bewijs van haperingsvrije
weergave. De [afzonderlijke freeze-analyse](../verification/media/load/2026-11-22-firewall-retry/200-freeze-analysis.json)
splitst de opbouwfase en de volle bezetting. Tijdens volle bezetting waren
het negen korte freeze-events per browser, samen circa twee seconden per
browser; de langste afzonderlijke waarneming was 318 ms. Er waren geen
probevastlopers, disconnects of gedropte RTC-frames in deze drie decoders.

| Browser | Hele fase: freeze-events / som seconden | Volle bezetting: events / som seconden | Langste freeze tijdens volle bezetting | p95 tijdcode tijdens volle bezetting |
| --- | --- | --- | --- | --- |
| 1 | 18 / 4,424 s | 9 / 2,038 s | 313 ms | 237 ms |
| 2 | 18 / 4,450 s | 9 / 2,036 s | 318 ms | 234 ms |
| 3 | 19 / 4,813 s | 9 / 2,024 s | 312 ms | 233 ms |

Dit zijn drie geïnstrumenteerde browserdecoders, geen 200 geïnstrumenteerde
renderers. Tijdens de fase is ook tijdelijke extra CPU-belasting op de
generator waargenomen; slechts drie van de 27 freeze-intervallen bij volle
bezetting lagen binnen tien seconden van zo'n waarschuwing. Dit bewijst geen
causaal verband met de generator, SFU of het netwerk. De browsermetriek is
geen teller voor uitval van de gehele uitzending.

De [afzonderlijke generatorbewaking](../verification/media/load/2026-11-22-firewall-retry/generator-final-summary.json)
bevat 774 hostmetingen tussen 16:52:42 en 19:01:35 UTC op twaalf CPU's en
22,91 GiB RAM. Er waren zes CPU-waarschuwingen boven 85%, allemaal tijdens
de oorspronkelijke 200-fase. De tiensecondenmeting en expliciete gaten aan
de fasegrenzen sluiten kortere pieken niet uit. Andere bouwactiviteit telt
mee in deze hostcijfers; er wordt geen oorzaak van frameverlies aan
toegeschreven. De eigen bewakingssampler is na de proef gestopt.

## Afzonderlijke HLS-verbeterproef

Commit `b2f3e41c3f39123a4170371f5d2d4fd87f9b151e` zet uitsluitend de
HLS-segmentduur en het H.264-keyframeinterval van twee naar één seconde.
De afspeelpolicy blijft gelijk. De gepinde Egress 1.15.0-bron accepteert één
seconde: alleen nul krijgt de standaard van vier seconden in
[`output_segment.go`](https://raw.githubusercontent.com/livekit/egress/v1.15.0/pkg/config/output_segment.go).
De pipeline gebruikt de ingestelde duur als segmentgrens en vraagt
keyframes aan in
[`builder/segment.go`](https://raw.githubusercontent.com/livekit/egress/v1.15.0/pkg/pipeline/builder/segment.go).
Dit onderbouwt de gerichte configuratiekeuze; de werkelijke segmentduur en
vertraging moeten opnieuw worden gemeten.

De code en retrysoftware staan op
`2224006eafe38b09564b8d144490b90dcf8e4e0d`.
[CI](https://github.com/milobingo/platform/actions/runs/45051364067) slaagde,
inclusief lint, contracttests, build, typecheck en browseracceptatie.
[Stagingdeployment](https://github.com/milobingo/platform/actions/runs/45052495636)
slaagde; de publieke releasecontrole bevestigde `45052495636-1` met exact
die commit. De [werkelijke 1s-feedcontrole](../verification/media/load/2026-11-22-firewall-retry/one-second-hls-ready.json)
bevestigde vervolgens HTTP 200, `TARGETDURATION:1` en vijf segmenten van
precies 1,000 seconde. De encoder vroeg 1280×720/30 fps aan; ffprobe leverde
geen resultaat, dus werkelijk gedecodeerde dimensies moeten nog uit de
browserhertest komen.

De [eerste retry](../verification/media/load/2026-11-22-firewall-retry/mixed-one-second/report.json)
stopte om 18:08:03 UTC vóór de CLI-belasting: de private configuratie gaf
als gecontroleerd HLS-pad een volledige URL op. Dit is een opzetfout,
geen prestatiemeting. Alleen de private padbinding is gecorrigeerd; de
veiligheidscontrole bleef intact. Het afgebroken rapport blijft behouden.

De [tweede, afzonderlijke retry](../verification/media/load/2026-11-22-firewall-retry/mixed-one-second-r2/report.json)
met 150 WebRTC- en 50 HLS-kijkers stopte om 18:14:38 UTC:
`HLS-kijker hls-39 verloor de ononderbroken segmentontvangst.` De vereiste
600 seconden zijn niet als geslaagde volle bezetting vastgelegd; dit is
geen geslaagde capaciteits- of vertragingsmeting.

Het [afzonderlijke gedeeltelijke decoderbewijs](../verification/media/load/2026-11-22-firewall-retry/mixed-one-second-r2/hls-decoder-partial-evidence.json)
begrenst de waargenomen volle bezetting vóór die fout tot 299,387 seconden,
geen 600s-PASS. Binnen dat venster: 51 HLS-snapshots allemaal 1280×720,
30,00 fps over 296,559 seconden samples, nul gedropte frames, reconnects of
HLS-foutevents, en verse PCM bij alle samples. De 293 echte tijdcodes meten
p50/p95 **3965/3989 ms**, maximaal 4087 ms. Dit toont de lagere vertraging
van de 1s-feed tijdens dat gedeeltelijke venster; de ononderbroken
600s-proef blijft vereist.

De [r2-HTTP-analyse](../verification/media/load/2026-11-22-firewall-retry/mixed-r2-http503-analysis.json)
vond precies één HTTP 503 onder de 49 HTTP-clients. Diezelfde client
ontving segment 497 na 496, zonder sequentiegat; de ontvangstpauze was
3,067 seconden inclusief de ingestelde 2s-herkansingspauze. Een fout
onderbreekt de vereiste ononderbroken meetduur en de gate blijft behouden.
Het oude foutrecord bevat geen requesttype of servercode, waardoor de
503-oorzaak niet met zekerheid achteraf vaststaat.

Een [afzonderlijke read-only playlistobservatie](../verification/media/load/2026-11-22-firewall-retry/playlist-truncate-race-observation.json)
mat daarna gedurende vijf seconden 15 lege/onvolledige snapshots terwijl
Egress hetzelfde playlistbestand herschrijft. Dat is een werkelijk
waargenomen bestandsrace, zonder extra kijkers. Het bewijst niet dat juist
de oude 503 hierdoor ontstond.

Commit `d7d14958afe1b000d6da4f4310c0aab02c88da36` leest een tijdelijke lege of
onvolledige playlist opnieuw, maximaal drie verse opens met twee pauzes
van 10 ms. Elke open behoudt de pad-, bestandstype-, hardlink-/symlink- en
groottelimieten. Ongeldige URI's blijven ongeldig; segmentbestanden krijgen
geen retry. Lokale gerichte tests: 12 broadcast- en 28 loadchecks geslaagd.
[De volledige CI](https://github.com/milobingo/platform/actions/runs/45054924092)
voor deze exacte commit is geslaagd. De
[stagingdeployment](https://github.com/milobingo/platform/actions/runs/45056211553)
is geslaagd, inclusief publieke verificatie: release `45056211553-1` met
dezelfde commit. De daaropvolgende afzonderlijke duurproef staat hieronder;
opzetfouten en eerdere doelmissers blijven afzonderlijk bewaard.

De [derde retry](../verification/media/load/2026-11-22-firewall-retry/mixed-one-second-r3/report.json)
stopte op 18:45:17 UTC vóór de CLI-belasting doordat het pad van de private
HLS-playlist-URL niet overeenkwam met de gecontroleerde nieuwe prefix.
Dit is een tweede opzetfout, geen prestatiemeting en geen uitkomst over
de playlistfix. Alleen de private binding wordt tegen de werkelijk
bereikbare playlist en manifest bevestigd; code en guard blijven gelijk.
De [vierde, afzonderlijke proef](../verification/media/load/2026-11-22-firewall-retry/mixed-one-second-r4/report.json)
startte na die kruiscontrole om 18:46:42 UTC en eindigde om 18:57:45 UTC
met **PASS**, `complete:true`. De volle bezetting hield 613,702 seconden
stand. Alle 49 HTTP-kijkers volgden de feed doorlopend, zonder HTTP-fouten
of sequentiestalls; één extra HLS-browser decodeerde werkelijk beeld en
audio. De afspeelpolicy is gelijk gebleven en de continuïteitsgate is niet
versoepeld. Het oorspronkelijke rapport met de 8271 ms-doelmis en alle
afgebroken retryresultaten blijven behouden.

| R4 | Werkelijke volle bezetting | A/V-verbindingen | WebRTC beeld p50/p95 · samples | HLS beeld p50/p95 · samples | Eerste beeld WebRTC p50/p95 / HLS |
| --- | --- | --- | --- | --- | --- |
| Geslaagd | 613,702 s | 150/150 WebRTC; 49/49 HLS-HTTP + 1 echte HLS-decoder | 167/192 ms · 1896 | 4331/4379 ms · 638 | 552/553 ms / 590 ms |

| R4-mediakwaliteit | Meting |
| --- | --- |
| Drie WebRTC-browsers | 1280×720 bij alle 103 controles per browser; bitrate p50/p95 1,234/1,234 Mbit/s; decode-fps p50/p95 29,20/29,20 |
| Reconnects / cumulatieve RTC-freezes | 0 / 14 over de drie browsers; geen claim van haperingsvrije weergave |
| Maximaal CLI-trackpakketverlies | 0,00% |
| Host-CPU p50/p95/max | 54,69/58,13/61,14% |
| Beschikbaar host-RAM minimum | 3,79 GiB |
| Host-TX p50/p95/max | 276,61/280,35/282,46 Mbit/s |
| TURN UDP/TLS-listenerbytes, hostbreed | 1.063.736 / 4.867.621 |
| Host-/SFU-Prometheusmetingen | 109 |

De [ruwe r4-logs en decoder-screenshots](../verification/media/load/2026-11-22-firewall-retry/mixed-one-second-r4)
blijven beschikbaar naast het rapport. De
[HLS-HTTP-continuïteitsanalyse](../verification/media/load/2026-11-22-firewall-retry/mixed-one-second-r4/hls-http-continuity-summary.json)
bevestigt 31.624 ontvangen segmenten, 645–646 per HTTP-kijker, elk
644,728–645,403 seconden doorlopend. Alle 49 bleven actueel; nul
HTTP-fouten, sequentiegaten of HTTP-stalls. Dit zijn pakket-/segmentkijkers;
de vijftigste HLS-kijker is de ene afzonderlijke echte browserdecoder.

De [HLS-decodeanalyse tijdens volle bezetting](../verification/media/load/2026-11-22-firewall-retry/mixed-one-second-r4/hls-decoder-evidence.json)
laat ook een korte hapering zien; er is geen claim van haperingsvrije
weergave. De fasetabel gebruikt 638 tijdcodes over de hele fase. Binnen
volle bezetting liggen 602 tijdcodes met p50/p95 4335/4379 ms, maximaal
4400 ms.

| Werkelijke HLS-browser bij volle bezetting | Meting |
| --- | --- |
| Snapshotdekking | 103 snapshots over 603,241 s; eerste 5,893 s na begin volle bezetting, laatste 4,568 s vóór einde |
| Resolutie en audio | Alle snapshots 1280×720 en verse PCM; maximale PCM-leeftijd 12,489 s inclusief bronstiltes, maximum 0,284 RMS |
| Weergegeven fps / gedropte frames | 29,34 fps; 373 extra gedropte frames in dit venster, 450 over de hele fase |
| Reconnects / disconnects / fatale HLS-fouten | 0 / 0 / 0 |
| Niet-fatale HLS-fout | Eén `bufferStalledError` om 18:51:53,602 UTC, met circa 842 ms toegenomen beeldvertraging |
| Probe-stalls | 0 met een drempel van 3 s; de kortere hapering valt buiten die teller |
| Buffer vooruit, minimum/mediaan | 0,118/1,059 s |

Een technische browser is geen fysieke Cast-/AirPlay- of OBS-test. De
HLS-HTTP-continuïteit vervangt geen bewijs van beeldafspelen bij 50 echte
decoders of tv's.

## Aanvullende HLS-browserdiagnose

Na r4 is [één HLS-browser zonder de WebRTC-bulkbelasting](../verification/media/load/2026-11-22-firewall-retry/hls-alone-sixty/report.json)
60,204 seconden geobserveerd met dezelfde bestaande bron en feed. Deze
diagnose heeft `completed:false`: 26,94 fps haalde de vooraf ingestelde
27fps-diagnosegrens niet. Beeld was werkelijk 1280×720, PCM aanwezig,
eerste beeld 598 ms en p50/p95-beeldvertraging 3435/3449 ms over 60
tijdcodes. Er waren geen HTTP-fouten; de browser telde 179 gedropte frames
en één niet-fatale stall. De probe telde nul stalls boven zijn drempel
van drie seconden. De eigen browser is afgesloten en de bron bleef gelijk.

Dit toont frameverlies ook zonder de bulkbelasting; het stelt de oorzaak
niet vast. De [afzonderlijke decodervergelijking](../verification/media/load/2026-11-22-firewall-retry/hls-alone-sixty/decoder-comparison.json)
legt de standalone- en bulkmetingen naast elkaar. Het geslaagde
r4-capaciteitsrapport blijft ongewijzigd. HLS in
deze Chromium-test bewijst geen haperingsvrije tv-weergave: de fysieke
Cast- en native AirPlay-ontvangers hebben een eigen afspeelbeleid dat nog
op de werkelijke apparaten moet worden getest.

## Netwerkherstel: CDP-pogingen en echte TURN/TLS-proef

Na de zes fases zijn twee afzonderlijke probes met één technische ontvanger
uitgevoerd, zonder bron-, fixture- of firewallwijzigingen. Chromium
accepteerde `packetLoss:100` via zowel
[`Network.emulateNetworkConditions`](../verification/media/load/2026-11-22-firewall-retry/viewer-network-recovery.json)
als
[`Network.emulateNetworkConditionsByRule`](../verification/media/load/2026-11-22-firewall-retry/viewer-network-recovery-byrule.json)
met een lege globale URL-regel, maar bestaande RTP-media bleef binnenkomen.
Bij de tweede poging kwamen na de drain nog 1.410.998 bytes en 252 nieuwe
frames binnen in 9,041 seconden. De bewijsgate voor een echte onderbreking
faalde daarom bij beide pogingen. **Uit deze twee CDP-pogingen wordt geen
netwerkverlies of succesvol herstel geclaimd.** Beide emulaties zijn
teruggezet en beide ontvangers ontkoppeld.

Daarna is een [werkelijke, begrensde
TURN/TLS-onderbreking](../verification/media/load/2026-11-22-firewall-retry/turn-network-recovery-5b8a410f2e93-complete.json)
uitgevoerd voor één technische ontvanger. Alleen de eigen externe
TURN/TLS-stroom naar 5349 werd maximaal 15 seconden geblokkeerd; de
UDP-bron, signalering en geverifieerde lokale Egress-verbinding bleven
behouden. De host telde 139 gedropte pakketten, 229.584 bytes. Na twee
seconden drain volgden 9,035 seconden met nul RTP-bytes en nul nieuwe
videoframes: de onderbreking had werkelijk effect.

Na het vervallen van de blokkade kwamen beeld/RTP binnen **0,917 seconde**
terug. Het eerste herstelde beeld was nog oud: de tijdcode liep 15,888
seconden achter. De eerstvolgende gemeten actuele tijdcode verscheen
**4,220 seconden** na het vervallen van de blokkade met 193 ms
beeldvertraging; de volgende gemeten tijdcodes lagen op 60–102 ms. Eerste
beeldontvangst betekent hier dus niet onmiddellijk herstel naar het
actuele livepunt; het [tijdcode-overzicht](../verification/media/load/2026-11-22-firewall-retry/turn-network-recovery-5b8a410f2e93-timecode-clarification.json)
legt dit apart vast. Verse PCM samen met 720p/TLS werd na **11,999 seconden**
waargenomen; de bron spreekt een nummer per 15 seconden en bevat
tussendoor stilte. Die 11,999 seconden betekenen daarom niet twaalf
seconden netwerkherstel.
Daarna is nog 3,005 seconden ontvangst geobserveerd, circa 25,96 fps.
`Room.connect` werd één keer aangeroepen, de brontrack-SID's bleven gelijk
en de SDK telde nul reconnects/disconnects. De tijdelijke kijker is weg.
Dit bewijst mediaherstel van deze technische TLS-ontvanger, geen fysieke
tv-, gezins-UI- of belrepetitie.

De [afzonderlijke regelsvergelijking](../verification/media/load/2026-11-22-firewall-retry/turn-network-rules-comparison-5b8a410f2e93.json)
behoudt de aanvankelijk mislukte ruwe hashvergelijking: vier veranderde
telemetrievelden, namelijk packet-/bytetellers van `tls_in` en `tls_out`,
verklaren het verschil. Na uitsluitend die veldnormalisatie zijn alle 396
objectdefinities identiek; de oorspronkelijke mismatch is niet gewist.
De [finale eigen-probecleanup](../verification/media/load/2026-11-22-firewall-retry/turn-network-cleanup-final-5b8a410f2e93.json)
bevestigt dat de eigen nft-tabel, timer en service weg zijn, Egress
`COMPLETE` is en de eigen room leeg is. Er zijn geen database- of
productiemutaties. Fixture en Ingress zijn behouden voor de volgende
hertest; dit is geen claim dat de gehele testfixture verwijderd is.

## Technische privé-/programma-audio daadwerkelijk ontvangen

De [audio-isolatieproef](../verification/media/load/2026-11-22-firewall-retry/audio-isolation-live.json)
heeft gedurende 27,295 seconden echte LiveKit-audiotracks over het netwerk
ontvangen met de bestaande callgrants, `LiveKitMedia`-routering en
`LiveCallAudio`-productiemixer. Vier synthetische tonen markeerden show,
regie, gast en presentator. Alle zeven spectrale controles zijn geslaagd;
de aanwezigheidsgrens was amplitude 0,015 en de afwezigheidsgrens 0,004.

| Controle | Werkelijk gemeten uitkomst |
| --- | --- |
| Privé: regie hoort gezin | Alleen de gasttoon; geen show-, regie- of presentatortoon |
| Privé: gezin hoort regie | Alleen de regietoon; geen eigen stem, show of presentator |
| Privé: programma | Alleen de show; geen privégesprek |
| Live: programma | Show, geselecteerde gast en presentator; geen regietoon |
| Live: gastretour | Presentator; geen eigen gaststem, regie of showmix |
| Voorbereide AI-invoer | Alle tonen afwezig; geen AI-/betaalde API-aanvraag |
| Na afsluiten: programma | Alleen de show; gast en presentator verwijderd |

De technische outputguard blokkeerde privé-uitvoer vóór een tokenaanvraag;
er werd geen privé-outputtoken uitgegeven. De drie eigen technische rooms
zijn gesloten, lokale tracks gestopt, de brontrack-SID's bleven gelijk en
er bleven nul loadkijkers over. Er zijn geen echte kinderen of
gezinsaccounts gebruikt.

De [samenvatting van de echte audioproef](../verification/media/load/2026-11-22-firewall-retry/audio-isolation-live-summary.json)
legt ook de publicatiegrens vast: de SDK weigerde een publicatie onder het
door de server uitgegeven `canPublish:false`-grant; de regiedeelnemer had
nul publicaties. Er is geen afzonderlijke RPC-/wire-403 vastgelegd of
geclaimd.

Dit is bewijs van echt audiotransport en de bestaande mixer, **geen**
repetitie van toestemming, gezinslogin, regieknoppen, showrunner,
trekkingsblokkade, OBS of fysieke apparatuur. Er zijn geen duurzame
appbelstatussen aangemaakt en de centrale Cloud-providerconfiguratie is
niet gewijzigd. De volledige belrepetitie met volwassen testers blijft
apart nodig.

## Laatste omgevingscontrole

De aanleverende WHIP-testbron is om 19:01:39 UTC netjes gestopt met exit 0.
De [finale fixture- en omgevingscontrole](../verification/media/load/2026-11-22-firewall-retry/final-fixture-cleanup-proof.json)
bevestigt dat de eigen testfixture, HLS-map en private rootsessie verwijderd
zijn. Alle elf oorspronkelijke echte databaserijen hebben dezelfde
digests. Er zijn nul providerrooms, Ingress-resources of actieve Egress-taken
over. De bewaarde verwijdermanifesten leggen de eigen opruiming vast.

De productie-app bleef op PID `545053`, commit `aab35f8` en revisiesom `26`.
De zeven oorspronkelijke buurconfiguraties en alle acht huidige
Caddy-fragmenten zijn gelijk gebleven; alle acht HTTP-controles gaven
200. De vier eigen mediacontainers behouden dezelfde ID's en images en
zijn actief. De tijdelijke nft-tabel, timer en service zijn weg. De eigen
activiteitsbewaking is gestopt na 105 staging- en 98 productiecontroles
zonder alerts. De permanente afgeschermde providerconfiguratie blijft
bestaan. De nulwaarde bij `releaseId` in deze cleanup-extractie is geen
releasecontrole; de afzonderlijke CI-/deploy- en bronbewijzen hierboven
bevestigen stagingrelease `45056211553-1`.

Na de gecontroleerde bewijsuitvoer zijn ook de negen exact toegestane
tijdelijke lokale credential-, capability- en diagnostiekkopieën
[verwijderd](../verification/media/load/2026-11-22-firewall-retry/local-private-copies-cleanup.json).
De permanente root-providerconfiguratie, SSH-sleutels en oorspronkelijke
bewijsrapporten zijn daarbij niet gewijzigd.

## Openstaande repetities en verkeer

Fysieke OBS-opname met beeld en hoorbare programmamix, Chromecast/Google TV,
iPhone/iPad/AirPlay, tv-leesbaarheid en apparaatgebonden p50/p95 ontbreken.
Een privé/live-belrepetitie met twee volwassen testers, bevestiging van
de technische audioscheiding in de werkelijke OBS-opstelling, geen dubbel
geluid en retour na caststop,
netwerkverlies/herstel in de gezins-UI en op fysieke apparaten, en een
echte tijdige tv-bingoclaim moeten nog worden vastgelegd. De claimmodeltest
met aangenomen acht seconden tv-vertraging vervangt de apparaatproef niet.

Voor 200 kijkers op 1,25 Mbit/s is twee uur theoretisch circa **225 GB**
uitgaand mediaverkeer; tien shows circa 2,25 TB, vóór overhead, hertransmissies
en ander VPS-verkeer. De werkelijk gemeten host-TX-mediaan bij 200 kijkers
was 270,88 Mbit/s: doorgetrokken naar twee uur circa **244 GB hostverkeer**.
De gemengde 1s-proef mat mediaan 276,61 Mbit/s: circa **249 GB** per twee
uur als hostverkeerprojectie. Dit zijn projecties inclusief het andere
gemeten hostverkeer, geen metingen van shows van twee uur of bewijs van de
beschikbare bundel. De werkelijke Hetzner-bundel en het verwachte aantal
shows zijn niet via deze beheerverbinding vastgesteld. De HTTPS-marge en
korte kijkerproeven zijn geen capaciteitadvies. De twee geslaagde
duurproeven ondersteunen nu **maximaal 200 gelijktijdige mediakijkers op
720p/30 fps en circa 1,25 Mbit/s per kijker**, onder het geteste
profiel en netwerk, met publieke directe UDP voor WebRTC en HTTPS voor
HLS. Zowel 200 WebRTC als 150 WebRTC + 50 HLS zijn werkelijk gemeten. Dit
is mediacapaciteit, geen bewijs voor 200 gedwongen
TURN-kijkers of 200 volledige gezinsapp-/chat-/bestelbrowserflows.
Fysieke OBS-/Cast-/AirPlay- en belrepetities blijven afzonderlijke controles
op de werkelijke apparaten. De bewezen technische TLS-herstelproef
vervangt de gezins-UI- en fysieke apparaatproeven niet. De opstelling blijft
op staging; productie-uitrol wordt apart afgesproken.
