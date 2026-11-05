# Status, verificatie en acceptatie — Milo & Friends BingoShow

Peildatum: 4 november 2026. Broncommit: `08e1a652a78586d2e791179eead388acad8a3266` (de overgedragen Sites-versie 63).

Dit document beschrijft de aangetroffen implementatie en de opnieuw uitgevoerde lokale controles. Een geslaagde simulatie, DOM-harnas of providerstub is **geen** bewijs van een geslaagde echte OpenAI-, LiveKit-, microfoon-, e-mail-, OBS- of YouTube-koppeling.

## 1. Huidige functionele status

| Onderdeel | Aanwezig in de bron | Bewijs / resterende verificatie |
| --- | --- | --- |
| Regie | React-werkplek met PROGRAM/PREVIEW, afzonderlijke cameravoorbereiding en TAKE, vaste bediening, modulaire panelen en pop-outs. | `check-regie-workspace` slaagt met echte engine en lichtgewicht DOM. Pop-outs zijn portals van de hoofdregie, geen tweede audio-/engine-eigenaar. Houd de hoofdregie geopend. Echte browservensters en OBS nog op doelhardware repeteren. |
| Studio 1 — Sterrenplein | Gelaagde 2.5D-Canvasstudio met afzonderlijke ruimte, desk, officiële 5×15-nummerdesk, camera-uitsneden, licht, props en gasten. Elf shotassets staan in `public/assets/milo-friends/studio/shots/`. | De bestanden en configuratie zijn aanwezig; regie-, cast- en merkcontracten slagen. Dit is geen vrij navigeerbare 3D-wereld. Bronruimte/desk zijn 1672×941; compositie-uitvoer is 1920×1080. Niet als native 4K-assetset presenteren. |
| Milo-beweging | Gelede 2D-pop met hoofd/hoed/armen/ellebogen/polsen/benen/staart; vloeiende gewichtsverplaatsing, ademhaling, gevarieerd knipperen, spreekgebaren en aandacht voor gast of nummerbord. | `check-milo-motion` en `check-milo-life` slagen. Hier zijn wiskundige poses/timing gecontroleerd, niet opnieuw een volledige videorender op elke telefoon. Doel van 60 fps is geen garantie op ieder apparaat. |
| Magie en showcues | Twee Milo-trucs (sterrenhoed, sterrenvlinder), negen losse gebaren en acht aanvullende showmomenten, met pauze/einde/herstel en draaiboekkoppeling. | `check-cast-runner` slaagt: cues veranderen geen getrokken nummer of winnaar, gastdialoog verloopt op volgorde. Bekijk choreografie, effectgeluid en framing nog in de echte uitzending. |
| Twaalf vrienden | Milo, Stella, Otto, Pip, Lola, Bella, Piko, Bruno, Nino, Benny, Kora en Coco hebben profiel, persoonlijkheid, personageboek, stemkeuze, spreekstijl en bewegingsinstellingen. | `check-characters` slaagt op aparte identiteit, revisiebeveiliging, opslag en één globale sleutel. De echte stemmen moeten met het eigen account worden beluisterd. Andere vrienden gebruiken een vervormbare beeldrig; zij hebben geen nieuwe volledige 3D-modellen. |
| Mond en spreken | Audio-niveaugestuurde mondanimatie en voorgedefinieerde praatbeelden; browserstem voor repetitie. | Geen exacte foneemvisemen. Browserrepetitie is een benadering, geen bewijs van de AI-stemkwaliteit. Live stemmen/modeltoegang nog echt controleren. |
| Vlampie | Eigen merk, karakter en behouden Showtime- en Sinterklaasstudio; eigen logo/PDF- en showinstellingen. | Merk-/wisselcontract slaagt. Wisselen tijdens actief bellen is geblokkeerd; opgeslagen speluitkomsten worden niet aangepast. Geen stilzwijgende migratie van Vlampie naar Milo. |
| Beslisspellen | De huidige Milo-catalogus heeft **16** opties; de vijf expliciet gekozen magische spellen staan bovenaan. Vlampie heeft 12. | `check-milo-minigame-catalog` controleert daadwerkelijk 16 Milo-kaarten en 12 Vlampie-kaarten. Niet claimen dat 20 volledige games zijn gebouwd. |
| Vijf magische spellen | Sterrenplingo, Lintenlabyrint, Spiegelpaleis, Toverdrank en Sterrenvlinder hebben eigen renderer/route. | Catalogus-, server- en kloktests slagen. De server kiest en bewaart de uitslag één keer; animatie mag die niet veranderen. De minigameklok blijft doorlopen bij herhaalde/verouderde snapshots en bevriest bij pauze. Echte OBS-/YouTube-vloeiendheid blijft een repetitietest. |
| Familie-app | Vijf tabs: Kijken, Boekjes, Gezin, Meedoen en Prijzen. Desktop: links uitzending + bord/BINGO, rechts chat. Mobiel: uitzending → 5×15-bord/BINGO → chat. | Nieuwe familie- en demonstratietests slagen. De regie-/bingo-/callcontroller en YouTube-iframe blijven bij tabwissels gemount. Zie `docs/familie-redesign.md` voor de uitgevoerde browserbreedtes en responsive beperkingen. |
| Gevulde demofamilie | `/spelen?demo=1`: Noor en Sem, twee boekjes met vier rondes, ronde 2, 28 getrokken nummers, chat, voorbeeldprijzen en gesimuleerde studioanimatie. | `check-family-demo` controleert alle vijf schermen, lokale acties, markeringen, reset en behoud van echte accountopslag. Geen echte spel-API, EventSource, microfoon, LiveKit of OpenAI in demostand. Statische voorbeeld-PDF is niet het geldige persoonlijke demoboekje. |
| Echte bingo | Unieke serverkaarten, meldvenster, epoch/checkpoint, expliciete boekjesbevestiging, winnaars en serveruitslag. | Familie-, PDF-, minigame- en trekkingblokkadetests slagen. De originele serverkaart blijft leidend; persoonlijke afstreepmarkering is alleen presentatie. Volledige echte ronde met meerdere accounts nog repeteren. |
| PDF-boekjes | Sterrenmagie-A5: drie rondes + finale, vier 5×5-kaarten, groepslogo, lichtgekleurde vakken, code/bladnummer/uitleg/QR; kleur en inktarm, plus A4 dubbel. | `check-milo-print` genereert drie boekjes/twaalf unieke kaarten en controleert A5/A4, kaartidentiteiten en ongewijzigde tokens/codes. Statische voorbeelden zijn gemarkeerd en geen geldige deelnemersboekjes. Print- en QR-praktijktest nodig. |
| Bellen | Eén geselecteerde deelnemer tegelijk. YouTube voor normale kijkers; privé- en livekamers in LiveKit; AI pas live; expliciete kindcontext en terugkeercontrole. | Call-state-, player-, audiograph- en draw-holdtests slagen met stubs. Echte Cloud-/WebRTC-/OBS-audio nog niet door deze overdracht bewezen. |
| Geheimen en instellingen | Centrale OpenAI-koppeling, aparte LiveKit-gegevens, per-karakterinstellingen, serverzijde versleutelde sleutelopslag en revisiecontroles. | `check-secrets` en `check-characters` slagen met testwaarden en nagebootste providerantwoorden. Huidige productiecredentials zijn niet gelezen, geëxporteerd of getest. |

