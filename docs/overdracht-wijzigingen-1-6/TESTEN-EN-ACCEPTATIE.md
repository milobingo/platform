# Testen en acceptatie

Gebruik dit document als controlelijst in de **doelrepo**, ook als de schermen visueel al overeenkomen. De bron bevat model-/API-tests, DOM-tests en renderchecks. Tests met fictieve fetchers, SQLite-fixtures of een lokale demo zijn geen echte providerrepetitie.

Het definitieve pakket vermeldt bronversie en testuitvoer apart. De commando’s hieronder zijn reproduceerbare controles die in de bron aanwezig zijn; een opsomming hier betekent niet dat een toekomstige wijziging ze al opnieuw heeft doorlopen.

## Voorbereiding

```sh
npm ci
npm run build
```

Gebruik Node 24 zoals beschreven in `INSTALLATIE-EN-KOPPELINGEN.md`. De tests gebruiken fictieve gegevens, `.test`-adressen en dummykeys. Koppel er geen productiedatabase of echte klantmailbox aan om een fixture alsnog te laten slagen.

Canvas-renderchecks gebruiken optioneel `@napi-rs/canvas`. In de beheerde ontwikkelomgeving staat dat buiten de projectdependencies. Voor een zelfstandige testmachine kan het tijdelijk lokaal worden geïnstalleerd zonder het productielockbestand te veranderen:

```sh
npm install --no-save --package-lock=false @napi-rs/canvas
CODEX_PRIMARY_RUNTIME_NODE_MODULES="$(pwd)/node_modules" node scripts/check-milo-magic-render.mjs
```

`CODEX_PRIMARY_RUNTIME_NODE_MODULES` is hier een test-/toolpad, geen providersleutel of frontendinstelling. De absolute `/opt/codex/...`-fallback in de renderharness is een pad van de oorspronkelijke ontwikkelomgeving, **geen VPS-pad**. De kerninstallatie en build gebruiken de npm-dependencies; optionele visuele Canvas-/PDF-controles kunnen daarnaast `@napi-rs/canvas`, fonts en Poppler (`pdftoppm`) nodig hebben. Installeer die als testtools of pas alleen de QA-configuratie expliciet aan. Renderuitvoer hoort niet in publieke klantopslag. Na een controle blijft `package-lock.json` ongewijzigd.

## Wijziging 1 — bingo en troostprijs

```sh
node scripts/check-bingo.mjs
node scripts/check-family-consolation.mjs
node scripts/check-production.mjs
```

Acceptatie:

- Dien tijdens hetzelfde open venster een geldige eerdere voltooiing later in. De server rangschikt op voltooiingsmoment van de originele kaart, niet op meldtijd.
- Alleen exact gelijke vroegste voltooiingen gaan naar het beslisspel. Een geldige latere voltooiing gaat daar niet tussen staan.
- Test de terugkijkgrens precies op en één trekking buiten de marge. Een nieuwe claim sluit of verlengt het lopende venster niet vanzelf.
- Troostprijs standaard uit; bij inschakelen alleen geldige latere bingo’s. Geen toekenning voor vals, te laat of verlies bij een gelijk beslisspel; geen dubbele prijs voor hetzelfde kind met meerdere boekjes.
- Herhaald afhandelen bewaart dezelfde award-ID’s. Familieprijzen, CSV/verslag, herinnering en uitreikstatus tonen dezelfde toekenning, alleen voor de juiste eigenaar.
- Controleer dat een belmoment, magie of fluistering nooit een geopend meldvenster vervroegd afsluit of de officiële trekking manipuleert.

## Wijziging 2 — Milo’s lagen en lopen

```sh
node scripts/check-milo-motion.mjs
node scripts/check-milo-life.mjs
node scripts/check-milo-studio-tour.mjs
node scripts/check-milo-puppet-render.mjs
node scripts/check-milo-leg-render.mjs
```

Acceptatie:

