# De familieplek — Milo & Friends

De familie-app heeft een eigen vormgeving binnen de bestaande React-app: een diep paars theaterhoofd, warme ivoorkleurige vlakken, gouden accenten, turquoise spelmarkeringen en het officiële Milo & Friends-logo. De navigatie groepeert kijken, boekjes, gezin, meedoen en prijzen. Op een telefoon staat de navigatie onderaan.

De showpagina is opgebouwd als kijk- en spelbediening. Op desktop staat links de 16:9-uitzending met direct eronder het ballenbord en de ronde BINGO-knop. Rechts staat één chatvlak; de invoerbalk met emoji en verzendicoon zit onderaan. De breedte houdt rekening met de schermhoogte zodat de bediening op een laptop in beeld blijft. Op mobiel staat de uitzending bovenaan, daarna het ballenbord met BINGO en vervolgens de chat. De grote welkomstblokken en instructiezijbalk zijn verwijderd. De footer bevat compacte tekst in plaats van een grote afbeelding.

Het ballenbord heeft exact vijf rijen van vijftien nummers (1–75). Alleen de getrokken nummers uit de serverstatus lichten op; de laatste trekking krijgt een goud accent. Het bord is alleen-lezen. Een verversing verandert de gemarkeerde nummers zonder de bestaande bal-elementen opnieuw te maken. De actieve ronde, het patroon en de prijs staan compact onder het bord. BINGO blijft een aparte knop met de bestaande expliciete bevestiging.

De digitale boekjes hebben een paars kader met diepte, gouden BINGO-letters en lichte, goed leesbare getalvakjes. Een afstreepvakje blijft een persoonlijke visuele markering; de originele serverkaart bepaalt de geldigheid van een bingo. De bestaande PDF-links en spelregels zijn behouden.

## Huisstijl en showkeuze

Een algemeen bezoek aan `/spelen` kiest een passende Milo-show. De keuzevolgorde binnen die huisstijl is: lopende show, eerstvolgende geplande show, meest recente oude conceptshow, meest recente afgeronde show. Zonder Milo-show blijft de Milo-welkomgeving staan. Een expliciete showlink of gekoppeld boekje blijft altijd leidend. Vlampie blijft selecteerbaar en gebruikt zijn eigen logo, studio en kleuren. Oude shows zonder `brandId` worden als Vlampie behandeld.

De centrale selectie en beeldbestanden staan in `frontend/family-brand.js`. Alle beeldbestanden komen uit de bestaande, goedgekeurde showmerken.

## Behouden gedrag

- Eén ouderaccount met meerdere spelers; nooit automatisch de oudernaam als kindnaam.
- De uitzending en belcontroller blijven op dezelfde plek gemonteerd bij tabwissels.
- BINGO opent eerst een bevestiging en verstuurt pas daarna het bestaande serververzoek met de juiste ronde en meldvenstercontext.
- Afstreepmarkeringen blijven per account, show, ronde en boekje opgeslagen.
- Toestemmingen, QR-koppeling en privé/live-belverbindingen gebruiken de bestaande afhandeling.
- De nieuwe styles gelden uitsluitend voor de familieomgeving; de regie wordt niet heringericht.

## Ontwikkelvoorbeeld en controle

De gepubliceerde familie-app heeft een expliciete, gevulde demostand op `/spelen?demo=1`. Er staat een demo-ingang op het inlogscherm en in het accountvenster. Deze stand gebruikt uitsluitend fictieve voorbeeldgegevens in de browser: Familie Jansen, Noor en Sem, twee unieke boekjes met vier rondes, een lopende Milo-show in ronde 2, 28 getrokken ballen, chat, begroetingen en eerder gewonnen voorbeeldprijzen. Noors huidige hoekenpatroon is compleet. Een afgeronde Milo-voorbeeldshow en een Vlampie-demo blijven ook selecteerbaar.

