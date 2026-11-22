# Eigen programma-uitzending

De uitzendroom is `programme-<show-uuid>`. Uitsluitend OBS publiceert daarin als
`programme-<show-uuid>` de tracks `programme-video` en `programme-audio`. De
bestaande privéruimtes, centrale belinstellingen en spelstatus blijven apart.
De regietab bestuurt de show; OBS blijft de mediastroom leveren wanneer die tab
sluit. Het uitzendvenster met het programmabeeld en de uiteindelijke audiomix
moet open blijven zolang OBS dat venster of die browserbron opneemt.

De service leest alleen de beheerderconfiguratie aangewezen door
`MILO_BROADCAST_CONFIG`. Het bestand en de bovenliggende directories zijn van
root; het bestand is maximaal 16 KiB, niet via een symlink bereikbaar en alleen
leesbaar voor root en de applicatiegroep. Geen sleutel komt uit een request,
showdocument of GitHub-variable. Zonder deze configuratie verandert geen
bestaande show van uitzendroute. De regie kiest dit per Milo-show bewust met
**Eigen uitzending voorbereiden**. Vlampie verandert niet.

## API

Alle onderstaande routes gebruiken de bestaande sessie en showtoegang:
een niet ingetrokken, toegelaten boekje of de regie die de show bezit. Een
geblokkeerd gezin krijgt geen kijktoegang. POST vereist dezelfde origin en
`X-Milo-Broadcast: 1`.

| Route | Resultaat |
| --- | --- |
| `GET /api/broadcast/:gameId/status` | `providerConfigured, enabled, state, profile, programTrackNames, publisherIdentity, hls.available, castAppId, serverTime` |
| `POST /api/broadcast/:gameId/token` met `{}` | `url, token, room, identity, expiresAt, publisherIdentity, programTrackNames` |
| `POST /api/broadcast/:gameId/cast` met `{}` | `url, expiresAt, mimeType, castAppId`; uitsluitend na een actuele HLS-playlist met segmenten |
| `POST /api/broadcast/:gameId/control` | Alleen eigenaar/regie; `{action, requestId}` |

Status is `waiting`, `live`, `reconnecting` of `ended`. Status lezen maakt geen
room, encoder of opslagobject. De providercontrole wordt twee seconden gedeeld
tussen kijkers. `live` vereist beide exact benoemde programmatracks van de
verwachte publisher. De familieprojectie van de show bevat alleen
`programBroadcast: {enabled, state}`; geen interne resource-ID's of sleutels.

Een kijkertoken is 120 seconden geldig om verbinding te maken, beperkt tot één
room, met `canSubscribe:true`, `canPublish:false`, `canPublishData:false`,
`canPublishSources:[]` en `canUpdateOwnMetadata:false`. Tokens verschijnen niet
in logs. Tokenverloop sluit een reeds bestaande LiveKit-verbinding niet vanzelf.
De frontend abonneert alleen op de verwachte publisher en twee tracknamen.

## Regieacties en herstel

- `prepare`: maakt of hergebruikt één WHIP-ingress zonder hercodering. Alleen
  deze expliciete actie retourneert `whip: {url, bearerToken}`. De browser toont
  deze gegevens tijdelijk; ze horen niet in localStorage of een log.
- `start-hls`: selecteert uitsluitend de video- en audiotrack van de
  programmapublisher en maakt één `StartEgress` met segmentuitvoer. Herhaalde
  klikken of opnieuw laden hergebruiken een actieve egress uit dezelfde room.
- `stop-hls`: stopt de tv-uitvoer en vervangt de HLS-generatie. Alle oude
  playlist- en segmentlinks vervallen; direct WebRTC-kijken blijft beschikbaar.
- `stop`: stopt HLS en schakelt nieuwe ingressverbindingen uit. De gekozen
  uitzendroute blijft geregistreerd als `stopped`, zodat de speler een
  eindstatus toont en niet onverwacht YouTube gaat afspelen.

Een CAS-reservering in het bestaande showdocument voorkomt twee gelijktijdige
beheeracties. Bij een onzekere upstreamrespons blijft de reservering maximaal
90 seconden staan. Een volgende bewuste poging controleert eerst bestaande
ingress/egress-resources. Geen beheeractie wijzigt trekking, claimvenster,
winstregels of belblokkade. Stoppen blijft mogelijk na afloop of annuleren.
Een nieuwe voorbereiding na `stop` heractiveert de ingress met een nieuwe
HLS-generatie.

## HLS, Cast en privégesprekken

HLS gebruikt één transcodering per show: 1280×720, 30 fps, H.264 1186 kbit/s en
AAC 64 kbit/s; MPEG-TS-segmenten en sleutelbeelden van twee seconden. Het
rechtstreekse profiel gebruikt H.264 met Opus 64 kbit/s. Er wordt geen lagere
kwaliteitslaag geadverteerd: WHIP zonder hercodering heeft één laag.

De getekende HLS-URL bevat een beperkte toegang voor uitsluitend show,
generatie en vervaltijd, standaard maximaal vier uur. De ontvanger heeft geen
browsercookie nodig. Zowel playlist als elk segment doorloopt dezelfde
HMAC-controle en actuele showstatus. Playlistverwijzingen worden herschreven
naar deze beschermde route; externe URL's, traversal en symlinks worden
geweigerd. Playlists hebben `no-store`; segmenten mogen één minuut privé
gecached worden. CORS staat alleen de eigen origin, `https://www.gstatic.com`
voor de standaard Cast-ontvanger en eventuele exact geconfigureerde
`hls.receiverOrigins` toe; geen wildcard en geen willekeurige Origin-reflectie.
Een fysieke ontvangerproef moet bevestigen welke origin het aanwezige apparaat
gebruikt. De ruwe
HLS-directory wordt nergens publiek aangeboden. Reverse-proxylogs moeten de
volledige HLS-capabilitypaden en WHIP-streamsleutels weglaten.

Bij een beloproep uit deze eigen uitzendroute bevestigt het gezin het
vastgelegde laatst gehoorde nummer en bijgewerkte kaarten. De app bevestigt
ook dat de programmaweergave stil is en de tv-overdracht gestopt is voordat
de server de overstap naar backstage toestaat. Een browsermelding is geen
bewijs dat een fysieke televisie daadwerkelijk stil is; apparaatproeven en
een hoorbare controle blijven onderdeel van de repetitie. Het bestaande
Milo/YouTube-belgedrag en Vlampies belbediening blijven behouden.

## Verificatie

`node tests/check-program-broadcast.mjs` verifieert autorisatie, JWT-grants,
roomisolatie, twee regietabs, herhalen/herladen, provideruitval, de enkele
HLS-encoder, beide stoproutes, capabilityverloop, playlist/segmenttoegang,
CORS, URI-injectie, symlinks en de oproepcontrole. Dit zijn lokale
protocoltests met fictieve spelers en providerfixtures. Zij bewijzen geen
mediatransport, fysieke tv-weergave of capaciteit van de VPS. Die resultaten
staan afzonderlijk in het rapport van de werkelijk uitgevoerde proef.

Actuele primaire referenties: [LiveKit-grants](https://docs.livekit.io/reference/access-tokens/),
[Ingress](https://docs.livekit.io/transport/media/ingress-egress/ingress/),
[StartEgress](https://docs.livekit.io/reference/other/egress/api/) en
[Egress-protocol](https://github.com/livekit/protocol/blob/main/protobufs/livekit_egress.proto).
