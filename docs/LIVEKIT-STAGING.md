# Eigen uitzending op de bestaande Hetzner-VPS

Dit is een stagingopstelling. Productie gebruikt zijn bestaande release en
configuratie. Zet een show pas over nadat de echte media- en ontvangerproeven
zijn afgerond. De app schakelt bestaande shows niet automatisch om.

## Bedieningsroute

1. Open de Milo-show en **Uitzending testen → Rechtstreeks uitzenden & tv**.
2. Kies **Eigen uitzending voorbereiden**. Dit bewaart de keuze in de bestaande
   show en geeft alleen de eigenaar/regie de volledige geheime WHIP-URL.
3. OBS → Instellingen → Stream → WHIP. Gebruik die URL en het getoonde
   bearertoken. Neem alleen het bestaande programmabeeld en de Program-audiomix
   op; algemene desktopaudio en backstage horen daar niet bij.
4. Gebruik 1280×720, 30 fps, H.264, video 1186 kbit/s, Opus 64 kbit/s,
   sleutelbeeld elke twee seconden. WHIP-ingress codeert dit niet opnieuw.
   Er is één kwaliteitslaag. Een lagere laag is niet beschikbaar of getest.
5. Controleer beeld, Nederlands nummergeluid en leesbare cijfers op de
   familiepagina. Kies **Start tv-feed** nadat beide programmatracks binnen zijn.
   Cast/AirPlay worden pas beschikbaar met een werkelijk actieve HLS-playlist.
6. Test op de tv het actuele livepunt en de mixer. De telefoon blijft voor kaart
   en chat beschikbaar. Het telefoonbord onthult tijdens tv-weergave alleen
   expliciet als gehoord bevestigde ballen, zonder een geschatte synchronisatietimer.
7. **Stop tv-feed** stopt alleen HLS. **Stop eigen uitzending** beëindigt de
   programmaroom en nieuwe kijk-/publicatierechten. Deze acties starten of
   hervatten nooit de trekking en wijzigen geen claimvenster.

OBS is de encoder die doorgaat wanneer alleen de regietab sluit. OBS en het
uitzendvenster dat het opneemt moeten open blijven. De bestaande browserregie
blijft betrokken bij nieuwe showcues; dit is geen autonome showrunner na het
sluiten van alle studiovensters. Serverstand, pauzes en belblokkades blijven
bewaard. Na terugkeer eerst de bestaande herstelstatus controleren.

De besloten belroom gebruikt zijn bestaande configuratie. Alleen de bewuste
actie om een beller live te zetten neemt diens stem op in de bestaande
programmamix. De nieuwe uitzendserver abonneert niet op backstage- of
fluistertracks. Vlampies eigen omgeving en YouTube-route zijn behouden.

## Bevestigde host en poorten

Op 22 november 2026 via bestaande deployconfiguratie en SSH gecontroleerd:
`dg-nxttrack-01`, cloudnaam `NXTTRACK1`, Hetzner-ID `144079944`,
IPv4 `128.140.93.95`, IPv6 `2a01:4f8:c015:60a6::1`, locatie `fsn1-dc14`.
Vier AMD EPYC-Genoa-vCPU's, circa 7,6 GiB RAM, voor installatie circa 5,1 GiB
beschikbaar. De VPS huisvest ook andere projecten. Hun sitefragmenten en
service-instellingen zijn niet vervangen.

Gebruik de bestaande hostnaam `milo-staging.dgwebservices.nl`: nieuwe namen
als `livekit-milo-staging.dgwebservices.nl` resolveerden bij controle via een
wildcard naar een andere VPS (`167.235.202.206`). Die zijn geen testdoel.

| Functie | Binding/poort | Publiek |
| --- | --- | --- |
| Bestaande Caddy | HTTPS/WSS 443, HTTP 80 | Ja; bestaande TLS |
| LiveKit signal/API | 127.0.0.1:7880 | Alleen via Caddy `/rtc*`, `/twirp/livekit.*` met LiveKit-auth |
| WebRTC | UDP 7882, TCP 7881 | Nodig voor gezinnen |
| WHIP HTTP | 8086 | Alleen via Caddy `/whip/*`; geheime stream-URL |
| WHIP media | UDP 7885 | Nodig voor OBS |
| Eigen TURN | UDP 3480, TLS/TCP 5349 | Authenticated fallback |
| Redis | 127.0.0.1:6381 | Nee; eigen wachtwoord |
| SFU-metrics | 127.0.0.1:6798 | Nee; alleen SSH-sampler |
| Worker-health/relay | 9086, 9087, 9096 | Door lokale firewall afgeschermd |
| HLS-bestanden | App-route `/api/broadcast/hls/...` | Getekende playlist én segmenten, geen sessiecookie nodig |

