# Eigen uitzending op Milo-productie

Op **23 november 2026** is `https://milo.dgwebservices.nl` aangesloten op de
bestaande eigen LiveKit-installatie op `dg-nxttrack-01` / `128.140.93.95`.
De productieverbinding, WHIP-invoer, TURN en beveiligde HLS-uitvoer zijn werkelijk
met synthetisch beeld en testgeluid beproefd. De applicatie draait op de eerder
geaccepteerde bron `d7d14958afe1b000d6da4f4310c0aab02c88da36`, release
`45229874387-1`; er was geen nieuwe applicatiebuild of databasemigratie nodig.

Dit is de aanvulling op de
[applicatie-uitrol](PRODUCTIE-RELEASE-2026-11-23.md). De eerdere vermelding dat
de eigen productieverbinding nog ontbrak is daarmee achterhaald. De procedure
hieronder en de [veilige bewijzen](../verification/media/production/2026-11-23/)
leggen deze afzonderlijke infrastructuuruitrol vast.

## Uitzenden vanuit de regie

1. Open de productie-Milo-show en ga naar **Uitzending testen → Rechtstreeks
   uitzenden & tv**. Daar hoort **Eigen uitzendserver ingesteld** te staan.
2. Kies **Eigen uitzending voorbereiden**. De regie toont de beschermde
   WHIP-server en het bearertoken voor uitsluitend deze show.
3. Vul deze gegevens in bij **OBS → Instellingen → Stream → WHIP**. Publiceer
   het programmabeeld met alleen de Program-audiomix. Neem geen algemene
   desktopaudio, privéregie of backstage op in die mix.
4. Gebruik het getoonde profiel: **1280 × 720, 30 fps, H.264, video 1186 kbit/s,
   Opus-audio 64 kbit/s**, sleutelbeeld iedere twee seconden. Er is één
   kwaliteitslaag; de app biedt geen ongeteste lagere laag aan.
5. Start OBS. Wacht in de regie op **Programma ontvangt beeld en geluid** en
   controleer de showpagina. Kies daarna **Start tv-feed**. Cast/AirPlay worden
   beschikbaar wanneer de echte liveplaylist klaarstaat.
6. Controleer met de eigen OBS-mixer en een korte proefopname dat de gewenste
   mix hoorbaar is. Controleer vervolgens op de fysieke tv beeld, geluid,
   leesbare cijfers, livepunt en terugkeer naar de telefoon.

Een bestaande YouTube-show wordt niet automatisch omgeschakeld door deze
serverinrichting. Het kiezen van de eigen uitzendroute blijft een bewuste
handeling per show. De serverinrichting wijzigt geen draaiboek, bestaande
bestelling, winnaar, bingovenster of trekkingsblokkade.

OBS en het uitzendvenster dat OBS opneemt moeten open blijven. OBS blijft
publiceren wanneer alleen de regietab sluit. De bestaande browserregie kan voor
nieuwe showcues nog nodig zijn; na terugkeer blijft de normale herstelcontrole
van toepassing.

## Wat op de VPS is ingericht

De vier bestaande, versiegebonden media-services worden hergebruikt: LiveKit,
Ingress, Egress en Redis. De images zijn gelijk gebleven. Er is geen tweede
streamingabonnement, nieuwe VPS, nieuw Supabase-project of extra GitHub-secret
nodig. De interne bestaande Compose-/systemdnaam bevat nog `staging`; dit is
dezelfde gedeelde installatie en geen tweede kopie voor productie.

| Onderdeel | Productie-inrichting |
| --- | --- |
| Signaling en server-API | `wss://milo.dgwebservices.nl`, beveiligde RTC/Twirp-proxyroutes |
| OBS | `https://milo.dgwebservices.nl/whip/…`, geheime sleutel per show |
| TURN | Productiedomein, UDP `3480` en TLS `5349`, bestaand geldig productiecertificaat |
| Beschermde appconfiguratie | `/etc/milobingo-broadcast/production.json`, `root:app-mil-prd 0640` |
| Servicekoppeling | `/etc/systemd/system/milobingo-production.service.d/media.conf` |
| Productie-HLS | `/srv/sites/milobingo-production/shared/broadcast-hls`, eigenaar `63001:955`, modus `2750` |
| Egress-mount | `/out-production`; de bestaande staging-mount `/out` blijft behouden |
| Retentie | Beide omgevingen behouden het bestaande beleid van 48 uur |
| Bron en tools | `/opt/milobingo-media-production-source-20261123`, `/opt/milobingo-media-tools` |

Het productie-Caddyfragment behoudt de vaste appheaders en strips voor
vervalste identiteiten. Alleen dit sitefragment is uitgebreid. Alle zeven
andere bestaande Caddyfragmenten behouden dezelfde hashes en de zeven andere
gecontroleerde appservices behouden status en PID.

Productie en staging hebben aparte HLS-ondertekeningssleutels. Beide apps kunnen
hun eigen configuratie lezen, maar niet het configuratiebestand van de andere
appgroep. De bestaande media-API-sleutels en Redis-opslag zijn behouden; een
HLS-link die met de stagingsleutel is ondertekend wordt op productie geweigerd.
Dit zijn twee appomgevingen op één SFU, geen afzonderlijke LiveKit-projecten.

