# Studio 01 — Sterrenplein

De aangeleverde `Milo-Friends-10-Studio-Ontwerpen.pdf`, pagina 2, is de
ontwerpreferentie. Het oorspronkelijke beeld staat ook in
`public/assets/milo-friends/studio/sterrenplein.jpg`.

De uitgewerkte studio behoudt de paarse/gouden sterrenboog, planetenkoepel,
turquoise accenten, ronde glanzende vloer, linker nummerklok en de diepe
verlichte gastenpoort rechts. De desk is breder om het echte 5 × 15-bord te
kunnen opnemen. De presentator staat onder de woordnaam, met zichtbaar torso.

## Decor en beeldgeneratie

De ingebouwde beeldgenerator is gebruikt voor de volgende nieuwe assets:

- `public/assets/milo-friends/studio/sterrenplein-grand-room.webp`: de
  geselecteerde architectuur, zonder desk en zonder ingebakken spelnummers.
- `public/assets/milo-friends/studio/sterrenplein-grand-desk.webp`: de
  bijpassende losse desk, met transparantie en een leeg displayvlak.
- `public/assets/milo-friends/studio/sterrenplein-magic-props.webp`: een
  geborduurde fluwelen hoed en iriserende zijden sterrenvlinder als losse props.

Gebruikte promptreeks: behoud exact Studio 01 en vergroot de ruimtelijkheid;
werk paars email, satijngoud, gepolijst metaal, warme verlichting en reflecties
uit als een rijke 3D-render; geef de desk een leeg breed display; zet de
woordnaam hoger voor een vrije presentatorpositie; maak vervolgens een lege
ruimtelaag en een transparante desklaag; vervang decoratieve cijferballen door
sterren/confetti; maak ten slotte twee transparante, qua materiaal passende
goochelprops. Geen personages of fictieve spelnummers in het decorbeeld.

De oorspronkelijke gegenereerde resoluties zijn 1672 × 941 voor de ruimte en
desk, en 1774 × 887 voor de props. De speluitvoer componeert naar 1920 × 1080;
dit is geen native 4K-assetset.

## Uitvoering

`mf-broadcast-set.js` tekent afzonderlijk ruimte, actuele nummerklok en desk.
`mf-studio.js` plaatst de bewegende/talkende karakterrigs tussen de lagen en
de goochelact vóór de desk. Het display komt uitsluitend uit de officiële
getrokken nummers; decor of animatie kiezen nooit een nummer of winnaar.

Dit is een **2.5D-compositie**, geen vrij navigeerbare 3D-scene. De
camerabewegingen gebruiken zorgvuldig gekaderde uitsneden, zachte overgangen
en een kleine relatieve verschuiving tussen ruimte en desk. Alle shotgrenzen
blijven binnen het decor. Pauze en verminderde beweging worden gerespecteerd.

De elf cameraminiaturen in `public/assets/milo-friends/studio/shots/` en
`sterrenplein-grand-preview.webp` zijn gerenderd met dezelfde studio-engine
en echte karakterassets. De nummers daarin zijn demonstratiewaarden.

De studio meldt pas `ready` nadat zowel ruimte als desk geladen zijn. Een
laadfout blijft zichtbaar en wordt niet als geslaagde studio gerepresenteerd.

## Controle

- Integratietests voor PREVIEW/TAKE, pauze, volledige nummerhistorie,
  camerakaders, ondertitels en assetfouten.
- Native Canvas-renders van alle elf shots, sprekende Milo, duo,
  voltooide gastopkomst en beide goochelmomenten visueel nagekeken.
- Regie, Plingo, trekkingblokkade, audio-outputcontract en merkisolatie getest.
- Geen volledige browser-QA: de ondersteunde browservoorziening was in deze
  werkomgeving niet beschikbaar. De renders zijn engine-uitvoer, geen
  browser-screenshots of bewijs van een live providerverbinding.