- Bekijk het werkelijke canvas op het studiobeeld, niet alleen de aantallen in een bronbestand. Controleer voeten, knie/enkellijn, handen, schouders, jaspanden, staart, ogen en mond op zichtbare gaten of harde randen.
- Doorloop de volledige 64 seconden. Milo loopt rechts langs de desk naar de vloer en links terug; laagvolgorde, schaduw, diepte/schaal en camerabeweging kloppen samen.
- Pauze bevriest lichaam én route. Hervatten veroorzaakt geen sprong. Een herhaalde snapshot herstart de loopcyclus niet.
- **Terug naar desk** herstelt het eerdere shot; stop/presentatorwissel ruimt de route op. Reduced-motion houdt een rustige deskweergave.
- Praten, gebaren, magie, tour en aandacht delen de bestaande tijdsbasis. Geen spelmutatie of vrijgave van een trekkingsblokkade door een beweging.

Een stil screenshot bewijst geen vloeiende animatie. Inspecteer ook de echte uitvoering of een opgenomen voorbeeld. Dit blijft een 2.5D-illustratiepop, geen model met vrij beschikbare zij-/achteraanzichten.

## Wijziging 3 — twaalf trucs in dezelfde show

```sh
node scripts/check-magic-catalog.mjs
node scripts/check-milo-magic-render.mjs
node scripts/check-show-cues.mjs
node scripts/check-show-cue-ui.mjs
node scripts/check-cast-runner.mjs
```

Acceptatie:

- De bibliotheek bevat de twee bestaande en tien toegevoegde cues met eigen props, titels, introductie en duur. Gebruik de exacte IDs uit `server/magic-cues.js`.
- Preview is stil. Play/pauze, tijdschuif, reset, live starten en draaiboek starten dezelfde choreografie op dezelfde fase.
- Inspecteer klaarzetten, spanning, onthulling en afronding voor alle twaalf. Handankers, beweging van props en nazak van effecten lopen vloeiend zonder flikkeren.
- Een nieuwe cataloguskeuze gebruikt zijn eigen standaardduur; bewust bewaarde eigen tekst/timing wordt niet onbedoeld gewist.
- Een lege zoekresultaatselectie start niet de vorige truc. Snelle regiefavorieten blijven bereikbaar; alle twaalf blijven via de bibliotheek bereikbaar.
- Live starten vereist de expliciete bedieningsactie. Pauze, stop, caller-/drawhold en on-air spraak hebben hun bestaande prioriteit; een truc trekt geen nummer.

## Wijziging 4 — aanvragen, betaling, kaarten en mail

```sh
node scripts/check-bingo-orders.mjs
node scripts/check-order-demo.mjs
node scripts/check-family-demo.mjs
node scripts/check-family-extras.mjs
node scripts/check-milo-print.mjs
```

Acceptatie met twee verschillende gezinsaccounts en één organisatieaccount:

1. Open verkoop voor een toekomstige conceptshow. Vraag boekjes aan met een aantal en eventueel eigen kinderen. Manipulatie van clientbedrag, show of kind levert geen onrechtmatige bestelling op.
2. Organisatie ziet de aanvraag en koppelt een HTTPS-betaallink en gecontroleerd bedrag. De betaalmail en de link in het gezinsaccount gebruiken diezelfde versie.
3. **Ik heb betaald** verandert de status, genereert geen kaarten en geldt niet als betalingsbevestiging.
4. Organisatie controleert ontvangst buiten de app en keurt expliciet goed. Test dubbelklik, gelijktijdige goedkeuring en een retry na een time-out: precies één blijvende set bladen.
5. Download kleur en inktarm, A5 en A4. Kaart-ID’s/nummers zijn gelijk; alleen opmaak verschilt. Render de PDF met een PDF-viewer of Poppler en inspecteer logo, magische gradientgolven, leesbare lichte getalvakken, snijlijnen en afdrukcontrast.
6. Koppel een vrij uitgegeven blad aan een eigen kind. Een ander gezin, een vreemd kind of een show die al gestart is kan die eigendom/koppeling niet overnemen.
7. Annuleer/weiger een aanvraag met reden; bewaar historie. Actieve orders voorkomen een stille wijziging van showmerk, datum, titel of rondes.
8. Simuleer ontbrekende mailconfiguratie, providerfout, antwoord zonder provider-ID, onzekere verzending, crashlease en parallelle retry. Bewaar de order en eerlijke verzendstatus; geen onbedoelde dubbele mail of nieuwe kaarten.

