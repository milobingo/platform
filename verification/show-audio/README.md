# Vooraf geladen showaudio — lokale verificatie

Getest op de standalone-build die in `source-binding.json` aan de bronbestanden is gekoppeld. De staginguitrol volgt pas na een geslaagde CI op de gepushte commit.

- `node-tests.json` en `node-testlogs/`: alle 112 geregistreerde testgroepen geslaagd op Node 24.18.0. PostgreSQL-controles worden in CI met de aparte testdatabase uitgevoerd.
- `build.log`, `lint.log`, `typecheck.log`: geslaagd.
- `other-browser-tests.log`: 12 geslaagde controles voor automatisch opslaan, tien prijsstappen, foutbehoud, starten, instellingen en OBS-herstel.
- `regie-youtube-browser-summary.json`: 9 geslaagde controles voor regie, Vlampie, annuleren, 10.000 tekens en de onafhankelijke YouTube-opslag op mobiel en desktop.
- `browser-preparation/summary.json`: 2 geslaagde audiovoorbereidingstests. De browser laadt 123 fragmenten inclusief lange draaiboekteksten en gastdialogen; een wijziging haalt alleen de gewijzigde fragmenten op. Start wacht op de laatste audiobyte en start eenmaal.
- `browser-preparation/live-cadence-and-reload.json`: echte browser- en serverklok; twee officiële ballen liggen 15.098 ms uit elkaar. Geen nieuwe spraakaanvraag tijdens de trekking, drie daadwerkelijke Web Audio-afspeelmomenten, eenmalige negenreactie, zestien seconden pauze en herladen met behoud van het meldvenster en de spelstand.
- `rendered-music.json`: daadwerkelijke Chromium-audiorender van de muziek, ducking en stilte bij pauze.
- `predeploy-host-health.json`: uitgangssituatie met alle twaalf hostcontroles geslaagd.
- `postgres-broadcast-final.log`: alle 13 controles geslaagd zonder overslaan op een afzonderlijke lokale PostgreSQL 17-testcontainer, inclusief gelijktijdige YouTube-opslag en duurzame eenmalige audioreacties. De container is daarna gestopt.

De browserproeven gebruiken volledig onderschept transport, geïsoleerde echte Bingo-handlers/SQLite en synthetische voorbereide WAV-bestanden. Ze wijzigen geen echte shows, doen geen betaalde provideraanvragen en bewijzen geen menselijke beoordeling van de uiteindelijke OpenAI-stem. OBS is hier niet geïnstalleerd: controle van de echte OBS-mixer en een korte proefopname met beeld, stem, muziek en testgeluid blijven noodzakelijk.

Een eerste test ontdekte een ontbrekende narratieblokkade bij winnaars; de oorspronkelijke uitvoer staat in `initial-node-tests.log`. Een echte browsertest ontdekte daarna de native `fetch`-binding; voorfixbewijs staat in `browser-preparation/native-fetch-binding-before-fix/`. Beide appfouten zijn hersteld en de definitieve controles hierboven zijn groen. Aanvullende screenshots en tijdelijke Playwright-traces zijn buiten de repository bewaard; de relevante nieuwe screenshots staan bij dit verslag.

CI-run 43719503972 vond daarnaast een fout in de nieuwe PostgreSQL-test: de verwachte hostresponse bevatte het geheime trekdek, dat de server correct weglaat. De test vergelijkt nu de volledige toegestane response, eist expliciet dat het dek ontbreekt en controleert afzonderlijk dat de volledige private serverstaat ongewijzigd blijft. Dit is uitsluitend een testcorrectie; de app en de hierboven geteste build zijn gelijk gebleven. De eerste CI-uitvoer is bewaard in `ci-43719503972-failure.log`; de echte lokale PostgreSQL-herhaling is groen.
