# Functionele overdracht — wijzigingen 1 tot en met 6

De nummering is die van deze overdracht: de optionele troostprijs hoort bij wijziging 1; Milo’s uitgebreidere pop en studiorondje zijn wijziging 2. Alle wijzigingen sluiten aan op dezelfde bestaande toepassing.

## 1. Vroegste geldige bingo en optionele troostprijs

De server beoordeelt de **originele kaart** tegen de officiële trekkingsvolgorde. De voltooiing van het patroon bepaalt wie eerder bingo had; de klikvolgorde van de meldingen bepaalt dat niet. Een melding moet wel binnen hetzelfde nog open meldvenster en de ingestelde terugkijkmarge vallen. Een nieuwe melding sluit of verlengt het venster niet automatisch.

Voorbeeld met een terugkijkmarge van drie en het venster bevroren op trekking 31:

| Kaart | Patroon compleet bij trekking | Geldig binnen marge? | Afhandeling |
|---|---:|---|---|
| A | 28 | Ja | Doet mee aan de hoofdprijs. |
| B | 28 | Ja | Exact gelijk aan A; samen naar het beslisspel. |
| C | 30 | Ja | Geen deelname aan de hoofdprijs; eventueel een troostprijs. |
| D | 27 | Nee | Te laat voor dit venster; geen troostprijs. |

De troostprijs staat standaard uit. Regie kan hem inschakelen en een naam geven onder **Instellingen → Deze show**. Hij geldt alleen voor geldige latere voltooiingen. Een valse/te late bingo of verlies in het beslisspel levert geen troostprijs op. Per hoofdprijs maximaal één troostprijs per account/kind, ook met meerdere boekjes. Een kind dat met een boekje bij de vroegste deelnemers hoort, krijgt niet tevens een troostprijs voor een later boekje.

Toekenningen hebben eigen vaste award-ID’s en uitreikstatus. Herhaald afhandelen verandert hoofdwinnaar of toekenningen niet. Bekendgemaakte awards lopen door naar familieprijzen, showverslag/CSV en de juiste persoonlijke herinnering. Bestaande uitslagen worden niet achteraf herberekend.

**Bronnen:** `server/bingo-model.js`, `server/bingo.js`, `server/production-model.js`, `frontend/family-prizes.js`, de prijzen-/verslagbediening in `frontend/Administration.jsx` en `frontend/ShowElements.jsx`.

## 2. Milo’s levendige pop en studiorondje

Milo gebruikt negentien getextureerde bronstukken, 28 getekende lagen inclusief overlappingen/ogen/mond en 21 gewrichten. Knieën, onderbenen, enkels/voeten, bekken, borst, jaspanden en staartsegmenten kunnen apart bewegen. De bronpixels blijven herkenbaar; dit is geen nieuw vrij draaiend 3D-personage.

De loopbeweging combineert voetplant, afwisselende steun/hef, tegenrotatie en afstandsgestuurde fase. De route **Milo’s studiorondje** (`studio-tour`) duurt 64 seconden. Milo komt rechts van de desk, loopt over de speelvloer en keert links terug. Camera, schaal, grondschaduw en laag vóór/achter de desk gebruiken dezelfde klok. Herhaalde snapshots mogen de fase niet herstarten.

Pauze bevriest beweging en route. **Terug naar desk** gebruikt een korte zachte terugkeer en herstelt het oude shot. Noodstop/presentatorwissel behoudt zijn harde reset. Reduced-motion houdt Milo rustig bij de desk. De route verandert geen bingokaarten, getrokken nummers of winnaars en omzeilt geen actieve blokkades.

**Bediening:** Showelementen → Beweging & magie → Milo’s studiorondje; stille preview en tijdschuif; snelle knop in de regie; aan het draaiboek toe te voegen.

**Bronnen:** `public/milo-puppet.js` (uitsneden, laagvolgorde, gewrichten), `public/milo-motion.js`, `public/milo-studio-tour.js`, `public/mf-studio.js`, `server/show-cues.js`, `frontend/ShowCuePanel.jsx`, `frontend/show-cue-runtime.js`.

