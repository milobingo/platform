# Beelden en voorbeelden — Milo & Friends BingoShow

Deze inventaris hoort bij broncommit `08e1a652a78586d2e791179eead388acad8a3266` (Sites-versie 63, 4 november 2026). De oorspronkelijke assets blijven onder `source/public/assets/` staan. URL-paden zoals `/assets/...` verwijzen in de app naar die map. Dit document beschrijft de actuele bronbestanden; het is geen export van productieaccounts of opgeslagen providerinstellingen.

## Omvang en integriteit

- **133 git-tracked assetbestanden**, samen **216,545,402 bytes (206.5 MiB)**; **67** bestanden onder `public/assets/milo-friends/`.
- Formaten: 60 PNG, 41 WebP, 8 JPG, 12 PDF, 7 JSON, 2 ZIP, 2 GLB en 1 MP4.
- `assetcatalog.json` bevat ieder bronpad, bestandsgrootte, SHA-256, afbeeldingsformaat en waar van toepassing pixelafmetingen/transparantie. Het is geschikt om na het uitpakken ontbrekende of veranderde bestanden vast te stellen.
- Alle bestanden blijven op hun huidige paden. Compatibiliteitsbestanden mogen niet uitsluitend op basis van een vergelijkbare naam worden verwijderd.
- Het volledige gitproject bevat **geen SVG-bestand**. Het meegeleverde groepslogo is een transparant rasterbeeld; er is geen bewerkbaar oorspronkelijk vectorlogo, Illustrator- of PSD-bestand aangetroffen.

## De juiste merkbestanden

| Gebruik | Bronbestand | Afmetingen / opmerking |
| --- | --- | --- |
| Officieel Milo & Friends-groepslogo | `public/assets/milo-friends/logo.png` | 1536 × 1024, RGBA/transparant; Milo met de andere elf vrienden |
| Inktarme logo-adaptatie | `public/assets/milo-friends/logo-print-ink.png` | 1536 × 1024, RGBA/transparant; lijnwerk voor de zwart-witprint |
| Afgeleide printvoorbeelden | `public/assets/milo-friends/logo-print.jpg`, `logo-print-mono.jpg` | Rasterafgeleiden; niet als vector presenteren |
| Losse Milo | `public/assets/milo-friends/characters/milo.png` | 799 × 916, transparant |
| Vlampie-logo | `public/assets/studio-logo.png` | Bestaande Vlampie-huisstijl; niet voor Milo gebruiken |
| Vlampie-karakter | `public/assets/vlampie-illustrated-v10.png` | Bestaand karakter behouden |

De oudere bestanden `public/assets/hosts/milo-logo.*`, `milo-mascot.*` en het oude host-artwork horen bij de eerdere Milo Magico/Moonlight Atelier-opzet. Zij zijn behouden voor bestaande paden en historie, maar vervangen het huidige groepslogo en Sterrenplein niet. `Rocco Royale` staat als gearchiveerde merkwereld in `server/show-brands.js`; ook die assets blijven in de bronboom staan.

## De twaalf vrienden

De actuele bron van personage-identiteit is `source/server/characters.js`; opslag en instellingen staan daarnaast in `source/server/character-settings.js`. Iedere vriend heeft een PNG voor rust en een tweede PNG met suffix `-talk.png`. De tabel toont de **broncode-defaults**, niet een bevestiging dat iedere providerstem in het aangesloten account beschikbaar of beluisterd is.

