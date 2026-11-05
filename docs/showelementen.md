# Beweging, magie en showelementen

De gekozen Studio 1 — het Sterrenplein — blijft de basis. De nieuwe momenten
gebruiken dezelfde 2.5D-studio, karakterrigs, camera's en officiële nummerdesk.

## Bediening

Open **Showelementen → Beweging & magie**. Kies een moment en speel eerst de
stille voorvertoning. **Start live** start bewust het moment in PROGRAM met
het bijbehorende geluid. **Aan draaiboek toevoegen** voegt een bewerkbaar
showblok toe; sla het draaiboek daarna op. Bestaande draaiboeken worden niet
automatisch vervangen.

Ook in de regiekamer staan directe showcues. Een actief moment toont de
voortgang en biedt pauzeren en stoppen. Aan het einde keert de camera terug
naar het vorige shot. Een los gebaar eindigt vanzelf in de rustige houding.

| Moment | Duur | Beeld en beweging |
| --- | --- | --- |
| Welkom op het Sterrenplein | 6 sec | Zwaaien, sterrenlicht en een beweging naar de presentator |
| Een groot klein applaus | 7 sec | Meeklappen en gouden confetti |
| Het Sterrenplein-dansje | 8 sec | Ritmische schouders en armen, zwevende muzieknoten |
| Oeps… bubbels! | 6 sec | Verwonderde reactie en iriserende bellen |
| De sterrenregen | 9 sec | Magisch gebaar en vallende sterren |
| De sterrenwervel | 12 sec | Toverstafspoor en een ster in lichtbanen naast de presentator |
| Het grote slotapplaus | 10 sec | Buiging, confetti en een breed slotshot |
| Een teken uit de sterrenpoort | 8 sec | Verlichte poort en een welkomstgebaar |

De sterrenpoortcue is een visueel voorteken. Voor een werkelijk bezoek van
een ander personage blijft het bestaande **Gastbezoek** in het draaiboek
beschikbaar, inclusief gast, tekst en eigen stem.

Alle twaalf Milo & Friends-presentatoren kunnen de showcues en de negen
losse gebaren uitvoeren: zwaaien, aanwijzen, nadenken, juichen, buigen,
applaudisseren, dansen, verbaasd reageren en luisteren. Milo behoudt daarnaast
zijn twee volledige trucs: de zwevende sterrenhoed en de sterrenvlinder.
Vlampie houdt zijn eigen productie en studio's.

## Timing en spelregels

De regie is eigenaar van de cueklok. De uitzending ontvangt dezelfde cue en
verstreken tijd; de renderer vult de tijd tussen berichten vloeiend aan.
Een voorvertoning heeft een eigen klok en start geen geluid, stemaanvraag,
LiveKit-verbinding of wijziging aan het spel.

Een nieuwe cue wacht als er een trekking, uitspraak, bingo-meldvenster,
uitslag of livegesprek actief is. Tijdens een privévoorgesprek kan
entertainment doorgaan terwijl de centrale trekkingblokkade actief blijft.
De knop om het gesprek live te zetten wacht tot de cue is afgerond of gestopt.
Effecten genereren geen nummers, kaarten, winnaars of prijzen en sluiten geen
meldvenster. Automatische trekking komt niet tussendoor in een handmatige cue.

Geluid loopt via de bestaande regie-/uitzendroute. De stille preview is geen
bewijs van een echte geluids- of providerverbinding. Jingles zijn lokaal
gesynthetiseerd; de nieuwe effecten vragen geen extra AI-sessie aan.

## Beeld en toegankelijkheid

De effecten bestaan uit deterministische Canvas-deeltjes, glans, lichtbanen
en afzonderlijke voor-/achterlagen. Het gezicht, de woordnaam en het 5 × 15
nummerbord blijven leesbaar. Gebaren vloeien in en uit hun rusthouding.
Bij de systeemvoorkeur voor minder beweging worden reizende deeltjes en
camera-drift vervangen door rustige, vaste accenten.