De tests gebruiken mailstubs. Voer een echte betaal-/gereedmailrepetitie pas uit met de expliciet gekozen testontvanger en eigen provider. Een provider-ID bewijst acceptatie, niet dat de mail in de inbox is gelezen. Controleer de externe betaling handmatig; er is geen betaalwebhook geïmplementeerd.

## Wijziging 5 — alle pagina’s en regie

```sh
node scripts/check-workspace-navigation.mjs
node scripts/check-broadcast-shell.mjs
node scripts/check-regie-panels.mjs
node scripts/check-regie-workspace.mjs
node scripts/check-administration-ui.mjs
node scripts/check-character-navigation.mjs
node scripts/check-family-brand.mjs
```

De eerdere bronversie heeft een vastgelegde browserronde in `docs/wijziging-5-ui-audit.md`: 52 beheerweergaven, 20 familieweergaven en aanvullende ondertab-/bibliotheek-/modulecontroles. Na integratie in een andere shell moet die visuele controle opnieuw worden uitgevoerd. Een DOM-test meet geen echte CSS-geometrie, canvasafwerking of mobiele toetsenborden.

| Viewport | Minimaal visueel controleren |
|---|---|
| 320 × 768 en 390 × 844 | Alle vijf familietabs, navigatie, uitzending, 75 nummers, BINGO, chatveld/emoji/verzenden, gezinrijen en bestelroute. Geen horizontale pagina-overloop. |
| 320 × 568 | Modals en aanmelding: vaste sluitknop, eigen scroll, velden/actie bereikbaar; korte regie mag normaal scrollen. |
| 768 × 1024 en 1024 × 768 | Tablet, touchdoelen, kleine studiomonitors, geen overlap tussen tour en transport. |
| 1280 × 720 en 1366 × 768 | Desktopregie: hoofdknoppen in viewport, kleinere monitors, intern scrollbare modules; familiedesktop met chat rechts. |
| 1920 × 900 | Ruimte wordt logisch benut; geen onnodig enorme lege panelen of studio/personages. |

Loop alle twaalf beheerroutes, 33 ondertabbladen, twaalf karakterdetailpagina’s en zeven regiemodules langs. Controleer echte knoppen en gegevensstromen; verwijder geen functie om de layout passend te maken. Drag, resize, losmaken/terugplaatsen en tabwissel behouden formulier-, preview-, speler- en callstate. Gesloten mobiele navigatie is niet focusbaar; Escape herstelt focus; skiplink verandert de route niet.

Test bediening met toetsenbord, zoom 200%, lange Nederlandse labels, lege/volle lijsten en een geopend mobiel toetsenbord. Video/YouTube/callcontrollers mogen niet door tabnavigatie opnieuw verbinden. Een nieuw bingo-meldvenster of serverresultaat moet zichtbaar worden zonder dat de regie ver naar beneden moet zoeken.

## Wijziging 6 — privé fluisteren en gecontroleerde reactie

```sh
node scripts/check-director-whisper-server.mjs
node scripts/check-director-whisper-runtime.mjs
node scripts/check-live-director-whisper.mjs
node scripts/check-openai.mjs
node scripts/check-live-calls.mjs
```

Normale showroute:

