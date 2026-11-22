# Familie-uitzending en tv-bediening

De bestaande 16:9-plek in de familie-app wisselt alleen voor een expliciet
voorbereide Milo-show naar de eigen LiveKit-uitzending. Zonder
`game.programBroadcast.enabled` blijven de bestaande YouTube-speler en
Vlampies omgeving ongewijzigd. De showpagina, boekjes, chat, bingomeldingen,
officiële spelstand en trekkingslogica blijven de bestaande onderdelen.

## Bediening

De regie opent **Uitzending testen → Rechtstreeks uitzenden & tv**. **Eigen
uitzending voorbereiden** vraagt de server om één bron klaar te zetten en
toont daarna de beschermde OBS-WHIP-gegevens. De volledige WHIP-URL is een
publicatiegeheim. Deze gegevens blijven alleen in het geheugen van die
regiepagina, worden niet automatisch opgehaald en kunnen weer worden
verborgen. De ontvangers krijgen uitsluitend korte kijkertokens.

De familiepagina verbindt met de uitzendroom en ontvangt alleen de twee door
de server benoemde tracks van de verwachte programmapublisher. De browser
vraagt hiervoor geen camera of microfoon en publiceert geen media of data.
Geluid begint met **Geluid aanzetten**. Een geweigerde `play()`-aanvraag houdt
de knop en uitleg zichtbaar. Wachten op de bron, verbinden, tijdelijk verlies,
opnieuw verbinden en einde hebben afzonderlijke zichtbare statussen. Herstel
van deze speler start geen show en geeft geen trekking vrij.

**Start tv-feed** in de regie wordt pas beschikbaar bij een echte bevestigde
programmatrack. Alleen een actieve liveplaylist maakt **Cast naar tv** en
AirPlay beschikbaar. Google Cast gebruikt de Web Sender SDK en de Default
Media Receiver. Een LIVE-load laat het starttijdstip vrij om op het actuele
livepunt te beginnen. Pas een receiverstatus PLAYING van de juiste show
dempt de lokale mix; een geslaagde `loadMedia()` alleen is onvoldoende.
Stoppen of verlies van de Cast-sessie herstelt de lokale WebRTC-weergave,
waarbij een browserblokkade opnieuw een geluidsknop oplevert.

Safari gebruikt native HLS voor AirPlay. **AirPlay voorbereiden** haalt de
beperkte feed op, waarna **Kies AirPlay-apparaat** de native keuzelijst vanuit
een bewuste gebruikersactie opent. De daadwerkelijke wireless-status van
het media-element bepaalt de overdracht. De lokale programmamix staat dan
stil. Zonder bruikbare directe optie geeft **Tv-hulp** korte instructies voor
scherm spiegelen. Cast en AirPlay hebben een eigen zichtbare status; geen
van beide mag op basis van een timer als geslaagd worden gemeld.

## Ballen en privégesprekken

Zolang Cast of AirPlay actief is, loopt het ballenbord op de telefoon niet
vooruit met nieuwe servernummers. Het gezin vult de laatst op tv gehoorde bal
in en werkt het bord daarmee bij tot dat officiële nummer. De invoer toont
geen lijst met toekomstige of ongehoorde getrokken nummers. Een volgende
serverbal of rondewisseling verlicht niets zonder deze bevestiging. Dit is
bewuste gezinsbediening, geen gemeten synchronisatie van het tv-apparaat.
De server blijft alle claims en uitslagen bepalen.

Bij een oproep via deze nieuwe route bevestigt het gezin dat het het
controlepunt gehoord heeft en de kaarten bijgewerkt zijn. De lokale mix
wordt gedempt. Cast moet stoppen met een SDK-bevestiging; bij AirPlay moet
de native verbinding daadwerkelijk los zijn voordat de app het antwoord
naar de server stuurt. Alleen lokaal pauzeren van een nog verbonden AirPlay
is hiervoor onvoldoende. Bij een mislukte controle opent geen privémicrofoon.
Na afloop keert **Verder kijken** terug naar de bestaande uitzending; het
spel blijft onder controle van de regie. De bestaande besloten belrooms en
het Milo/YouTube- en Vlampie-belgedrag blijven verder behouden.

