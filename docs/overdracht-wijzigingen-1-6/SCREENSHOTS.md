# Screenshots, bronbeelden en voorbeelden

De screenshots horen bij de werkelijke componenten en de werkelijke studiocompositor van het meegeleverde project. Fictieve demo-/overdrachtsgegevens vullen de schermen; het zijn geen gegenereerde ontwerpplaatjes en geen bewijs van een echte providerkoppeling. Neem in het doelproject de layout, verhoudingen, kleurhiërarchie, bronbeelden en bedieningsplaatsen over.

De screenshotbestanden staan in de map `screenshots/` van het pakket. De pakketindex/`VERSIE.json` legt bronversie en inhoud vast; `SOURCE-INFO.json` bewaart de Sites-herkomst. De JPEG-bestanden zijn de native browseropnamen.

## Voorbeelden per wijziging

| Bestand | Wijziging | Wat vergelijken |
|---|---|---|
| [01-bingo-prioriteit.jpg](screenshots/01-bingo-prioriteit.jpg) | 1 | Meldvolgorde bepaalt de winnaar niet; juiste hoofdprijs en optionele troostprijs, geen onnodig beslisspel voor een latere bingo. |
| [02-troostprijs-instellingen.jpg](screenshots/02-troostprijs-instellingen.jpg) | 1 | Uitschakelbare troostprijs, duidelijke prijsnaam en positie in de showinstellingen. |
| [03-milo-studiorondje.jpg](screenshots/03-milo-studiorondje.jpg) | 2 | Lichaamsverhouding, desk-/vloerlaag, voetcontact, schaduw en camerakader; een stil beeld bewijst niet de volledige vloeiendheid. |
| [04-goochelatelier.jpg](screenshots/04-goochelatelier.jpg) | 3 | Eigen illustraties, keuze, duur en bereikbare previewbediening; geen uniforme lege placeholderkaarten. |
| [05-magie-onthulling.jpg](screenshots/05-magie-onthulling.jpg) | 3 | Prop, handanker en showeffecten in een echte onthullingsfase in het gekozen decor. |
| [06-gezin-bestellen.jpg](screenshots/06-gezin-bestellen.jpg) | 4 | Show/datum, aantal, kinderen, bedrag, status en eigen vervolgactie in één overzicht. |
| [07-organisatie-bestelling.jpg](screenshots/07-organisatie-bestelling.jpg) | 4 | Persoonlijke betaallink, controle vóór goedkeuren en aparte mailstatus. |
| [08-goedgekeurde-bladen.jpg](screenshots/08-goedgekeurde-bladen.jpg) | 4 | Vaste bladidentiteit, kleur/inktarm en koppelen aan eigen kind. |
| [09-regie-desktop.jpg](screenshots/09-regie-desktop.jpg) | 5 | Program/Preview kleiner, directe Milo- en transportbediening in viewport, modules met eigen scroll. |
| [10-familie-mobiel.jpg](screenshots/10-familie-mobiel.jpg) | 5 | Uitzending bovenaan, bord met 75 nummers/BINGO, chat en compact veld met emoji/verzenden. |
| [11-fluisteren-regie.jpg](screenshots/11-fluisteren-regie.jpg) | 6 | Apart van spreektekst; doel, aanwijzing, status en bereikbare bediening. |
| [12-fluisteren-voorstel.jpg](screenshots/12-fluisteren-voorstel.jpg) | 6 | Reactie eerst ter controle; expliciete knop **Laat reactie uitspreken**. |
| [13-fluisteren-simulatie.jpg](screenshots/13-fluisteren-simulatie.jpg) | 6 | Eerlijke status en herkenbare simulatie; ontvangen is niet hetzelfde als uitgevoerd. |

De getoonde personen, boekjes en bedragen zijn fictief. Neem geen zichtbare demonaam of prijs hardcoded over in een echte productie. Een ouderaccountnaam is geen automatische roepnaam voor Milo.

## Het rekenvoorbeeld voor wijziging 1

De lokale overdrachtsfixture gebruikt de echte bingo-rekenkern: **Sem meldt eerst**, maar **Noor was bij trekking 20 compleet** en Sem pas bij trekking 22. Het venster is bevroren bij trekking 23 en de terugkijkmarge is drie. Noor krijgt de hoofdprijs; Sem kan de ingeschakelde troostprijs **Milo’s Sterrenstickers** krijgen. Hun voltooimomenten zijn niet gelijk, dus er is geen beslisspel tussen deze twee.