1. Kies de huidige show/presentator. Verstuur een korte aanwijzing in het aparte fluisterveld. Een voorstel verschijnt alleen bij de regie; er klinkt niets automatisch.
2. Controleer naam, inhoud en bevestigde spelfeiten. Alleen **Laat reactie uitspreken** zet de reactie in de wachtrij. Annuleren vóór die keuze produceert geen audio.
3. Dien de reactie in terwijl Milo spreekt, een trekking bezig is, een venster/resultaat actief is of een handmatig effect loopt. De runtime wacht, kapt geen zin af en heft geen serverblokkade op. Daarna gebruikt hij de eigen stem van de actuele presentator.
4. Wissel show, karakter of beller vóór afronding. Oude voorbereiding/queue wordt ongeldig; geen hint, naam of voorstel lekt naar de volgende gast.
5. Test dubbel versturen/replay met hetzelfde request-ID, contextconflict, afwijzing, 429, netwerkfout, annuleren en stop/dispose. Geen stille providerretry die een dubbele reactie maakt.

Live route:

- Alleen de bevoegde regie met de juiste actieve call/presentator kan een hint aanbieden. De server kiest de bestaande sessie; een client kan geen willekeurige provider-session-ID meesturen.
- Alleen een exact overeenkomend `session.instructions.appended`-ACK ná de eigen send levert **Ontvangen** op. Een ander bericht, verkeerde ID, timeout of gesloten verbinding is geen succes.
- **Ontvangen** is geen bewijs dat de instructie is uitgevoerd of uitgesproken. Herhaalde/onzekere requests worden niet ongemerkt opnieuw verstuurd.
- De sidebandverbinding sluiten beëindigt de primaire liveverbinding niet. Geen tweede AI-sessie, nieuwe publieksaudio, transcriptopslag of doorgifte van backstageaudio.

Privacy en inhoud:

- Gebruik een herkenbare fictieve testzin en zoek die in publieke stage-/spelersnapshots, outputrelay, chat en captions. Het ruwe bericht hoort daar niet in thuis; `s.whisper` bestaat alleen in de regiesnapshot.
- Test organisatie-/same-origin-/eigendomscontroles vóór providerverbruik. Backendcontrole weigert onbevestigde bingo-/prijsclaims. Een fluistering mag nooit spelserverfuncties uitvoeren.
- De normale reactie blijft een door de regie te beoordelen modelvoorstel. Technische scheiding van het ruwe bericht is geen absolute garantie dat een model nooit inhoud parafraseert of een naam verkeerd gebruikt.
- Demo toont expliciet **Gesimuleerd**, blijft lokaal/stil en kan geen echte AI- of gespreksbevestiging opleveren.

## Volledige bellerrepetitie — echte apparaten nodig

```sh
node scripts/check-livekit.mjs
node scripts/check-livekit-media.mjs
node scripts/check-call-draw-hold.mjs
node scripts/check-live-call-audio.mjs
node scripts/check-live-call-runtime.mjs
node scripts/check-live-call-output.mjs
node scripts/check-player-live-call.mjs
node scripts/check-youtube-player.mjs
```

Deze contractchecks zijn nuttig maar hebben providers/media deels nagebootst. Doorloop daarna werkelijk: beschikbaar melden → microfoon/preflight → juiste kind selecteren → belmoment voorbereiden → laatste nummer gehoord/bevestigd → bellen → opnemen → privé voorgesprek → controlekaart/roepnaam corrigeren → expliciet live → Milo + kind in de uitzending → fluistering ontvangen → beëindigen → YouTube herstellen/terugkeer bevestigen → bewust trekking hervatten.

Probeer ook weigeren, geen antwoord, ontbrekende toestemming, annuleren, refresh en netwerkverlies vóór en tijdens live. Controleer met een onafhankelijk uitzendluisterpunt dat backstage niet hoorbaar of door AI verwerkt wordt. Controleer dat het kind geen eigen vertraagde stem hoort, gewone kijkers geen LiveKit gebruiken en de trekking op alle drie paden (auto, handmatig, AI) geblokkeerd blijft totdat de regie veilig hervat.

Een echte repetitie is pas geslaagd als beeld, audio, identiteit, vertraging, privacy en terugkeer samen zijn gecontroleerd. Noteer apparaat/browser, providers, datum en resultaat; label niet geteste onderdelen expliciet.
