# Een Milo-show voorbereiden en starten

Open de gewenste Milo-show en gebruik **Overzicht → Voorbereiden → Uitzending testen → Start show**. Het draaiboek, de spelersuitleg, de patroonweergave en de servercontrole gebruiken dezelfde showinstellingen. Vlampie blijft een afzonderlijke productie met zijn eigen bestaande voorbereiding.

## Voorbereiden

Nieuwe Milo-shows krijgen automatisch dit profiel:

| Rondekaart | Prijsstappen, in volgorde |
| --- | --- |
| 1 | Vier hoekjes → bovenste én onderste rij vol → volle kaart |
| 2 | Vier hoekjes → bovenste én onderste rij vol → volle kaart |
| 3 | Vier hoekjes → bovenste én onderste rij vol → volle kaart |
| Finale | Alleen volle kaart |

Dat zijn tien prijsstappen. Bij **bovenste én onderste rij** moeten alle tien gemarkeerde vakken compleet zijn: één volle rij telt niet. Het middenvak blijft vrij. Elke nieuwe ronde gebruikt haar eigen rondekaart en een leeg bord; tussen prijsstappen van dezelfde ronde blijven de officiële nummers staan. De bestaande meldvensters, terugkijkmarge, voorrang en eenmalige loting bij gelijke bingo’s blijven gelden.

Bestaande draaiboeken en lopende shows worden niet automatisch vervangen. Alleen bij een afwijkend, bewerkbaar Milo-concept verschijnt **Standaardregels laden**. Deze bewuste actie bewaart bestaande presentatieonderdelen en prijzen waar die bij de ronde horen. Regels die al aan deelnemers of bestellingen zijn gekoppeld blijven beschermd.

Wijzigingen in het draaiboek worden automatisch opgeslagen. **Opslaan…** en **Opgeslagen** tonen de voortgang. Bij **Niet opgeslagen — Opnieuw proberen** blijft de invoer staan; controleer de verbinding en probeer opnieuw. Een tijdelijke kopie in dezelfde browsertab helpt de invoer na herladen terug te zetten. Een andere tab kan jouw voorbereiding niet stil overschrijven: bij een versieconflict vergelijk je eerst de opgeslagen versie. **Mijn wijzigingen vervangen** vraagt een bewuste keuze; kopieer eerst tekst die je wilt bewaren.

## Uitzending testen

Gebruik **Open uitzendvenster**, **Kopieer OBS-link** en **Speel testgeluid**. Houd de regiepagina open. Drie afzonderlijke controles tonen de verbinding met deze show, de audioactivatie in het uitzendvenster en jouw controle in OBS.

Voor een **Browserbron**: plak de OBS-link, kies **1920 × 1080** en zet **Audio beheren via OBS** aan. Activeer zo nodig via **OBS → Bronnen → rechtsklik → Interactie → Beeld & geluid activeren**. Het activatiescherm verdwijnt pas nadat het testgeluid daadwerkelijk is afgespeeld via de uitzendmix.

Voor **Vensteropname**: open de OBS-link in een aparte browsertoepassing zonder regie- of backstagetabs. Activeer daar beeld en geluid. Kies **OBS → Bronnen → + → Vensteropname** en leg uitsluitend die uitzendbrowser vast met **Toepassingsaudio vastleggen**. Zet algemene desktopaudio uit. Gebruik een Browserbron wanneer audio per toepassing niet beschikbaar is. Privé-audio van regie en backstage hoort niet bij de uitzendmix.

**Geluid afgespeeld** bevestigt afspelen in het uitzendvenster. Controleer vervolgens de meter van de juiste bron in de OBS-mixer, maak een korte opname met beeld en testgeluid en luister die terug. Bevestig pas daarna beide OBS-controles. Een geautomatiseerde browseropname met Canvas en Web Audio vervangt deze controle op een echte OBS-installatie niet; die praktijkcontrole blijft nodig.

Bij verbindingsverlies kies je **Opnieuw verbinden** voor dezelfde show. Het venster herstelt beeld en spelstand zonder de show opnieuw te starten of een trekkingblokkade op te heffen. Is de OBS-link verlopen of ingetrokken, maak dan vanuit de regie een nieuwe link.

## Starten en hervatten

**Start show** bewaart eerst de laatste wijzigingen en laat de server daarna de actuele regels vastleggen. Spelers kunnen de regels vóór deelname bekijken; er is geen aparte knop om Milo-regels vast te zetten. De server voorkomt dubbel starten, ook bij twee regietabs. Een reeds lopende show opent via **Hervat regie**, na controle van de echte serverstand. Het bord en bestaande meldingen, uitslagen en belblokkades blijven behouden; vrijgeven gebeurt pas met een bewuste live-actie.

Het standaardprofiel gebruikt vijftien seconden vanaf de vorige officieel getoonde bal. De server bewaakt de officiële bevestiging. Meldvensters, uitslagen, minigames, handmatige pauzes en actieve belblokkades houden de trekking tegen. Na hervatten begint een nieuwe termijn van vijftien seconden. Herladen of een vertraagd venster veroorzaakt geen reeks inhaalballen.

Voor deze wijziging zijn geen databasemigratie, extra accounts, omgevingsvariabelen of nieuwe secrets nodig. De bestaande regietoegang, stemkoppeling en showgebonden OBS-link blijven van toepassing. Uitrolbewijs en de actieve stagingrelease staan afzonderlijk in het stagingverslag.