De goedgekeurde vooraanzichtillustratie levert geen authentiek zij- of achteraanzicht. Voor een volledig rondlopende 3D-camera om Milo heen zijn aanvullende bronbeelden of een echt model nodig. Vergroot of vervorm de illustratie niet om dat te verhullen.

## 3. Tien extra goocheltrucs

De twee bestaande cues blijven: `star-hat` (14 sec) en `silk-stars` (15 sec). De standaardpremière behoudt haar twee geplande magiemomenten.

| Extra cue | Titel | Duur |
|---|---|---:|
| `flower-hat` | De regenboogbloemenhoed | 20 sec |
| `linking-rings` | De onmogelijke sterrenringen | 22 sec |
| `floating-table` | Het zwevende tovertafeltje | 24 sec |
| `rainbow-cube` | De draaiende regenboogkubus | 20 sec |
| `cookie-mystery` | Het verdwenen gelukskoekje | 18 sec |
| `star-rabbit` | Het konijn van sterrenstof | 22 sec |
| `bubble-world` | De wereld in de reuzenbel | 24 sec |
| `reverse-hourglass` | De omgekeerde zandloper | 20 sec |
| `wand-multiplication` | Eén staf, drie verrassingen | 18 sec |
| `banana-surprise` | De banaan die niet besteld was | 18 sec |

Elke cue heeft een eigen prop, Milo-choreografie, korte introductiezin, geluidkeuze en vier aaneengesloten fases: klaarzetten, spanning, onthulling en afronding. De staf/lichteffecten beginnen bij de actuele handpositie. De illustraties in de bibliotheek zijn renders van de echte studiocompositor.

De centrale catalogus is `server/magic-cues.js`. De build kopieert hem naar `public/magic-cues.js`; los bewerken van de browserkopie veroorzaakt drift. Preview, handmatig live starten en draaiboek gebruiken dezelfde IDs en timing. Bestaande bewust opgeslagen eigen tekst of duur blijft behouden. Het wisselen naar een andere catalogustruc neemt de passende standaardduur over; eigen titel/tekst wordt niet blind overschreven.

De bibliotheek toont alle twaalf met zoeken/filteren; mobiel zijn selectie en preview bereikbaar zonder een wand met kleine kaarten. De snelle regie houdt twee favorieten en een link naar de volledige bediening. Een lege zoekselectie mag niet per ongeluk de vorige preview live starten.

**Bronnen:** `server/magic-cues.js`, `server/characters.js`, `server/plan-model.js`, `public/milo-magic-effects.js`, `public/milo-motion.js`, `public/mf-studio.js`, `frontend/show-runtime.js`, `frontend/show-cue-runtime.js`, `frontend/ShowCuePanel.jsx`.

## 4. Bestellen voor een show/datum

Bestellen staat standaard uit. Organisatie opent de verkoop voor een toekomstige conceptshow en stelt prijs/maximum/toelichting in. Een gezin kiest show, datum, aantal bladen en optioneel meteen eigen spelers. Een blad bevat de kaarten voor de rondes van die show.

| Status | Volgende handeling |
|---|---|
| `requested` | Organisatie ontvangt de aanvraag; nog geen uitgegeven bladen. |
| `payment_pending` | Organisatie koppelt HTTPS-betaallink en definitief bedrag; betaalmail wordt aangeboden; link staat ook in het account. |
| `payment_reported` | Ouder heeft **Ik heb betaald** gekozen; organisatie moet de echte ontvangst controleren. |
| `fulfilled` | Organisatie bevestigt betaalcontrole en keurt goed; bladen zijn eenmaal gegenereerd en eigendom van het gezin. |
| `cancelled` / `rejected` | Aanvraag is geannuleerd of met reden afgewezen; historie blijft bestaan. |

De organisatie mag na eigen controle ook rechtstreeks vanuit `payment_pending` goedkeuren. Een klik op de link, een terugkeerpagina of een oudermelding is nooit automatisch betaalbewijs. De toepassing maakt geen betaalopdracht en bevat hiervoor geen betaalwebhook.