| ID | Naam | Dier | Standaard stem-ID | Rustafbeelding (app-URL) |
| --- | --- | --- | --- | --- |
| milo | Milo Magico | Wasbeer | verse | `/assets/milo-friends/characters/milo.png` |
| stella | Stella Sterrenstof | Hert | shimmer | `/assets/milo-friends/characters/stella.png` |
| otto | Otto Octa | Octopus | echo | `/assets/milo-friends/characters/otto.png` |
| pip | Pip Popcorn | Stokstaart | gleam | `/assets/milo-friends/characters/pip.png` |
| lola | Lola Lumière | Lynx | ash | `/assets/milo-friends/characters/lola.png` |
| bella | Bella Bellissimo | Flamingo | coral | `/assets/milo-friends/characters/bella.png` |
| piko | Professor Piko | Uil | sage | `/assets/milo-friends/characters/piko.png` |
| bruno | Bruno Bonbon | Beer | stone | `/assets/milo-friends/characters/bruno.png` |
| nino | Nino Nonsens | Kameleon | meridian | `/assets/milo-friends/characters/nino.png` |
| benny | Benny Bubbels | Pinguïn | alloy | `/assets/milo-friends/characters/benny.png` |
| kora | Kapitein Kora | Otter | cedar | `/assets/milo-friends/characters/kora.png` |
| coco | Coco Calypso | Papegaai | tempo | `/assets/milo-friends/characters/coco.png` |

Vlampie is daarnaast een afzonderlijke dertiende identiteit (`vlampie`, standaard `ballad`) met de bestaande Showtime- en Sinterklaasstudio. Hij telt niet als één van de twaalf Milo-vrienden.

`examples/personage-defaults.json` bevat de volledige broncode-defaults: naam, beschrijving, persona/personageboek, relaties, humor, stemomschrijving, spreekstijl, uitspraak, gedrag, vaste uitspraken, `signatureMoment`, beweging, lipsynchronisatie en geheugenbeleid. `profileVersion` is bij alle dertien identiteiten 2. Alle broncode-defaults hebben `speechEngine: "gpt-live"` en een lege `customVoiceId`. Er zijn geen afzonderlijke audiobestanden van twaalf ingesproken stemmen in de git-assets aangetroffen. Behandel de instellingen als een startconfiguratie en test de feitelijke stemmen met de echte koppeling.

De registratiemetadata staat onder `public/assets/milo-friends/characters/` in `assets-a.json`, `rigs-a.json` en `profiles-b.json`. Sommige metadata vermeldt historische absolute `sourceAtlas`-paden naar scratchbestanden. Die oorspronkelijke atlassen zijn niet als losse bronbestanden in de repo aangetroffen. De geëxtraheerde rust-/praat-PNG’s en rigmetadata zijn wel meegeleverd en worden door de huidige code gebruikt.

## Studio 1 — Sterrenplein

| Bestand / map | Betekenis |
| --- | --- |
| `public/assets/milo-friends/studio/sterrenplein.jpg` | Oorspronkelijke gekozen Studio 01-referentie |
| `public/assets/milo-friends/studio/sterrenplein-grand-room.webp` | Decorlaag zonder desk, 1672 × 941 |
| `public/assets/milo-friends/studio/sterrenplein-grand-desk.webp` | Losse transparante desk, 1672 × 941 |
| `public/assets/milo-friends/studio/sterrenplein-magic-props.webp` | Transparante goochelprops |
| `public/assets/milo-friends/studio/sterrenplein-grand-preview.webp` | Samengestelde referentie, 1920 × 1080 |
| `public/assets/milo-friends/studio/broadcast-arena-preview.webp` | Bestaand compositievoorbeeld; de code bepaalt de actuele weergave |
| `public/assets/milo-friends/studio/shots/` | Elf enginebeelden: `board`, `crane`, `dolly`, `duo`, `establish`, `guest`, `host`, `magic`, `orbit`, `portrait`, `wide` |
| `public/assets/milo-friends/studio/show-cues/` | Tien cuebeelden, onder meer `star-hat`, `silk-stars`, `applause`, `welcome-wave` en `portal-arrival` |
| `public/assets/milo-friends/studio/sterrenwervel-preview.mp4` | Bewegingsvoorbeeld: 12 seconden, H.264, 960 × 540, 20 fps; geen audiostream |