## 2. Uitgevoerde controles

Alle onderstaande scripts zijn opnieuw uitgevoerd vanuit de bronmap met Node.js `v24.22.1`. Alle 17 processen eindigden met exitcode 0. Dit is een representatieve controleset, niet een claim dat ieder `scripts/check-*.mjs`-bestand opnieuw is uitgevoerd.

| Commando | Exitcode | Duur |
| --- | ---: | ---: |
| `node scripts/check-family-demo.mjs` | 0 | 4.72 s |
| `node scripts/check-family-extras.mjs` | 0 | 12.42 s |
| `node scripts/check-milo-print.mjs` | 0 | 3.37 s |
| `node scripts/check-characters.mjs` | 0 | 0.18 s |
| `node scripts/check-cast-runner.mjs` | 0 | 0.19 s |
| `node scripts/check-milo-motion.mjs` | 0 | 0.96 s |
| `node scripts/check-milo-life.mjs` | 0 | 0.16 s |
| `node scripts/check-milo-minigame-catalog.mjs` | 0 | 1.58 s |
| `node scripts/check-milo-minigame-server.mjs` | 0 | 0.77 s |
| `node scripts/check-milo-game-clock.mjs` | 0 | 0.61 s |
| `node scripts/check-call-draw-hold.mjs` | 0 | 0.22 s |
| `node scripts/check-live-call-audio.mjs` | 0 | 0.16 s |
| `node scripts/check-live-calls.mjs` | 0 | 0.84 s |
| `node scripts/check-player-live-call.mjs` | 0 | 0.18 s |
| `node scripts/check-regie-workspace.mjs` | 0 | 4.33 s |
| `node scripts/check-brand-contract.mjs` | 0 | 3.61 s |
| `node scripts/check-secrets.mjs` | 0 | 0.29 s |

