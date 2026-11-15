# Modulaire regiekamer

De Milo-regie zet de actuele ronde, prijsstap, laatste officiële bal, afteller, Pauze/Hervat en BINGO-controle voorop. PROGRAM, PREVIEW, TAKE en de presentator staan onder **Beeld & presentatie**; de overige modules onder **Overige regiepanelen**. De indeling schaalt mee met desktop en mobiel. Vlampie houdt zijn eigen console en werkpanelen.

## De werkplek indelen

- Kies één tot vier werkpanelen met de selector rechtsboven de panelen.
- Klik eerst een paneel aan en kies daarna een module in de balk om die plek te vervangen.
- Sleep bij de greep links in de paneeltitel om te verplaatsen. De pijlen doen hetzelfde met het toetsenbord.
- Versleep de scheiding tussen panelen om hun breedte te veranderen. Met toetsenbordfocus op de scheiding werken links/rechts; Home maakt de breedtes gelijk.
- Gebruik het venstericoon om een paneel los te openen, bijvoorbeeld op een tweede scherm. Sluiten of ‘Terug in de regie’ zet hetzelfde paneel terug.
- De resetknop herstelt de standaardindeling en haalt losse vensters terug. Dit verandert geen spelstand, belmoment of trekkingblokkade.

De indeling wordt lokaal per browser en productie bewaard. Milo en Vlampie hebben eigen indelingen. Pop-outs worden na verversen niet automatisch geopend, omdat browsers daarvoor een klik vereisen.

## Eén show, meerdere werkvensters

Pop-outs gebruiken een React-portal van de bestaande regie. Er start geen tweede StudioEngine, audio-eigenaar, hostlease of LiveKit-verbinding. Ook bij een gewone modulewissel blijft een eenmaal geopend paneel gemount, zodat onder meer een gecorrigeerde roepnaam en regienotities behouden blijven. Bij het verlaten van de regie sluiten de losse vensters. Houd de hoofdregie dus geopend.

Sneltoetsen N, spatie en Escape gelden in het hoofdvenster. Tekstvelden, selecties, knoppen, herhaalde toetsaanslagen en combinaties met Ctrl/Alt/Meta worden genegeerd om onbedoelde showacties te voorkomen.

Beide knoppen ‘Volgende bal’ volgen dezelfde beschikbaarheidscontrole. De spelserver en bestaande engine blijven uiteindelijk verantwoordelijk voor blokkades, meldvensters en officiële nummers.

## Controle en lokale preview

`node scripts/check-regie-panels.mjs` controleert indeling, begrenzing, bewaren, portalidentiteit, invoerbehoud, vensters sluiten, geblokkeerde pop-ups en opruimen.

`node scripts/check-regie-workspace.mjs` gebruikt de echte App en StudioEngine voor PREVIEW/TAKE, bediening, trekkingblokkade, meldvenster en behoud van belregie-invoer en chatcontroller. Canvas, audio en providerverkeer zijn in die test gemockt.

De lokale `npm run dev` is uitsluitend een UI-preview met de bestaande oefenstudio. Server- en providerverzoeken geven expliciet een foutmelding; dit is geen test van een echte OpenAI- of LiveKit-verbinding. De native productiebuild gebruikt Next.js en de beschermde serverconfiguratie. De lokale browsercontroles gebruiken geïsoleerde account-, audio- en providerfixtures en gelden niet als een echte OBS- of providerrepetitie.