De huidige studio is een **2.5D-compositie voor een 2D-uitzending**. Decor, desk, presentatorrig, echte nummerweergave en magie worden apart getekend. De camera’s gebruiken uitsneden/overgangen en kleine parallaxverschuivingen. De bronset is geen vrij navigeerbare, volledig gemodelleerde 3D-studio en geen native 4K-assetset. Zie `source/docs/sterrenplein-studio.md`, `source/public/mf-broadcast-set.js`, `source/public/mf-studio.js` en `source/public/milo-puppet.js`.

Vlampies twee omgevingen blijven apart: Showtime gebruikt onder andere `studio-master-v14.png`, `studio-desk-v17.png` en `studio-machine-v11.png`; Sinterklaas gebruikt `sinterklaas-master-v14.png`, `sinterklaas-desk-v17.png` en `sinterklaas-machine-v12.png`. De overige versienummers, mond-/knipperbeelden en twee GLB-bestanden blijven als bestaande bronbestanden behouden. Meng deze afbeeldingen niet met Milo’s standaarddecor.

## De gekozen minigames

Sterrenplingo, Lintenlabyrint, Spiegelpaleis, Toverdrank en Sterrenvlinder worden grotendeels met Canvas opgebouwd. Er is daarom geen zelfstandig PNG-pakket per spel dat de werking kan vervangen.

| Naam | Spel-ID | Belangrijkste bron |
| --- | --- | --- |
| Sterrenplingo | `plingo` | `public/plingo-game.js`, `public/milo-minigame-plan.js` |
| Lintenlabyrint | `ribbons` | `public/milo-ribbon-game.js` |
| Spiegelpaleis | `mirrors` | `public/milo-magic-games.js` |
| Toverdrank | `potion` | `public/milo-magic-games.js` |
| Sterrenvlinder | `butterfly` | `public/milo-magic-games.js` |

Gedeelde decoratieve renderlogica staat in `public/milo-minigame-art.js`. De spel- en winnaarstatus blijft leidend; een bitmapvoorbeeld bepaalt geen uitslag. Zie ook `source/docs/milo-beslisspellen.md`.

## Bingobladen — uitgewerkt premium ontwerp 5

De huidige implementatie heet **Sterrenmagie** (`MILO_PRINT_VERSION: milo-friends-sterrenmagie-a5-v4`). Iedere A5-pagina heeft vier 5×5-kaarten: ronde 1, ronde 2, ronde 3 en de luxer uitgevoerde finaleronde, plus bladnummer, uitleg en QR-vlak. De getalvakjes zijn licht; de inktarme uitvoering heeft witte vakjes en lijnwerk.

| Bestand | Gebruik |
| --- | --- |
| `public/assets/milo-friends/template-color.pdf` | Leeg kleurensjabloon, 1 pagina A5 (148 × 210 mm) |
| `public/assets/milo-friends/template-mono.pdf` | Leeg inktarm zwart-witsjabloon, 1 pagina A5 |
| `public/assets/milo-friends/example-color.pdf` | Gevuld kleurvoorbeeld; zichtbaar VOORBEELD/niet geldig |
| `public/assets/milo-friends/example-mono.pdf` | Gevuld inktarm voorbeeld; zichtbaar VOORBEELD/niet geldig |
| `public/assets/milo-friends/bingo-preview-color.jpg` | Rastervoorvertoning van de kleurversie |
| `public/assets/milo-friends/bingo-preview-mono.jpg` | Rastervoorvertoning van de inktarme versie |
| `public/assets/milo-friends/print-waves.png` | Decoratieve golven/printachtergrond |

De vier genoemde PDF’s zijn gecontroleerd met `pdfinfo`: elk één pagina van 419,528 × 595,276 punten (A5); alle vier rondekoppen zijn aanwezig. Alleen de twee gevulde voorbeelden bevatten de VOORBEELD-markering. De PDF’s zijn **geen volledig vectorlogo**: tekst/cellen en delen van de kaders zijn vector, logo en decoratieve achtergrond zijn rasterbeelden.