De volledige uitvoer staat in `verification/testlogs/`; de machineleesbare samenvatting staat in `verification/test-results.json`. De geëxporteerde bron bouwde ook succesvol en doorstond de controle van de gebouwde ingangen; zie `verification/export-build.json`. Hiervoor zijn de reeds geïnstalleerde dependencies gebruikt; een verse `npm ci` in de export is niet uitgevoerd. De harnassen gebruiken geheugenopslag, fake audio/media, providerstubs en/of een lichtgewicht DOM. Geen echte bingoclaim, bericht aan een deelnemer, providerverbinding of live uitzending is hierdoor gestart.

Sommige render-/UI-tests gebruiken `@napi-rs/canvas` via `CODEX_PRIMARY_RUNTIME_NODE_MODULES` of een Codex-runtimepad. Op een andere machine moet Codex die authoring-/testafhankelijkheid beschikbaar maken en de testomgeving expliciet configureren. Een ontbrekend lokaal runtimepad is geen geslaagde test en rechtvaardigt geen verwijdering van die test.

## 3. Koppelingen die voor een echte repetitie nog nodig zijn

1. **OpenAI:** geldige centrale serversleutel, tegoed/modeltoegang en per-karakter opgeslagen instellingen. Luister alle twaalf stemmen af. Gebruik de daadwerkelijk opgeslagen gespreksstem; een tekstuele stemomschrijving is geen geïmporteerde externe stem. In de bron zijn modelnamen/stemlijsten vastgelegd; dit document heeft hun actuele providerbeschikbaarheid niet extern geverifieerd.
2. **LiveKit Cloud:** eigen project-URL, API key en API secret, serverzijdig opgeslagen. De OpenAI-sleutel vervangt deze gegevens niet. Een geslaagde serverinstellingentest bewijst nog geen werkende microfoon of afspeling.
3. **YouTube / OBS:** geldige insluitbare uitzending, correct uitzendvenster als beeld-/audiobron en echte controle van het geluid bij een meekijkapparaat. Algemene desktopaudio kan privacy omzeilen; controleer de meters en de daadwerkelijk opgenomen kanalen.
4. **Accounts en mail:** echte ouderaccounts en meerdere kindprofielen; werkende OTP-/mailinstellingen van de gekozen hostomgeving. De demofamilie is geen accountsessie op de echte spelserver.
5. **Productieopslag en toegang:** D1/R2 en eigenaaridentiteit in Sites, of bewust geporteerde equivalenten op staging. De Site is nu privé. Een link naar `/spelen` maakt de Site niet publiek en maakt geen externe kijker automatisch bevoegd.