Dit concrete screenshotvoorbeeld staat los van het algemene vierkaartenvoorbeeld in `WIJZIGINGEN-1-TM-6.md`; beide passen dezelfde serverregel toe.

De reproduceerbare bron is `scripts/handoff-fixture-state.mjs`. Controle zonder providerverkeer:

```sh
node scripts/handoff-fixtures.mjs --check
```

Voor nieuwe lokale opnamen kan de builder de echte app bundelen met alleen nagebootst transport:

```sh
node scripts/handoff-fixtures.mjs
npm run dev
```

Open lokaal `/handoff-qa.html?voorbeeld=result#/live`, `?voorbeeld=open#/live`, `?voorbeeld=published#/people` of `?voorbeeld=settings#/settings`. De toolbar vermeldt **ALLES GESIMULEERD**. Externe verzoeken, e-mail, AI en echte accountschrijfacties zijn daar uitgeschakeld. Verwijder de gegenereerde `public/handoff-qa.html`, `.js` en `.css` vóór een Site-publicatie. De builder is een lokaal screenshotgereedschap, geen openbare productfunctie.

Voor de gevulde familie-app is `/spelen?demo=1` de expliciete lokale oefenroute. Gebruik echte instellingen/routes alleen wanneer een echte koppeling bewust wordt getest.

## De originele beeldbestanden gebruiken

| Beeldgroep | Canonieke locatie |
|---|---|
| Milo & Friends-groepslogo | `public/assets/milo-friends/logo.png` |
| Printlogo’s en magische golven | `public/assets/milo-friends/logo-print*`, `print-waves.png` |
| Twaalf personages en praatvarianten | `public/assets/milo-friends/characters/` |
| Gekozen ruimtedecor en desk | `public/assets/milo-friends/studio/sterrenplein-grand-room.webp`, `sterrenplein-grand-desk.webp` |
| Studioreferentie | `public/assets/milo-friends/studio/sterrenplein-grand-preview.webp` |
| Camerakaders | `public/assets/milo-friends/studio/shots/` |
| Goochel-/showcuebeelden | `public/assets/milo-friends/studio/show-cues/` |
| Voorbeeld-PDF’s kleur en inktarm | `public/assets/milo-friends/example-color.pdf`, `example-mono.pdf` |
| Printtemplates en previews | `public/assets/milo-friends/template-color.pdf`, `template-mono.pdf`, `bingo-preview-color.jpg`, `bingo-preview-mono.jpg` |
| Behouden Vlampie-bronnen | Bestaande `public/assets/`-structuur plus `source-assets/`-rapporten en masterbeeld. |

De voorbeeld-PDF’s zijn ongeldige voorbeelden, geen werkelijke speelbewijzen. Geldige bladen ontstaan via de bestaande serveruitgifte met vaste eigen kaart-/blad-ID’s. Een kleur- en zwart-witexport mag niet opnieuw andere getallen loten.

Milo’s 28 lagen zijn codegestuurde uitsneden en overlap-/oog-/mondlagen van de goedgekeurde illustratie. Zoek daarvoor geen niet-bestaande map met 28 afzonderlijke nieuwe PNG’s. De actuele constructie staat in `public/milo-puppet.js`. Een code-/dataoverzicht van die constructie mag niet als screenshot van een niet-bestaande rigeditor worden gepresenteerd.

## Grenzen van de visuele referenties

Een screenshot toont één toestand en één viewport. Gebruik daarnaast de geteste browserafmetingen uit `TESTEN-EN-ACCEPTATIE.md` en speel animaties echt af. Controleer op een telefoon met toetsenbord, een korte laptophoogte en een brede desktop. Een optisch passend beeld zonder werkende statusovergang is niet de bedoeling.

Gebruik het huidige goedgekeurde decor, logo en de personages. Oude bijlagen met Vlampie in Milo’s familie-app of een te grote Milo waren afgewezen uitgangspunten; bouw die niet opnieuw na. Vlampie’s afzonderlijke productie blijft wel bestaan met zijn twee eigen studio’s.