UFW laat uitsluitend de nieuwe mediapoorten toe; bestaande Dartflow-TURN op
3478/3479 en zijn poortbereiken blijven apart. Docker gebruikt host networking
zonder port publishing, NAT of eigen iptables-regels. ICE adverteert alleen de
publieke `eth0`-interface, zodat een Tailscale-route niet per ongeluk als
publieke proef slaagt. TURN/TLS gebruikt 5349: op een netwerk dat uitsluitend
uitgaand TCP 443 toestaat is deze fallback niet voldoende. Caddy's bestaande
HTTP-443-listener is niet vervangen door een L4-proxy.

Controleer ook de gekoppelde Hetzner-firewall: inkomend TCP 7881/5349 en UDP
7882/7885/3480 voor IPv4 en IPv6. De lokale instelling bewijst geen bereikbaarheid
door een providerfirewall. Het Hetzner-account, firewalloverzicht en de
contractuele verkeersbundel zijn niet via de beschikbare SSH-toegang zichtbaar.

## Reproduceerbare installatie

De bestanden staan in [infra/media](../infra/media). LiveKit 1.13.11,
Ingress 1.6.0, Egress 1.15.0 en Redis 7.4.7 zijn met versie én image-digest
vastgezet in `compose.yaml`. Op de bevestigde Ubuntu 24.04-host zijn als
prerequisites geïnstalleerd:

```sh
sudo apt-get install --no-install-recommends \
  docker.io=29.1.3-0ubuntu3~24.04.2 \
  docker-buildx=0.30.1-0ubuntu1~24.04.1 \
  docker-compose-v2=2.40.3+ds1-0ubuntu1~24.04.1
sudo python3 /opt/milobingo-media-source/install-staging.py
```

Kopieer eerst deze map naar `/opt/milobingo-media-source`. De installer weigert
een andere host/IP en een afwijkende Docker-daemonconfiguratie. Hij verandert
alleen het Milo-stagingfragment van Caddy, valideert het geheel vóór reload en
controleert de hashes van alle andere sitefragmenten. Een backup staat onder
`/var/backups/milo-media/<UTC-tijd>/`. Hij herstart geen Milo-appservice; de
gewone stagingrelease activeert later de nieuwe appcode.

De eerste installatie maakt willekeurige eigen secrets onder
`/etc/milobingo-media` en bewaart die bij herhaling. Alleen configvoorbeelden
zonder echte secrets staan in Git. De app leest
`/etc/milobingo-broadcast/staging.json` via een staging-systemd-drop-in met
`MILO_BROADCAST_CONFIG`. Bestandsrechten zijn root:appgroep 0640, bovenliggende
map 0750. Hiervoor zijn geen extra GitHub-variabelen of secrets nodig.

De Egress-image wordt met `Egress.Dockerfile` afgeleid van de vastgepinde
upstreamdigest. Alleen de gebruikers-ID en bijbehorende homerechten veranderen
naar 63001. De standaard image-UID 1001 is op deze VPS al de native CI-runner;
die identiteit mag geen toegang tot de workerconfiguratie krijgen. Runtime
draait zonder root of extra capabilities. De installer weigert een hostaccount
dat UID 63001 al gebruikt.

De gezamenlijke media-slice heeft CPUQuota 280%, MemoryHigh 2800 MiB en
MemoryMax 3200 MiB. Containers hebben aanvullende grenzen. Dit reserveert geen
gegarandeerde capaciteit: de belastingproef moet aantonen wat er naast de
andere apps past. UDP-bufferlimieten worden alleen verhoogd, minimaal 5 MB.

De eigen nftables-tabel `inet milo_media_turn_observe` telt alleen pakketten
en bytes op eth0 voor TURN-UDP 3480 en TURN/TLS 5349. Hij voegt geen
accept/dropregels toe en wist geen bestaande firewallconfiguratie. De sampler
leest de vier counters via de bestaande beheerverbinding en controleert resets.
Deze listener-totalen bevatten protocoloverhead en zijn geen room- of
audio-opnamen. Prometheus blijft op loopback 6798. Stop bij infra-rollback ook
`milo-media-observe.service`; die verwijdert uitsluitend zijn eigen tabel.