Productie-PDF’s komen uit `source/server/bingo-pdf.js` en de gedeelde lay-out in `source/server/bingo-print-layout.js`/`milo-print-layout.js`. De echte spelserver bepaalt kaarten, blad-ID en activatietoken; een statisch voorbeeld-PDF hoort niet bij een demoboekje in de familie-app. De demolinks zijn daarom als ‘Voorbeeld-PDF’ gelabeld.

Om de printvoorbeelden vanuit de broncode opnieuw te maken: bekijk eerst `source/scripts/render-milo-print-art.mjs`, `build-milo-print.mjs` en `example-milo-print.mjs`. Het voorbeeldscript genereert twee fictieve boekjes en controleert acht unieke kaarten; de publiek opgeslagen A5-voorbeelden tonen het eerste boekje. Interne QR-controlebestanden uit `.sites-runtime/print-qa` zijn werkbestanden en horen niet als echte deelnemerkaarten gebruikt te worden.

## Gevulde familievoorbeelden

`examples/familie-demo.json` bevat een opnieuw aangemaakte, expliciet fictieve snapshot uit de huidige `source/frontend/family-demo.js`:

- Familie Jansen, Noor (8) en Sem (6).
- Twee gekoppelde boekjes (`#1041`, `#1042`), ieder vier rondes.
- Lopende Milo-demo in ronde 2 met 28 getrokken nummers; Noors hoekenpatroon is compleet.
- Tien voorbeeldchatberichten, begroeting/beschikbaarheid en eerder gewonnen voorbeeldprijzen.
- Daarnaast een afgeronde Milo-voorbeeldshow en een afzonderlijke Vlampie-demo.

Dit bestand is een leesbaar API-/UI-voorbeeld, **geen databaseback-up, migratie of productie-seed**. De identiteiten, tokens, claims en prijzen zijn niet echt. Open voor de actuele klikbare versie de route `/spelen?demo=1` in een draaiende app. De voorbeeldstudio is een gemarkeerde animatie zonder geluid en is geen YouTube-/LiveKit-/OpenAI-repetitie.

## Historie en ontbrekende originelen

De twee meegeleverde `public/assets/hosts/*-artwork.zip`-bestanden zijn bestaande oudere assetarchieven. Zij zijn behouden, maar zijn niet de autoriteit voor het huidige Milo & Friends-logo of Sterrenplein. Vier byte-identieke groepen bestaan bewust als compatibiliteit:

1. `public/assets/bingo-print/logo-color.jpg` en `public/assets/studio-logo.png`.
2. `public/assets/hosts/milo-template-color.pdf` en `public/assets/milo-friends/template-color.pdf`.
3. `public/assets/hosts/milo-template-mono.pdf` en `public/assets/milo-friends/template-mono.pdf`.
4. `public/assets/milo-friends/bingo-preview-color.jpg` en `public/assets/milo-friends/bingo-preview.jpg`.

Let op: `studio-logo.png` is inhoudelijk een JPEG-bestand met een historische PNG-extensie; beide duplicaatpaden zijn behouden. Normaliseer dat alleen na het nalopen van alle verwijzingen.

Het in de studio-documentatie genoemde oorspronkelijke `Milo-Friends-10-Studio-Ontwerpen.pdf` is niet als git-tracked bron aangetroffen. Ook oorspronkelijke beeldgeneratiebestanden, volledige creatieve projectbestanden, een SVG-logo en eerdere externe promotiefilmpakketjes zijn niet in deze bronboom aangetroffen. Het pakket bevat wel alle huidige tracked afbeeldingen, de huidige studio-referenties, de twaalf rust-/praatsets en de actuele PDF-voorbeelden. Noem ontbrekende externe originelen niet ten onrechte ‘meegeleverd’.
