# Milo & Friends BingoShow — overdracht aan Codex

Dit pakket bevat de volledige, git-gevolgde bron van de opgeleverde Sites-versie 63: commit `08e1a652a78586d2e791179eead388acad8a3266`. De bronbestanden zijn als momentopname geëxporteerd; er zijn voor deze overdracht geen wijzigingen in de live-app aangebracht.

## Zo gebruik je het pakket

1. Pak de ZIP volledig uit. Houd `source/` en `examples/` naast elkaar.
2. Geef Codex deze pakketmap en plak `CODEX-BOUWPROMPT.txt` als opdracht.
3. Open `examples/index.html` voor de offline beeldgalerij, studio’s, personages en PDF-voorbeelden.
4. Voor de werkende lokale familie-demo: voer in `source/` achtereenvolgens `npm ci` en `npm run dev` uit. Open daarna `http://localhost:4173/spelen?demo=1`.
5. Lees `STAGING-EN-MIGRATIEPLAN.md` voordat de bron naar de DG-stagingomgeving wordt overgezet.

De gebruikte bronruntime is Node 24.22.1 / npm 11.9.0. De bron bevat een npm-lockfile; gebruik daarvoor `npm ci`. De uiteindelijke Next.js-doelrepository volgt haar eigen gecontroleerde toolchain en lockfile.

## Inhoud

| Onderdeel | Inhoud |
|---|---|
| `source/` | Alle 495 git-gevolgde bestanden: React-regie, familie-app, studio, backend, schema, migraties, tests, assets en bronmateriaal |
| `CODEX-BOUWPROMPT.txt` | Direct te gebruiken, projectspecifieke bouw- en overdrachtsopdracht |
| `ARCHITECTUUR-EN-CODEKAART.md` | Werkelijke huidige techniek, routes, gegevensstromen, instellingen en codeverwijzingen |
| `STATUS-EN-ACCEPTATIE.md` | Wat aanwezig/getest is, resterende beperkingen en volledige bel-/uitzendrepetitie |
| `BEELDEN-EN-VOORBEELDEN.md` | Officiële logo’s, twaalf vrienden, studio’s, printvoorbeelden en ontbrekende originelen |
| `STAGING-EN-MIGRATIEPLAN.md` | Overzetting naar Next.js/Supabase en de bestaande DG-releasewerkwijze |
| `PROJECTPROFIEL.json` | Bekende brongegevens en expliciet nog in te vullen doelgegevens |
| `docs/DG-Webservices-Masterprompt-Bouw-en-Deploy.txt` | De huidige vaste werkwijze, gelezen uit het masterdocument op 4 november 2026 |
| `OPENAI-DOCS-CHECK.md` | Actuele documentatiecontrole van het gebruikte GPT-Live-contract, zonder echte API-aanroep |
| `examples/` | Offline galerij, fictieve familie-/showvoorbeelden en personage-defaults |
| `assetcatalog.json` | Alle 133 `public/assets`-bestanden met paden, formaat, grootte en hashes |
| `verification/` | Resultaten en logs van 17 opnieuw uitgevoerde offline controles, plus bouw-/pakketcontrole |
| `tools/` | Pakketintegriteit controleren en de lokale UI-preview starten |
| `FILES-SHA256.json` | Integriteitsmanifest van alle pakketbestanden, behalve dit manifest zelf |
| `SOURCE-PROVENANCE.json` | Broncommit, versie, aantallen en expliciete uitsluitingen |

## Voorbeelden bekijken

Gepubliceerde bron: https://vlampie-studio.dgwebserv.chatgpt.site

Gevulde familie-demo: https://vlampie-studio.dgwebserv.chatgpt.site/spelen?demo=1

De Site is privé gebleven. De openbare vorm van een URL verleent geen toegang; voor de demo is geen aparte gezins-OTP nodig wanneer de buitenste Site-toegang is verleend.

De demo toont Familie Jansen, Noor en Sem, twee unieke boekjes met vier rondes, een lopende show in ronde 2, 28 getrokken ballen, afstreepmarkeringen, chat en voorbeeldprijzen. De studio is een gemarkeerde animatie zonder geluid. Demohandelingen blijven in de browser. De voorbeeld-PDF’s zijn geen geldige deelnemersboekjes.

## Belangrijke grens van deze overdracht

De huidige bron is React/esbuild met een Cloudflare Worker, D1 en R2. Het is nog geen zelfstandige Next.js/Node/Supabase-app. `npm run dev` start een UI-preview; de echte backend-API’s zijn daarin niet aangesloten. De familie-demo werkt via een eigen lokale adapter. Een geslaagde lokale demo bewijst geen echte OpenAI-, LiveKit-, mail- of YouTube-koppeling.

De overdracht bevat broncode, schema, migraties en alle huidige projectassets. Er zitten geen API-sleutels, runtime-secrets, productie-database-export, R2-accountinstellingen, `node_modules` of geïnstalleerde programma’s in. De oorspronkelijke externe promofilmpakketten en ontbrekende productie-atlassen kunnen niet uit deze bron worden gereconstrueerd; zie de beeldinventaris. Codex moet de relevante accounts en doelomgeving aansluiten en een echte repetitie uitvoeren.

De nieuwe overdrachtsdocumenten beschrijven de actuele bron. De oorspronkelijke `source/README.md` bevat daarnaast historische Vlampie-teksten en enkele achterhaalde aantallen. De code, tests en actuele statusmatrix zijn bij verschillen leidend.

## Integriteit

Voer vanuit de uitgepakte pakketmap uit:

```text
python3 tools/verify_package.py
```

Deze controle vergelijkt alle ingepakte bestanden met hun SHA-256. De controle bewijst bestandsintegriteit binnen deze momentopname, geen externe accounttoegang of geslaagde staginguitrol.