## Uitgevoerde lokale controles en grenzen

- `node tests/check-program-player.mjs`: veertien controller-/API-tests voor
  kijkersisolatie, autoplay, reconnect, daadwerkelijke Cast-status,
  AirPlay-ontkoppeling en het ballenbord. Daaronder vallen gerichte races met
  een nog lopende Cast-sessieaanvraag of `loadMedia`, een verloren antwoord,
  een vroegere eindmelding en een eindmelding van een andere sessie. Een
  privé-overgang wacht op afgehandelde oude aanvragen en een passende nieuwe
  `SESSION_ENDED`-bevestiging; een fout of timeout blijft blokkeren.
- `node scripts/check-player-live-call.mjs`: bestaande routes plus een
  afzonderlijke Milo/LiveKit-proef waarin een onbevestigde tv-stop geen
  antwoord of privémicrofoon mag openen.
- `tests/browser/program-broadcast.spec.mjs`: de werkelijke React-interface
  op 390 en 1366 pixels, bestaande kaart en chat, herstelactie, Cast-overdracht
  en stoppen, gehoorde-balbediening en geen horizontale overflow. De Google
  SDK is hierbij een herkenbare fixture; er is geen echte tv of mediadecode
  bewezen door deze interfaceproef. Bewijs staat in `verification/media/browser/`.
- `node tests/check-program-claim-latency.mjs`: vier canonieke model-/API-proeven
  met fictieve accounts en ongewijzigde, werkelijk gegenereerde kaarten. Voor
  alle tien standaardprijsstappen opent een snellere kijker het bestaande
  30-secondenvenster één seconde na de officiële bal. Onder de **aanname** van
  acht seconden tv-vertraging plus twee seconden bediening wordt de tv-claim
  tien seconden na die bal ontvangen, dus met bijna 21 seconden venster over.
  De echte Bingo HTTP-handler en SQLite-opslag accepteren beide claims in
  hetzelfde venster. Een eerder voltooide tv-kaart behoudt voorrang ondanks
  later melden; gelijke vroegste voltooiing behoudt de bestaande vastgelegde
  loting/minigame. Eén milliseconde vóór de deadline wordt toegelaten, exact
  op of na de deadline geweigerd zonder nieuwe valse-bingosanctie. De proeven
  wijzigen geen winstregel, kaart of vensterinstelling. Acht seconden is hier
  een testaanname, geen gemeten tv- of HLS-p95; fysieke vertraging en tijdig
  kunnen claimen moeten op de werkelijk gebruikte ontvanger nog worden getest.

Voor de daadwerkelijke mediacapaciteit en vertraging zijn de afzonderlijke
externe netwerkproeven nodig. Een fysieke Chromecast/Google TV, iPhone/iPad,
AirPlay-ontvanger en OBS-installatie worden niet door de lokale interfaceproef
vervangen. De fysieke controle moet leesbaarheid, hoorbaar geluid, geen dubbel
geluid, retour na een gesprek en tijdig kunnen claimen aantonen. De speler
claimt geen nog niet gemeten lagere kwaliteitslaag of ondertiteltrack.

Primaire documentatie: [LiveKit-verbinding](https://docs.livekit.io/intro/basics/connect/),
[LiveKit-abonnementen](https://docs.livekit.io/transport/media/subscribe/),
[Google Cast Web Sender](https://developers.google.com/cast/docs/web_sender/integrate),
[Cast-playerstatus](https://developers.google.com/cast/docs/reference/web_sender/cast.framework.RemotePlayerController),
[Apple AirPlay-bediening](https://developer.apple.com/documentation/webkitjs/adding_an_airplay_button_to_your_safari_media_controls)
en [hls.js 1.7.4](https://github.com/video-dev/hls.js/releases/tag/v1.7.4).