## 4. Acceptatie voor Codex: vóór oplevering op staging

- [ ] Leg vast welk broncommit wordt gebouwd; bewaar de goedgekeurde vormgeving en assets.
- [ ] Houd Milo als standaardwereld en Vlampie met twee bestaande studio’s apart. Controleer expliciete oude show-/QR-links.
- [ ] Laat alle twaalf vrienden presenteren én als gast verschijnen via het draaiboek; controleer stem, naam, bewegingsenergie en terugkeer na een bezoek.
- [ ] Controleer alle elf camerashots, PREVIEW/TAKE en pauze/herstel. Nummerbord blijft 5×15 en toont alleen serverbevestigde nummers.
- [ ] Speel beide Milo-trucs volledig af; controleer hand/prop/contact, zichtbaarheid boven de desk, effectgeluid en herstel naar de vorige camera.
- [ ] Speel alle vijf gekozen minigames af, pauzeer/hervat, ververs en herhaal statuspakketten. Uitslag blijft gelijk; geen kaart, prijs of getrokken nummer verandert door de animatie.
- [ ] Controleer de familie-app op 320/390/430/768 px en desktop, inclusief lang e-mailadres, lange kindnaam, vier rondeknoppen, modals en toetsenbord/focus. Geen horizontale paginaoverloop.
- [ ] Test de gevulde demo zonder providers of echte API-writes; ‘Opnieuw’ mag echte OTP-/boekjes-/afstreepgegevens niet wissen.
- [ ] Doorloop echte OTP, onboarding, meerdere kinderen, QR én handmatige boekjeskoppeling, afstrepen en expliciete BINGO-bevestiging.
- [ ] Genereer meerdere unieke boekjes, download dezelfde boekjes opnieuw en vergelijk de kaartnummers/tokens. Controleer kleur/inktarm/A5/A4 dubbel op papier en scan de QR op een ander apparaat.
- [ ] Bewijs dat alleen de server nummers, kaarten, bingo’s en winnaars bepaalt. Test gelijktijdige meldingen, herhaalde verzoeken en herstel na vernieuwen.
- [ ] Voer onderstaande echte belrepetitie uit en leg waarnemingen vast. Alleen daarna ‘echt gerepeteerd’ melden.
- [ ] Leg concrete resterende fouten vast; vervang een mislukte koppeling niet door een demonstratiesucces.

## 5. Echte bel- en uitzendproef

Gebruik een regieapparaat, een ouderapparaat met twee kindprofielen, een apart privé-meekijkapparaat voor YouTube en headsets. Gebruik bij voorkeur twee internetverbindingen. Begin met één deelnemer live.