Egress 1.15 classificeert de nieuwe `MediaSource` bij toelating als
`participant_cpu_cost`, ook bij precies één geselecteerd AV-paar. Dat staat
hier op 1,0, gelijk aan de oude enkelpaar-`track_composite_cpu_cost`; de harde
containergrens blijft 1,5 CPU. Dit is een toelatingsraming. Of 720p30 binnen
dat budget stabiel wordt gecodeerd, moet de echte mediaproef nog aantonen.

HLS staat in `/srv/sites/milobingo-staging/shared/broadcast-hls`, eigenaar van
de Egress-user met SGID voor de appgroep. De ruwe directory wordt niet publiek
geserveerd. De app controleert HMAC, show, generatie en verloop voor elke
playlist en elk segment. De onderhoudstaak verwijdert bestanden ouder dan
48 uur en daarna lege directories. Gebruik geen show van 48 uur of langer.
Een getekende tv-link is maximaal vier uur geldig.

Dezelfde taak kopieert uitsluitend het bestaande Milo-stagingcertificaat naar
de TURN-container. Een benodigde certificaatherstart wordt uitgesteld zolang
LiveKit een room met deelnemers rapporteert of de status niet betrouwbaar
beschikbaar is. Houd de vervaldatum in de gaten; voortdurend actieve rooms
mogen certificaatonderhoud niet onbeperkt uitstellen.

Geen proxy-accesslog of debug-/requestbodylogging aanzetten voor RTC-, WHIP-
en getekende HLS-routes. Caddy handelt upstreamfouten op de staginghost af met
een algemene foutrespons; daardoor belanden die requests bij de huidige
loginstelling niet inclusief geheime URI in het errorjournal.

## Starten, stoppen en terugrollen

```sh
sudo systemctl start milo-media-staging.service
sudo docker compose -f /opt/milobingo-media/compose.yaml ps
sudo systemctl stop milo-media-staging.service
```

Bij configuratiewijzigingen: valideer eerst, gebruik daarna `docker compose
up -d --wait`. Een gewijzigde inhoud van een gemount YAML-bestand vereist
expliciet herstarten van alleen de betrokken worker. Doe dit tijdens een
afgesproken uitzendingpauze. De gewone appdeploy gebruikt de bestaande
CI-gate en `deploy-staging.yml`; media-installatie is geen productiedeploy.

Rollback van de app: gebruik de bestaande beschermde staging-deployprocedure
met de vorige geslaagde release. Bestaande shows zijn niet stilzwijgend
gewijzigd. Voor een show die bewust de nieuwe route koos: stop eerst de eigen
uitzending en wijzig die keuze gecontroleerd; alleen een approllback schakelt
een opgeslagen showinstelling niet automatisch terug.

Rollback van de media-infra:

1. Stop/disable `milo-media-staging.service` en `milo-media-maintenance.timer`.
2. Herstel het Milo-staging-Caddyfragment uit de backup van vóór installatie.
   De eerste backup van deze proef is `20261122T150551Z`; controleer de
   daadwerkelijke directory en inhoud. Gebruik geen latere backup die de
   nieuwe routes al bevat. Laat gewijzigde configuratie van anderen staan.
3. Valideer de hele Caddyconfiguratie en reload Caddy. Verwijder alleen de vijf
   toegevoegde Milo-mediapoortregels als geen andere dienst die inmiddels gebruikt.
4. Verwijder alleen de staging-`media.conf`-drop-in als die niet meer nodig is;
   daemon-reload en een geplande appherstart passen het proces aan.
5. Bewaar beschermde credentials en HLS-data voor herstel of wis ze apart na
   controle. Verwijder Docker of gedeelde pakketafhankelijkheden niet automatisch.

## Werkelijke proef en vrijgave

Zie [het meetrapport](LIVEKIT-METING-2026-11-22.md),
[het servercontract](program-broadcast-contract.md),
[de spelerbediening](program-broadcast-player.md) en
[het herhaalbare loadharnas](../scripts/load/README.md).
Een API-200, een gesimuleerde Cast-SDK of ontvangen RTP is afzonderlijk geen
bewijs van hoorbaar afspelen op een tv of 200 stabiele kijkers.

Primaire bronnen: [LiveKit VM](https://docs.livekit.io/transport/self-hosting/vm/),
[poorten](https://docs.livekit.io/transport/self-hosting/ports-firewall/),
[WHIP zonder hercodering](https://docs.livekit.io/transport/media/ingress-egress/ingress/transcode/),
[Egress](https://docs.livekit.io/reference/other/egress/api/),
[Google Cast streaming](https://developers.google.com/cast/docs/media/streaming_protocols)
en [Hetzner verkeer](https://docs.hetzner.com/cloud/billing/faq/).