Uitgifte is atomair en duurzaam eenmalig. Een retry, dubbelklik of gelijktijdige goedkeuring maakt geen tweede set. Orders en kaarten blijven in de bestaande spelopslag; er is voor deze route geen aparte reset of vervangende database nodig. Titel, datum, ronde-indeling en showmerk kunnen bij actieve bestellingen niet ongemerkt veranderen.

Kleur/inktarm en A5/A4 downloaden dezelfde opgeslagen kaart-ID’s en kaartnummers. Vrije goedgekeurde bladen kunnen vóór de show aan een eigen gezinslid worden gekoppeld; gekoppelde bladen zijn digitaal bruikbaar. Een ander account of een vreemd kind krijgt geen toegang. Starten van de show sluit nieuwe uitgifte/koppeling.

Betaalmail en gereedmail hebben afzonderlijke status. Provideracceptatie is niet hetzelfde als inboxbezorging. Een ontbrekende configuratie of verzendfout bewaart de bestelling; een veilige herhaalactie gebruikt de vastgelegde berichtversie. De organisatie kan een afgewezen/onzekere verzending herkennen en moet die niet als gelukt presenteren.

**Bediening:** Familie → Boekjes → Bingobladen bestellen / Mijn bestellingen; Organisatie → Bestellingen. Compacte uitklapbare gezinsrijen houden datum, status, aantal en bedrag zichtbaar en ontsluiten alle vervolgacties.

**Bronnen:** `server/bingo-order-model.js`, `server/bingo-orders.js`, `server/bingo-order-mail.js`, integratie in `server/bingo.js`; `frontend/FamilyOrders.jsx`, `frontend/OrderAdministration.jsx`; gedeelde expliciete demo in `frontend/order-demo-store.js`, `frontend/family-order-demo.js`, `frontend/order-admin-demo.js`.

## 5. Volledige UI/UX- en responsive-ronde

Eén compacte opbouw voor paginakoppen, tabbladen, formulieren, acties en vensters. Rijlijsten waar vergelijking belangrijk is: shows, personages, gezinnen, prijzen en bestellingen. Beeldkaarten blijven waar een beeld daadwerkelijk de keuze ondersteunt, zoals camerashots of trucs. Dubbele prominente acties zijn beperkt zonder de functie te verwijderen.

Desktopregie gebruikt een smalle navigatierail en kleinere 16:9-monitors. Milo’s tekst, spreken/stoppen, gebaren, magie, studiorondje, camera/TAKE, trekken, auto, pauze en stop blijven direct bereikbaar. Zeven werkpanelen ondersteunen één tot vier kolommen, ordenen, breedte aanpassen, interne scroll, losmaken en terugplaatsen. Dezelfde React-nodes en lokale formulier-/gespreksstaat blijven behouden. Een nieuw meldvenster of een klaarstaande serveruitslag krijgt voorrang bovenaan het Bingo-paneel.

Mobiel gebruikt één gekozen werkpaneel, compacte monitors en een vaste transportbalk. Tabletmonitoren zijn verkleind zodat bediening niet wordt bedekt. De hoofdknoppen hebben mobiele aanraakruimte; korte schermen krijgen een normale scrollindeling. De iframe-/YouTube-/callcontrollers van de familie-app blijven bij navigatie bestaan.

De familie-app behoudt vijf hoofdtabs. Desktop: links uitzending, daaronder ballenbord/BINGO; rechts chat. Mobiel: uitzending, bord/BINGO en chat onder elkaar. Bij zeer smalle schermen staat het volledige bord boven patroon/BINGO om de cijfers leesbaar te houden. Alle 75 eerder getrokken nummers blijven terug te vinden.

Gesloten mobiele navigatie is niet focusbaar. De drawer sluit met Escape en herstelt focus. De skiplink wijzigt de router niet. Modals hebben een vaste kop, zichtbare sluitknop en een eigen scrollgebied; op korte telefoons blijven velden en actie bereikbaar. De scope is uitgewerkt in `docs/wijziging-5-ui-audit.md`.

**Bronnen:** `frontend/workspace-system.css`, `frontend/App.jsx`, `frontend/components.jsx`, `frontend/RegieWorkspace.jsx`, `frontend/RegiePanels.jsx`, `frontend/regie-compact.css`, `frontend/regie-panels.css`; familie-afwerking in `frontend/family-refinement.css` en de overige modulegebonden stylesheets.

