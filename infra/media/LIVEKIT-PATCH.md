# Embedded TURN/TLS op de geconfigureerde poort

Upstream LiveKit `v1.13.11`, commit
`385aa40f9292fe1db8caad87301e4b285b7c198a`, adverteert voor embedded TURN/TLS
altijd poort `443`, ook wanneer `turn.tls_port: 5349` de echte listener is.
Op deze VPS blijft HTTPS op Caddy/443. De eigen TURN/TLS-listener gebruikt 5349.

De patch wijzigt uitsluitend de TLS-URL in
`pkg/service/roommanager.go:iceServersForParticipant` naar de geconfigureerde
poort, met `net.JoinHostPort` voor correcte adresnotatie. De listener,
UDP-route, credentialgeneratie, TTL, netwerkinstellingen en toegangsrechten
blijven dezelfde upstreamcode. Er is geen statische TURN-credential toegevoegd.

Primaire bron:
[gefixeerde upstreamregel](https://github.com/livekit/livekit/blob/385aa40f9292fe1db8caad87301e4b285b7c198a/pkg/service/roommanager.go#L1083).

Voer de build uit op de externe generator, nooit op de gedeelde show-VPS:

```sh
python3 infra/media/build-livekit.py --output /private/new-milo-sfu-build
```

De uitvoermap moet nieuw zijn en de bestaande bovenliggende map moet minstens
5 GiB vrij hebben. De builder weigert `dg-nxttrack-01`. Hij controleert de
gepinde bron- en bestandchecksums en de patch wordt zonder fuzz toegepast.
Go 1.27.3 komt uit dezelfde digest als het upstream Dockerfile. Compiler en
gerichte tests draaien met CPU 2, geheugen 2 GiB, `GOMAXPROCS=2`,
`GOMEMLIMIT=1536MiB`, `-p=2`, geen capabilities en een alleen-lezen rootfs.
De limieten worden ook in de echte container-cgroup gecontroleerd.

De Go-test roept de echte `iceServersForParticipant` aan zonder listeners of
rooms te starten. Hij controleert 5349, de bestaande 443-configuratie,
IPv6-notatie, `tlsOnly`, ongewijzigde UDP-URL's en de bestaande dynamische
credentialidentiteit/wachtwoordcontrole/TTL. Daarna wordt de volledige SFU
gebouwd. De runtime vervangt alleen de binary in de bestaande gepinde
`livekit/livekit-server:v1.13.11`-image en draait als `65532:65532`.
De test gebruikt upstreams eigen `-docker=false`-vlag: de pure URL-test heeft
geen Docker-/Redis-testpool nodig en krijgt geen host-Docker-socket.

De uitvoer bevat `compiler.log`, `build-report.json` en
`livekit-staging-image.tar`. Het rapport bindt bron, builder, patch, test,
binary, image-ID en archief aan hun checksums. Geen runtimeconfiguratie of
secrets worden gelezen of meegebouwd.

Een geslaagde build wijzigt of herstart geen doelhost. Verplaats het archief
via de bestaande geautoriseerde beheerverbinding, controleer de SHA-256 uit
het rapport en laad het met `docker load`. Plaats `build-report.json` als
`/etc/milobingo-media/livekit-image.json`, root-owned mode `0600`, onder de
bestaande root-only configuratiemap. De installer vereist vóór hostwijzigingen
het exacte image-ID, binary-SHA, patchlabel en UID uit dit rapport. Hij voert
geen Go-build uit, pullt de afgeleide image niet en heeft geen fallback naar
de oorspronkelijke image. Bewaar bij de gecontroleerde stagingactivatie de
image-ID in het bewijs en wijzig alleen de SFU-image.
Stop eerst de eigen proefbron en HLS-encoder; herstart geen SFU met een echte
uitzending of een privégesprek. Herhaal daarna de normale én geforceerde
TURN/TLS-playerproef zonder client-side poortoverride, met echte PCM, beeld,
relaystatus en afzonderlijke TURN-tellers. Pas daarna volgt de belastingtest.

Terugrollen: zet uitsluitend de SFU-image terug op de originele digest uit
`LiveKit.Dockerfile` en herstart alleen die service in dezelfde veilige testpauze.
Laat Redis/AOF, Ingress, Egress, Caddy, firewall en secrets ongemoeid. Met de
originele image blijft de foutieve geadverteerde 443-poort bestaan; registreer
de TURN/TLS-route dan als niet werkend totdat de patch opnieuw is toegepast.