`frontend/family-demo.js` levert een lokale transportadapter voor de familie-API en chat. In demostand worden geen echte spel-API, EventSource-, microfoon-, LiveKit- of OpenAI-verbindingen geopend. De studio is een duidelijk gemarkeerde animatie zonder geluid. De microfooncontrole en QR-camera staan in de demo uit; belbeschikbaarheid is alleen een fictieve aanmelding. De voorbeeld-PDF is als voorbeeld gelabeld en hoort niet bij de gekozen demokaart.

Demohandelingen (chatbericht, profiel toevoegen, begroeting, afstrepen en BINGO bevestigen) blijven in deze browser. De initiële afstreepmarkeringen passen bij de getrokken voorbeeldnummers. Handmatige wijzigingen blijven bij polling en tabwissels behouden. De demofamilie heeft eigen opslagkeys, zodat echte OTP-, boekjes- en afstreepgegevens intact blijven. De knop ‘Opnieuw’ herstelt alleen de fictieve gegevens. De gewone familie-app behoudt zijn bestaande serverroutes, identiteit en spelregels.

Alle familieschermen hebben aanvullende responsive regels in `frontend/family-responsive.css`. De accountkaart heeft op mobiel een aparte knoprij, een brede e-mailregel en een privacytekst over de hele breedte. Prijskaarten, uitslagen, formulieren, modals en de vier rondeknoppen passen op smalle schermen. De demominispeler bedekt geen bediening op andere tabbladen; de echte minispeler kan worden verborgen zonder de uitzending te ontkoppelen. De desktopchat heeft groottecontainment zodat een lange berichtenlijst het ballenbord niet omlaag duwt.

De gevulde schermen zijn visueel gecontroleerd op 320, 390 en 430 px brede telefoons, een tablet van 768 px en desktop (1363 × 936). Op de gecontroleerde breedtes is geen horizontale paginaoverloop. De digitale getalvakjes zijn op het smalste gecontroleerde scherm 45 × 45 px. De demotests controleren de lokale transporten, een geldige voorbeeldbingo, opslagisolatie en bewaarde markeringen; de bestaande familie-, chat- en beltests controleren de echte routes.

De lokale ontwikkelserver ondersteunt `/spelen?voorbeeld=1&brand=milo`. Alleen die expliciete voorbeeldroute gebruikt de fictieve familie, boekjes en chat uit `scripts/family-preview-data.mjs`. De zichtbare badge meldt dat dit geen echte show is. LiveKit-, microfoon- en providerkoppelingen worden niet als geslaagd gesimuleerd. De productie-Worker importeert deze ontwikkelfixture niet.

Visueel gecontroleerd in de browser op desktop (1363 × 936), laptop (1280 × 768) en in een smalle viewport (390 × 844). Het ballenbord en de chatinvoer blijven op de gecontroleerde desktopschermen binnen de viewport. De showpagina begint direct met de uitzending. Het mobiele bord behoudt vijf rijen van vijftien nummers en heeft geen horizontale overloop. Op gebruikelijke telefoons staat BINGO rechts van het bord; onder 361px schuift de knop eronder om de nummers leesbaar te houden. De standby-afbeelding en de echte videospeler delen hetzelfde 16:9-kader. De compacte chatinvoer en emoji/verzendknoppen zijn ook met een zichtbaar verzonden voorbeeldbericht gecontroleerd; dat bericht bleef in de lokale ontwikkelvoorbeeldshow.

Regressiecontroles: `check-family-brand`, `check-family-extras`, `check-player-app`, `check-player-live-call` en `check-youtube-player`. De uitgebreide React-controle dekt onder meer de juiste Milo/Vlampie-assets, navigatie, bewaarde afstreepmarkeringen, expliciete BINGO-bevestiging en de blijvende YouTube-afspeler. De nummerbordcontrole dekt alle 75 cellen, servergestuurde markeringen, een volgende trekking via polling en het uitblijven van spelacties bij klikken op het bord. Dit is geen bewijs van een echte providerrepetitie; daar zijn de bestaande accountinstellingen en een echte uitzending voor nodig.
