# Milo & Friends BingoShow — Codex-overdracht

> **Bij deze ZIP-export:** lees eerst `PAKKET-LEESMIJ.md` in de pakketroot. Het accountgebonden hostingmanifest is weggelaten. Kopieer voor uitsluitend een lokale build in `bron/` eerst `.openai/hosting.example.json` naar `.openai/hosting.json`. Dit generieke bestand is een niet-deploybare builddummy; richt productie volgens de doelrepo in. De pakketroot en `handoff/` bevatten de leidende documenten en geldige screenshotlinks.


Datum: 6 november 2026. Dit pakket draagt de complete bestaande Sites-bron en wijzigingen **1 tot en met 6** over. De broncode, meegeleverde beeldbestanden en echte screenshots vormen samen de referentie. Het is geen verzameling losse ontwerpideeën.

## Leesvolgorde

1. `CODEX-PROMPT.md` — de volledige opdracht om in Codex te plakken.
2. `WIJZIGINGEN-1-TM-6.md` — gedrag, grenzen en belangrijkste bronbestanden.
3. `SCREENSHOTS.md` — voorbeelden van de uitgewerkte interface en show.
4. `INSTALLATIE-EN-KOPPELINGEN.md` — build, opslag, identiteit en providerinstellingen.
5. `TESTEN-EN-ACCEPTATIE.md` — functionele en visuele oplevercriteria.

De exacte broncommit, pakketinhoud en checksums worden bij de definitieve verpakking vastgelegd in de release-/manifestbestanden van het pakket. Een screenshot is een visuele referentie van de vermelde toestand; het is geen bewijs van een echte providerverbinding.

## Wat is de huidige toepassing?

| Onderdeel | Huidige implementatie |
|---|---|
| Beheer en regie | React 19.3.1, eigen componenten en CSS, Motion 14.4.0 |
| Familie-app | React, vijf hoofdtabs en blijvend gemounte uitzending-/gesprekscontrollers |
| Bundling | esbuild, native ES-modules |
| Showbeeld | Canvas2D, gearticuleerde illustraties en een 2.5D-studiocompositie |
| Backend | Cloudflare Worker-module in `server/index.js` |
| Gegevens | D1/SQLite met revisiecontrole en bestaande JSON-documenten |
| Bestanden en beveiligde instellingen | R2-binding `SETTINGS` |
| Video voor kijkers | YouTube, ingesloten in de familie-app |
| Geselecteerde beller | LiveKit Cloud; maximaal één deelnemer tegelijk live |
| Presentator | Bestaande centrale OpenAI-sleutel, eigen opgeslagen instellingen per karakter |

**Dit prototype is niet al gebouwd met Next.js, shadcn/ui, Tailwind of Supabase.** Lit en Three.js staan nog in de afhankelijkheden voor behouden/klassieke onderdelen; de actieve hoofdomgeving is React. De oudere technische hoofdstukken in `README.md` beschrijven deels historische interfaces. De actuele bron, deze overdracht en `docs/wijziging-5-ui-audit.md` zijn leidend.

Als de doelrepo al Next.js/shadcn/Tailwind/Supabase gebruikt, moet Codex eerst die repo en zijn conventies bestuderen. Neem de uitgewerkte UI/UX en bronassets exact over en maak waar nodig passende serveradapters. Een database- of authmigratie is een apart, controleerbaar onderdeel; overschrijf geen bestaande accounts, shows, kaarten of uitslagen om het voorbeeld werkend te laten lijken.

## Direct bekijken

De bestaande Site: <https://vlampie-studio.dgwebserv.chatgpt.site>.

| Bestemming | Pad |
|---|---|
| Organisatie | `/` met `#/overview`, `#/shows`, `#/script`, `#/live`, `#/audience`, `#/studio`, `#/characters`, `#/library`, `#/books`, `#/orders`, `#/people`, `#/settings` |
| Personage-instellingen | `#/characters/milo` en de overige vaste karakter-ID’s |
| Uitzendvenster | `/uitzending` |
| Familie | `/spelen` |
| Gevulde familie-demo | `/spelen?demo=1` |

De Site is eigenaar-privé opgeleverd. De huidige doelgroep is niet automatisch geschikt voor externe gezinnen; openstelling moet een bewuste keuze van de eigenaar blijven. Een spelerslink verleent geen hostrechten.

## Beeldbestanden en voorbeelden

Behoud de meegeleverde `public/assets/`-structuur. Daar staan het originele Milo & Friends-groepslogo, twaalf karakterbeelden met praatvarianten, studio-achtergrond en desk, camerareferenties, showcues, spelassets en kleur-/zwart-wit-PDF-voorbeelden. De actuele Milo-pop snijdt bronpixels uit de goedgekeurde illustratie in code; 28 lagen betekent niet dat er 28 nieuw getekende losse PNG’s zijn.

Vlampie behoudt zijn eigen karakter en zijn **Showtime- en Sinterklaasstudio**. Maak Milo niet opnieuw even groot als in eerdere afgewezen uitvoeringen. Behoud de gekozen studiocompositie, verhoudingen, camerakaders en het nummersbord van vijf rijen bij vijftien.

## Wat is wel en niet bewezen?

De interface, modellen, beveiligingsgrenzen, deterministische showanimaties en gedocumenteerde foutgevallen hebben gerichte tests. De UI is op telefoon, tablet en desktop gecontroleerd. De demonstraties gebruiken fictieve gegevens en ongeldige voorbeeldboekjes.

Een geslaagde demo of mocktest bewijst **geen** echte betaling, bezorgde e-mail, OpenAI-stem, LiveKit-audio of YouTube/OBS-mix. Een echte repetitie met geconfigureerde accounts en twee apparaten blijft een afzonderlijke acceptatiestap. Regie-instructies en demostatussen mogen nergens als bewezen live uitvoering worden gepresenteerd.

## Ononderhandelbare behoudpunten

- De spelserver bepaalt nummers, kaartidentiteit, bingo’s en winnaars.
- De identiteit van bestaande kaarten, codes, QR-tokens, accounts en uitslagen blijft behouden.
- De publieke uitzending, privévoorbespreking en geselecteerde live beller houden afzonderlijke audiopaden.
- Een belmoment blokkeert trekken blijvend op de server tot bewuste hervatting; een UI-wissel heft dit nooit op.
- Eén centrale OpenAI-sleutel; LiveKit heeft zijn eigen drie projectgegevens.
- Eerst expliciete betaalcontrole, daarna eenmalige uitgifte; een betaalmelding van de ouder is geen betaalbewijs.
- De regiefluistering blijft een aparte private bedieningsroute, niet een chatbericht of een letterlijk voor te lezen tekst.