| Stap | Handeling | Te bewijzen resultaat |
| --- | --- | --- |
| 1 | Kies een kind, corrigeer roepnaam en optionele uitspraak/reden/notitie. | De ouderaccountnaam wordt niet automatisch als kindnaam gebruikt; alleen bevestigde spelinformatie gaat mee. |
| 2 | Kies **Belmoment voorbereiden**, liefst na afgehandelde bingo of tussen rondes. | Centrale `drawHold` blokkeert automatisch, handmatig en AI/gescripte trekkingen. Verversen behoudt de blokkade. Tijdens een nog open meldvenster moet voorbereiden worden geweigerd; het venster wordt niet voortijdig gesloten. |
| 3 | Laat Milo entertainment doen terwijl het gezin wacht. | Uitzending blijft lopen; nummers/kaarten blijven gelijk. |
| 4 | Bel. Laat ouder het laatste checkpointnummer in vertraagde YouTube horen en kaarten bijwerken. | Expliciete bevestiging plus werkelijk gedempt YouTube; geen vaste wachttijd als enig bewijs. Opnemen/Weigeren werkt. |
| 5 | Spreek achter de schermen. | Regie en gezin horen elkaar; studio, YouTube én AI horen dit gesprek niet. Controleer echte OBS-/uitzendmeters en meekijkgeluid. Er loopt nog geen AI-sessie. |
| 6 | Controleer context en kies expliciet **Live met Milo**. | Privékamer sluit; livekamer en AI starten pas nu. Milo gebruikt de gecorrigeerde kindnaam. Beide live stemmen komen in de uitzending, zonder vertraagde eigen-stem-echo. |
| 7 | Demp deelnemer en geef weer vrij. | Geluid wordt werkelijk geblokkeerd en vrijgeven vereist correcte herpublicatie; labels alleen zijn onvoldoende. |
| 8 | Beëindig gesprek. | AI-/media-/Cloud-resources sluiten; fout bij afsluiten is zichtbaar en opnieuw te proberen. Trekking blijft geblokkeerd. |
| 9 | Herstel normale YouTube-weergave en bevestig terugkeer. | Waar betrouwbaar afspeelinformatie, daarnaast ouder-/regiebevestiging. Bij regiecontrole een concrete notitie. Alle getrokken nummers blijven zichtbaar. |
| 10 | Kies bewust **Nummertrekking hervatten**. | Pas na terugkeer en resourceafsluiting wordt de blokkade vrijgegeven. Er wordt niet vanzelf een nummer getrokken. |
| 11 | Bel een ander kind en herhaal met een andere presentator. | Actieve gastcontext is vervangen; vorige naam/gegevens lekken niet door. Stem/personage volgen de gekozen presentator. |

Voer ook weigeren, 90 seconden niet opnemen, microfoontoestemming weigeren, annuleren, verversen, internetverlies (privé én live), uitzendvenster sluiten en een afsluitfout uit. Elke foutroute behoudt de trekkingblokkade tot bewuste herstelactie. Gewone kijkers krijgen nooit een LiveKit-token of eigen AI-sessie.

## 6. Broncode blijft leidend bij historische documentatie

`README.md` bevat bewust ook oudere Vlampie-/Rocco-beschrijvingen. Bepaalde aantallen en stemkoppelingen daarin lopen achter op de nieuwste bron: de actuele Milo-catalogus heeft 16 items (niet de eerder beschreven elf), de familie-app heeft vijf tabs en `server/characters.js` bevat de huidige stemnormalisatie. Gebruik de nieuwste modules, tests en deze status als leidraad. Dit is geen reden om oude spelgegevens of merkidentiteiten te verwijderen.

Belangrijke brongroepen:

- Familie/demodata: `frontend/FamilyApp.jsx`, `frontend/FamilyExtras.jsx`, `frontend/FamilyLiveCall.jsx`, `frontend/family-demo.js`, `frontend/family-responsive.css`, `frontend/FamilyDemoStage.jsx`.
- Karakters en spelregels: `server/characters.js`, `server/character-settings.js`, `server/bingo-model.js`, `server/show-brands.js`.
- Regie/uitvoer: `frontend/RegieWorkspace.jsx`, `frontend/engine.js`, `public/mf-studio.js`, `public/mf-broadcast-set.js`, `public/mf-camera.js`.
- Beweging en games: `public/milo-puppet.js`, `public/milo-motion.js`, `public/milo-life.js`, `public/milo-minigame-art.js`, `public/milo-minigame-plan.js`, `public/show-cues.js`.
- Bellen: `server/live-calls.js`, `server/live-call-model.js`, `server/livekit.js`, `frontend/player-live-call.js`, `frontend/livekit-media.js`, `docs/live-calls-contract.md`, `docs/live-calls-rehearsal.md`.
- Print: `server/bingo-pdf.js`, `server/milo-print-layout.js`, `server/milo-print-assets.js`, `scripts/check-milo-print.mjs`.