Programmarooms gebruiken de bestaande, servergegenereerde show-UUID. Vóór
inrichting is gecontroleerd dat de omgevingen geen show-ID delen en dat
productie geen gekopieerde uitzendstatus bevat. Normaal aanmaken en dupliceren
nemen geen providerresources over. Een latere handmatige databasekopie tussen
omgevingen mag geen show-ID of oude `programBroadcast`-resources overnemen.

De besloten belroom behoudt haar bestaande centrale LiveKit-instellingen. De
eigen uitzendserver ontvangt uitsluitend het gekozen programmabeeld en de
uitzendmix. Privéregie, backstage en fluisteraudio worden niet door deze
infrastructuur aangesloten. Vlampies eigen omgeving is niet aangepast.

## Uitgevoerde productieproeven

De externe generator was `codex-worker-01`; bron en ontvangers gebruikten
dezelfde gecontroleerde klok. Een synthetisch bewegend 720p-beeld met
decodeerbare brontijdcode en een diagnostische toon van 440 Hz werd via de
echte productie-WHIP-route aangeboden. De ontvangers decodeerden echte video
en PCM-audio. Er zijn geen echte gezinnen, kinderen, telefoongesprekken,
betaalbestellingen of betaalde spraakgeneratie gebruikt.

De definitieve proef hield iedere ontvanger **60,451 seconden** vast:

| Ontvanger | p50 beeldvertraging | p95 beeldvertraging | Gedecodeerde fps | Opmerking |
| --- | ---: | ---: | ---: | --- |
| Directe WebRTC | 93 ms | 127 ms | 27,63 | 720p, actuele PCM, geen reconnect |
| Geforceerde TURN-ontvanger | 89 ms | 112 ms | 27,64 | relay-candidate werkelijk vastgesteld |
| Technische HLS-decoder | 3442 ms | 3468 ms | 26,98 | 720p, actuele PCM; korte hapering, zie hieronder |

Een aanvullende HLS-client volgde de liveplaylist op kijktempo: **61 segmenten,
11.036.133 bytes, nul HTTP-fouten en nul door deze HTTP-client gemelde stalls**.
Dat laatste is netwerkbewijs; het zegt niet dat een tv alle frames afspeelt.
De TURN-ontvanger in deze proef koos een relayroute met UDP. De aparte echte
TLS-handshake naar poort `5349` controleerde het vertrouwde productiecertificaat;
dit is geen bewijs dat deze afspeelproef via TURN/TLS liep.

De HLS-decoder registreerde in de definitieve proef 171 gevallen van
`droppedVideoFrames` en één niet-fatale `bufferStalledError`. Hij bleef binnen
de technische afspeelgrenzen van de proef en herstelde. De eerdere productieproef
van 60,492 seconden behaalde 29,89 HLS-fps, p95 3184 ms, zes dropped frames en
geen HLS-fout. Beide rapporten zijn behouden. Deze resultaten bewijzen geen
haperingsvrije Cast- of AirPlay-weergave; de diagnostische HLS.js-client volgt
de live-rand met één segment buffer, terwijl fysieke ontvangers hun eigen
afspeelbeleid hebben.

Dit is een korte productie-smoke met twee WebRTC-ontvangers en twee
HLS-ontvangers, geen nieuwe proef met 200 gezinnen. De eerdere
[stagingcapaciteitsproef](LIVEKIT-FIREWALL-HERTEST-2026-11-22.md) blijft het
afzonderlijke capaciteitsbewijs. Het gedeelde media-budget geldt voor
gelijktijdig gebruik van productie én staging samen.

Verder werkelijk gecontroleerd:

- geldige productieplaylist en videosegmenten via de echte app, met `no-store`
  op de playlist en `no-referrer` op de beschermde media;
- Cast-CORS-preflight toegestaan, vreemde Origin geweigerd;
- ongeldige HLS-ondertekening, anonieme toegang tot showbeheer en vervalste
  beheerheaders geweigerd;
- oude technische HLS-link direct onbruikbaar na verwijderen van de fixture
  (`410`), stagingsignatuur geweigerd (`401`);
- beide bestaande appconfiguraties afgeschermd per appgroep;
- na cleanup nul rooms, ingresses of actieve Egress-jobs, lege technische
  productie-HLS-directory en verwijderde tijdelijke streamcredentials;
- alle oorspronkelijke spelrijen exact gelijk gebleven: één productierij en
  elf stagingrijen, vergeleken met root-only rijhashes vóór de proeven;
- publieke release-identiteit en de bestaande productie-autorisatiegrenzen.

Tijdens de eerste HTTP-controle bleek Next's globale `Referrer-Policy` de
routeheader te overschrijven. De productieproxy dwingt daarom alleen op
`/api/broadcast/hls/*` een uitgestelde `no-referrer`-header af. De fout, reparatie
en geslaagde herhaling staan afzonderlijk in het bewijs.

## Herhalen en onderhouden