Milo gebruikt nu een gelede 2D-pop: zijn goedgekeurde illustratie is verdeeld
in losse lichaamsdelen met draaipunten voor hoofd, hoed, schouders, ellebogen,
polsen, benen, voeten en staart. De andere vrienden gebruiken hun bestaande
vervormbare karakterrig. Dit blijft geanimeerde 2.5D; het zijn geen nieuwe
volledige 3D-karaktermodellen. De cue-miniaturen zijn beelden uit dezelfde
renderer; eventuele getallen daarin zijn voorbeeldwaarden.

## Verificatie

Gerichte controles dekken cuevalidatie, einde/herstel, pauze, draaiboektiming,
naam/karakterkeuze, stille preview, uitzendoverdracht, merkisolatie en de
grenzen met bingo en bellen. Native Canvas-beelden controleren de werkelijke
decorlagen en effecten. Een volledige browser- en OBS-repetitie met echte
OpenAI-/LiveKit-verbindingen is hiermee niet uitgevoerd.


## Milo: uitgebreid acteerwerk

Milo ademt, verplaatst rustig zijn gewicht, knippert en beweegt hoofd en
staart. Tijdens spreken komen daar knikjes en rustige handgebaren bij.
Zwaaien heeft afzonderlijke schouder-, elleboog- en polsbeweging; bij applaus
bewegen de handen daadwerkelijk naar elkaar toe. Gebaren bouwen rustig op,
vertragen bij hun eindpunt en keren terug naar de doorlopende rusthouding.
De sterrenhoed en sterrenvlinder krijgen ieder hun eigen voorbereiding,
toverbeweging, onthulling en afronding. De staf volgt het midden van Milo's hand.

De oorspronkelijke afbeelding, gezichtsvorm en hoogte achter de desk blijven
behouden. Bronuitsneden worden eenmaal voorbereid. Tijdens afspelen worden
losse delen getekend met tijdgebaseerde overgangen en een doel van 60 beelden
per seconde; de werkelijke snelheid hangt af van het apparaat.

Gebruik **Regie → Milo bedienen** voor de snelle gebaren en **Presentatie**
voor tekst, stem en magiemomenten. De uitgebreide keuze en stille voorvertoning
staan onder **Showelementen → Beweging & magie**. De bestaande instelling voor
gebaarenergie blijft werken; hogere energie verplaatst bij het klappen niet
het contactpunt van de handen.

Een handmatige uitspraak kan Milo laten bewegen terwijl het draaiboek
gepauzeerd staat. Dat start de nummertrekking niet. Bij pauzeren van die
uitspraak bevriest ook zijn acteerklok; **Stop stem** sluit zijn mond.
Beperkte beweging schakelt lichaamsgebaren uit, maar mondbeweging kan
beschikbaar blijven voor het volgen van de spreker.

De nieuwe controles renderen echte bronpixels en controleren zichtbare
handbeweging, houdingen, pauze en de koppeling met de studioklok. Dit valideert
geen echte OpenAI-stem, LiveKit-verbinding of OBS-uitzending.

### Levendiger acteren — november 2026

Milo heeft rustige, wisselende microgebaren in plaats van een steeds herhaalde
rustlus: gevarieerde ademhaling, gewichtsverplaatsing, nieuwsgierige blikken en
kleine handverplaatsingen met rust ertussen. Spreekgebaren hebben voorbereiding,
nadruk, een vastgehouden houding en herstel. Zijn oorspronkelijke irissen
bewegen subtiel mee; het knipperritme varieert en bevat soms een dubbele knipper.

Tijdens een gesprek richt hij zich op een sprekende co-presentator of gast;
bij live luisteren komen kleine bevestigende knikjes. Na een nieuw, door de
spelstaat bevestigd getal kijkt hij kort naar het nummerbord en weer terug.
Grote showgebaren en goocheltrucs behouden hun eigen choreografie. De
contextreacties veranderen geen nummers, bingo's, winnaars of gespreksrouting.

Gewrichtsovergangen behouden hun bewegingsimpuls met gedempte overgangen.
Pauze houdt het exacte beeld vast, preview-seeks blijven direct en beperkte
beweging blijft gerespecteerd. De gerichte controles omvatten langdurige
continuïteit, echte studiopixels, spreekpauzes, blikrichtingen en behoud van
handcontact tijdens applaus. Dit zijn lokale beeldcontroles, geen nieuwe
repetitie met echte stemproviders of een live uitzending.