## 6. De regie fluistert naar de actieve presentator

Dit is een aparte bedieningsroute voor een korte regieaanwijzing. Het veld is nadrukkelijk gescheiden van **Tekst om uit te spreken**. De aanwijzing mag niet rechtstreeks in `voiceText`, uitzendcaptions, chat, publieke spelgegevens, de outputrelay of spelerprojecties terechtkomen. Alleen een eventuele presentatorreactie gebruikt het normale gesproken uitzendpad.

De instructie is gebonden aan de actuele show, productie en presentator. Bij een live beller hoort daar tevens de actuele gespreks-/gastcontext bij. Wisselen van presentator, show of beller maakt een oude wachtende instructie ongeldig; een volgend kind mag geen aanwijzing voor de vorige gast erven.

Buiten een live gesprek wordt een korte natuurlijke reactie voorbereid en eerst aan de regie getoond. **Versturen zendt die reactie niet automatisch uit.** Pas na de expliciete knop **Laat reactie uitspreken** gaat het gecontroleerde voorstel in de wachtrij. De runtime wacht op het echte einde van de huidige uitspraak en een veilig showmoment; hij onderbreekt geen actieve trekking, meldvenster, uitslag of lopend effect. De reactie loopt via de eigen bestaande stem van het gekozen personage. Een regieaanwijzing kan geen nummer trekken, bingo geldig verklaren of een onbevestigde prijs toekennen.

Tijdens een live gesprek gaat de aanwijzing via de bestaande presentatorsessie. Er wordt geen tweede AI-gesprek gestart en geen regiemicrofoon of backstageaudio toegevoegd. Het protocol moet de opname van de instructie expliciet bevestigen. Die bevestiging betekent **ontvangen**, niet dat de presentator aantoonbaar heeft gehoorzaamd of de bedoelde woorden al heeft uitgesproken.

De lokale oefenstand is stil en expliciet gesimuleerd; hij doet geen echte provider- of audioaanvraag. De runtime heeft afzonderlijke fasen voor voorbereiden, wachten, spreken, ontvangen, afgerond, geannuleerd, fout en onzeker. Fouten en onzekere verzendingen mogen niet als een geslaagde fluistering worden getoond. Annuleren/stoppen ruimt de wachtende actie op zonder een serverblokkade of meldvenster op te heffen.

**Runtimecontract:** alleen de regiesnapshot bevat `s.whisper` met fase, doel, statusmelding, wachtreden en bedieningsmogelijkheden. Dit object hoort nooit in `stage()` of een publieke snapshot. De normale serverroute is `POST /api/openai/director-whisper` met same-origin/organisatorcontrole en `X-Milo-Director: 1`. De live route is `POST /api/live-calls/whisper` met same-origin/hostcontrole en `X-Vlampie-Call: 1`. Het live bericht draagt show-, call-, karakter- en request-ID; de server leidt de bestaande provider-session-ID zelf af. Alleen de exact bij het verstuurde bericht behorende `session.instructions.appended`-bevestiging levert `accepted` op. Een onzekere verzending krijgt geen automatische herhaling.

**Bronnen:** `server/director-whisper.js`, integratie in `server/openai.js`, `server/live-director-whisper.js`, integratie in `server/live-calls.js`, `frontend/director-whisper-runtime.js` en de regiebediening. Raadpleeg de bron voor de complete DTO’s en grenzen; verander de headers niet zonder de client- en contracttests mee te wijzigen.

De instructieroute is geen absolute geheimhoudingsgrens in de betekenis van een veilig wachtwoordveld: de modelreactie kan door de inhoud worden beïnvloed. De backend blokkeert onbevestigde bingo-/prijsclaims. Naamgebruik en persoonlijke details zijn daarnaast afhankelijk van modelgedrag en de controle door de regie; claim geen absolute inhoudsgarantie. Bescherm het technische ruwe bericht, houd rol-/spelregels boven regievoorkeuren en presenteer ontvangst/uitvoering eerlijk.