De installer, certificaathulp en tests staan in [infra/media](../infra/media/).
De applicatierunner krijgt deze beheerrechten of geheime configuratie niet.
Kopieer beoordeelde bronbestanden als root naar een eigen beschermde map op de
bevestigde VPS. Gebruik bestaande sleutels en volumes; voer de oude
staginginstaller niet opnieuw uit om productie te configureren.

```sh
sudo python3 -B /opt/milobingo-media-production-source-20261123/install-production.py plan
sudo /opt/node-v24.18.0-linux-x64/bin/node /opt/milobingo-media-tools/production-activity-20261123.mjs
sudo python3 -B /opt/milobingo-media-production-source-20261123/install-production.py apply \
  --activity-evidence /var/lib/milobingo-media/production-setup/activity.json
```

Een wijzigende apply vereist een verse root-only activiteitcontrole van beide
omgevingen en bevestigt zelfstandig dat er geen actieve mediadeelnemers of
Egress-jobs zijn. Een tweede identieke apply is zonder herstarts geverifieerd.
Bij de eerste aansluiting is de productieapp daarna één keer bewust herstart
om de nieuwe servicevariabele te laden. Een identieke herhaling vraagt dat niet.

Certificaatonderhoud gebruikt het bestaande Caddy-productiecertificaat. De hulp
controleert hostname, sleutel, geldigheid en de exact ingelezen bytes. Een
noodzakelijke LiveKit-herstart wordt bij actieve media of onbekende
providerstatus uitgesteld. Caddy beheert de normale certificaatvernieuwing.

De bestaande staging-loadscripts blijven staging-only. Voor een nieuwe,
afgeschermde productie-smoke zijn er afzonderlijke tools:

- [production-activity.mjs](../scripts/load/production-activity.mjs): alleen-lezen
  activiteitcontrole met gecontroleerde TLS naar de twee vaste projecten;
- [production-fixture.mjs](../scripts/load/production-fixture.mjs): root-only
  aanmaken en CAS-verwijderen van één verborgen, lege technische spelrij; geen
  Auth-gebruikers, boekjes, rondes of bestellingen;
- [production-smoke.mjs](../scripts/load/production-smoke.mjs): externe beperkte
  WHIP-/WebRTC-/HLS-client zonder provider-API-secret, met een aparte handshake
  voor de nieuwe HLS-generatie bij `start-hls`.

De eerste fixtureclaim is atomair exclusief. De staging-CLI is niet verruimd en
wordt niet vanuit de productie-CLI geïmporteerd. Bewaar vóór een herhaling de
root-only rijhashbaseline apart: de activiteitcontrole actualiseert haar laatste
meetbestand. Configuraties en tokens gaan uitsluitend via private bestanden;
deel nooit de volledige WHIP- of getekende HLS-URL in logs of rapporten.

## Terugrollen

De volledige infrastructuurbackup staat beschermd op:
`/var/backups/milo-media-production/20261123T175904Z-2553601a`.
De latere backup `20261123T180454Z-f05676f7` bevat uitsluitend de
privacyheaderwijziging; die is geen volledige infrastructuurrollback.

Controleer eerst met regie dat er geen uitzending actief is. De beperkte
rollback-CLI vereist dezelfde verse activiteitcontrole, lege providerstatus,
beschermde backup en overeenkomende oorspronkelijke bestandshashes:

```sh
sudo /opt/node-v24.18.0-linux-x64/bin/node /opt/milobingo-media-tools/production-activity-20261123.mjs
sudo python3 -B /opt/milobingo-media-production-source-20261123/install-production.py rollback \
  --backup /var/backups/milo-media-production/20261123T175904Z-2553601a \
  --activity-evidence /var/lib/milobingo-media/production-setup/activity.json
```

De procedure herstelt alleen de bekende eigen bestanden en rechten, controleert
Caddy, herstart uitsluitend noodzakelijke diensten en bewaart Redis en
HLS-data. Een niet-lege nieuw gemaakte HLS-directory wordt behouden. Databases,
Auth, providerinstellingen van de besloten belverbinding en winstresultaten
worden niet teruggezet. De handmatige rollback is lokaal op afzonderlijke
fixtures getest; hij is niet uitgevoerd op de werkende productie-installatie.

## Nog op echte apparatuur te controleren

Er was geen fysieke OBS-installatie, Chromecast/Google TV of AirPlay-ontvanger
beschikbaar voor Codex. Daarom blijven de OBS-proefopname, echt casten,
apparaatgebonden tv-vertraging en leesbaarheid, geen dubbel geluid, en een
volledige gezinsbelrepetitie op die apparatuur afzonderlijke controles.
De synthetische productiemediaproef en de eerdere staging-audio-isolatieproef
zijn daarvoor geen vervanging.

Technische bronnen: [LiveKit op een VM](https://docs.livekit.io/transport/self-hosting/vm/),
[Ingress](https://docs.livekit.io/transport/self-hosting/ingress/),
[Egress](https://docs.livekit.io/transport/self-hosting/egress/) en
[uitgestelde Caddy-headers](https://caddyserver.com/docs/caddyfile/directives/header).
