# Milo: vaste showaudio en het trektempo

De regie bereidt vaste spraak vóór de uitzending voor. Daardoor wacht een gewone balonthulling niet meer op een nieuwe stemaanvraag. Deze route hoort bij Milo; Vlampie houdt zijn aparte omgeving en bestaande presentatie.

## Wat vooraf klaarstaat

De server maakt voor de opgeslagen show één manifest uit dezelfde teksthelpers als de live regie:

- Alle 75 nummeroproepen voor de hoofdrol en iedere presentator van een bingoronde.
- De vaste opening, bingocontrole, afwijzing, winnaar, pauze en afsluiting.
- Ronde- en prijsintroducties uit de werkelijke patronen en prijzen van het draaiboek.
- De teksten van draaiboekblokken en alle spreekbeurten uit gastdialogen.
- De vaste introducties van Milo’s goocheltrucs, korte grapjes en de reactie op nummer negen.

Gelijke fragmenten worden samengevoegd. De opslagidentiteit bevat onder meer eigenaar, spraakbeleid, stemmodel, personageprofiel, profielversie, snelheid en exacte tekst. Een passend bestaand fragment wordt opnieuw gebruikt; een gewijzigd personage of script krijgt een nieuwe identiteit.

Na wijzigingen begint de voorbereiding automatisch. Twee workers laden fragmenten; ontbrekende fragmenten worden met een onderlinge startpauze gegenereerd. De regie toont voortgang en bewaart geslaagde fragmenten bij een fout. Starten en hervatten wachten op volledige voorbereiding. De browser bewaart audiobytes en decodeert alleen het fragment dat aan de beurt is. Lange teksten worden in stukken van maximaal 400 tekens verwerkt; de invoerlimiet blijft 10.000 tekens.

Vaste Milo-spraak gebruikt tijdens de show uitsluitend voorbereide fragmenten. Een ontbrekend verplicht fragment geeft een herstelbare fout en pauze. Vrije regietekst, kijkersvragen en goedgekeurde regiereacties kunnen wel nieuwe spraak vereisen. Deze handmatige spraak houdt de trekking tegen.

## Officiële ballen op vijftien seconden

Het standaardprofiel rekent vanaf de vorige door de server bevestigde bal, niet vanaf het einde van de uitspraak. De volgende camerabeweging en molen starten ongeveer 5,45 seconden vóór de volgende onthulling. De server bevestigt de bal pas wanneer de officiële klok dat toestaat. Na de nummeruitspraak blijft nog 0,9 seconde voor bord en presentator; er volgt geen tweede wachttijd van vijftien seconden.

Een open bingomelding, uitslag, minigame, handmatige pauze of belblokkade blijft voorrang houden. Ook verplichte spraak mag niet worden afgebroken om het tempo af te dwingen. Na veilig hervatten begint een nieuwe timer van vijftien seconden. Er worden geen gemiste ballen ingehaald. Getoonde en gesproken balmomenten zijn daarom afzonderlijke meetpunten; vijftien seconden is geen garantie bij een echte onderbreking.

De nummertekst staat in [bingo-speech.js](../public/bingo-speech.js):

| Kolom | Getallen | Uitspraak |
| --- | --- | --- |
| B | 1–15 | Bernhard |
| I | 16–30 | Izaak |
| N | 31–45 | Nico |
| G | 46–60 | Gerard |
| O | 61–75 | Otto |

Bijvoorbeeld: “Bernhard vijftien! Vijftien!” De getallen worden als Nederlandse woorden aangeleverd. Vlampie behoudt “Nummer 15. 15!”.

Korte grapjes zijn optioneel en staan buiten de verplichte trekking. Alleen een reeds beschikbaar fragment met bekende duur dat vóór de volgende molen past, kan worden gekozen. De server reserveert iedere grap en de negenjarigenreactie hoogstens eenmaal per show, ook over rondes, tabs en herladen heen. Bij weinig tijd of een fout vervalt de opmerking; de trekking wacht er niet op. Bingo, pauze, een belblokkade of annulering onderbreekt de opmerking.

## Muziek en OBS

De achtergrondmuziek is een oorspronkelijk, lokaal met Web Audio opgewekt patroon. Er wordt geen extern muziekbestand gebruikt. Muziek en effecten hebben afzonderlijke bussen, zodat een molen- of onthullingsgeluid de muziek niet opnieuw start. De muziek speelt zacht in de actieve Milo-show en wordt onder de stem en nummeronthulling verder teruggenomen. De regie kan haar uitschakelen; pauze, blokkades, stoppen, annuleren en een verloren uitzendverbinding laten haar stoppen.

Het uitzendvenster laadt het actuele manifest en de audiobytes vooraf. Een OBS-link geeft alleen toegang tot de gekozen show, de daarbij toegestane fragmenten en uitzendfuncties. OBS kan hiermee geen stemmen genereren, regie publiceren of ballen trekken. Verlopen, ingetrokken, gewijzigde of geannuleerde toegang mag geen oude audio vrijgeven. Privéspraak van regie en backstage blijft buiten de uitzendmix.

De geautomatiseerde controles bewijzen onder meer scripts, timingvoorwaarden, blokkades, gescheiden bussen en werkelijk gerenderde Web Audio met zachtere muziek onder spraak en stilte na pauze. Ze vervangen geen luistercontrole op een echte OBS-installatie. Controleer daar de mixer en maak een korte proefopname met beeld, nummeruitspraak, achtergrondmuziek en testgeluid. Controleer ook dat regie- en backstagegesprekken ontbreken.
