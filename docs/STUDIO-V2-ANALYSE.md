# Vlampie Studio V2 — analyse en redesign

Datum: 17 oktober 2026. Beoordeelde bron: 279f039b1e5f5c50341113acfbc9d0a6570214eb.

## Conclusie

Het concept heeft een bruikbare spelbasis. De grootste belemmering is de informatiearchitectuur: het dashboard is gegroeid rond losse functies en technische subsystemen, terwijl de host denkt in een complete show en de ouder in een gezin dat meespeelt. Rocco’s herkenbare theaterwereld verdient een rustige bediening eromheen.

De code-inspectie is geen beoordeling van actuele deelnemersgegevens of een fysieke uitzending. De bestaande live Site is niet in een browser geïnspecteerd tijdens deze wijziging.

## Bevindingen

| Onderdeel | Vastgesteld in broncode | Gevolg | Vertaling in V2 |
|---|---|---|---|
| Navigatie | Tien hoofdbestemmingen; regie is de standaardpagina | Voorbereiding heeft geen startpunt | Een eigen showwerkplek met overzicht, shows, boekjes, bibliotheek en aparte regieroute |
| Showmodel | Showvoorbereiding en spelplan zijn afzonderlijk opgeslagen; overnemen is een actie | Onduidelijk welk draaiboek de show daadwerkelijk gebruikt | Nieuwe editor leest en schrijft rechtstreeks het plan van de gekozen show |
| Live scherm | Programma, chat, preview, bord, claims, boekjes, bellen en host hebben geneste bediening | Veel keuzes tijdens een tijdkritieke handeling | Contextgerichte toegang, vereenvoudigde navigatie en consistente bediening; bestaande engine behouden |
| CSS | Beheerpagina laadt veertien stylesheets met overlappende selectors | Visuele conflicten en moeilijk voorspelbare responsive layouts | Nieuwe werkplek met één stylesheet, CSS-lagen, tokens en vaste componentpatronen; gerichte restyling van de bestaande regie |
| Spelersapp | Negen bestemmingen in het accountmenu | Show en boekjes zijn niet altijd direct herkenbaar | Vaste ondernavigatie Show / Boekjes / Gezin / Prijzen, extra functies in accountmenu |
| Spelbasis | Server heeft unieke kaarten, idempotente mutaties, control lease, claims, sancties en resultaten | Veel bestaande waarde; volledige herschrijving geeft extra risico | Hergebruik van Worker, D1/R2, API’s en spelmodel |

## Productkeuzes

1. Eén geselecteerde show vormt de context voor draaiboek, rondes, prijzen, boekjes en showcheck.
2. Voorbereiden gebeurt in het showdossier; uitzenden via `/regie`; meespelen via `/spelen`.
3. Rocco is de centrale beeldtaal in de oefenshow. Bestaande Vlampie- en Milo-shows behouden hun identiteit en bestanden.
4. De bediening heeft rustige groentinten, ivoor, goud en veel vaste uitlijning. De echte regie heeft een lichte bedieningsomgeving rond het donkere podium; de gezinsapp wordt licht en eenvoudig.
5. Lit 3 blijft het componentframework. De nieuwe werkplek is een Lit-component met een afzonderlijke modelmodule; bestaande spelerscomponenten en stream/chat blijven gemount tijdens navigatie.
6. Oefenen gebruikt lokale voorbeeldgegevens, expliciet gemarkeerd. Er worden vanuit oefenhandelingen geen echte spelmutaties verstuurd.

## Behouden spelafspraken

- Drie reguliere rondes en een finale als standaard voor nieuwe shows.
- Eén unieke 5×5-kaart per ronde, vrij middenvak; binnen een ronde blijven getrokken nummers behouden bij een volgend patroon.
- Reguliere volgorde: vier hoeken, bovenste én onderste rij, volle kaart. Finale: volle kaart.
- Achttekenscode per boekje, laatste vier tekens als lotnummer; boekjes zijn gekoppeld aan één show.
- Eén account kan meerdere spelers en boekjes beheren.
- Bevestigde melding opent een meldvenster van ten minste 30 seconden en blokkeert de trekking.
- Bestaande servercontrole bepaalt geldigheid, terugkijkmarge en gelijke bingo’s.
- Onjuiste bingo’s veroorzaken accountbrede afkoeling en eventueel blokkering voor die show; host kan deblokkeren.
- Bestaande drukbestanden zijn A5 volgens de actuele broncode en worden niet stilzwijgend teruggezet naar eerdere A4-ideeën.

## Wat werkt in V2

### Echte data

- Shows laden, selecteren en aanmaken met keuze van bestaande presentator.
- Draaiboek aanpassen; blokken toevoegen, bewerken en verplaatsen.
- Rondevolgorde bewaken wanneer boekjes al bestaan.
- Patronen en prijzen per doel aanpassen, prijzen toevoegen en hernoemen.
- Spelregels opslaan via de bestaande server; grenzen worden opnieuw gevalideerd.
- Unieke boekjes genereren en PDF-batches/losse boekjes downloaden via de bestaande API.
- Boekjes zoeken en filteren; gekoppelde spelers zien.
- Bestaande echte regie, stem-, OBS-, bel-, presentatie- en loginfuncties blijven bereikbaar.
- Echte spelersapp met OTP, onboarding, QR/codekoppeling, gezin, kaarten, bingo, chat en prijzen.

### Oefenen

- Rocco-show met 24 unieke voorbeeldboekjes en 16 gekoppelde boekjes.
- Start, trekking zonder dubbele getallen, pauze/hervatten, beeldscènes en camerastills.
- 75-ballenbord, actuele patroonweergave, kaarten afstrepen en wisselen tussen kinderen.
- Bingomelding met dezelfde modelcontrole, minimaal 30 seconden, geldige/onjuiste melding en accountafkoeling.
- Resultaat en volgend patroon; nummers blijven staan binnen dezelfde ronde.
- Eenvoudige lokale chat; gezinnen en oefenboekjes toevoegen.
- Apart 16:9-oefenscherm, gesynchroniseerd via opslaggebeurtenissen tussen tabs van dezelfde browser.

De oefenuitzending gebruikt bestaande stills. De echte geanimeerde show blijft in de bestaande regie-engine. De oefenapp is geen externe meergebruikersomgeving.

## Verificatie

Uitgevoerd:

- Projectbuild en Worker-import.
- `check-studio-v2.mjs`: navigatie, dossier-tabs, dialooginhoud, oefenisolatie, unieke trekking, geldige en onjuiste bingo, meldvenster, patroonovergang, afstrepen, speler toevoegen, echte API-opslag alleen na expliciete actie.
- `check-player-app.mjs --reactive`: OTP → onboarding → QR-koppeling; daadwerkelijke Lit-bindings en vaste navigatie; afstrepen; behoud van video/chat/belvenster; uitloggen.
- Bestaande tests voor bingoadministratie (14), planner-API (4), spelersauthenticatie (7), merkcontract en minigamedynamiek (5).
- De bingotests omvatten 100 gelijktijdige huishoudens met 400 testboekjes in de gesimuleerde testomgeving. Dit is geen hosted belastingtest.

De testcompatibiliteit voor linkedom modelleert de browserwerking van TreeWalker, template-markers en custom-element observedAttributes, zodat Lit-bindings daadwerkelijk worden getest.

Niet uitgevoerd: visuele browser-QA (het ondersteunde browserinstrument is niet beschikbaar), echte e-mailbezorging, providerstemmen, WebRTC/OBS-audio, gelijktijdige echte spelers of hosted belastbaarheid.

## Voor de eerste kinderbingo

Doe één volledige repetitie met twee externe ouderaccounts en de werkelijke uitzendopstelling. Controleer toegang tot de nu privé gepubliceerde Site, e-mailcodes, koppelen, verschillende patronen, een onjuiste melding, gelijktijdige geldige meldingen, herverbinden en prijsuitgifte. Rond de technische repetitie af voordat de Site voor externe spelers wordt opengesteld. Er zijn in deze wijziging geen toegangsrechten of providerinstellingen veranderd.

## Geïntegreerde recente verbeteringen

De nieuwere bronversie a314920 is samengevoegd: gegroepeerde regienavigatie, snelzoeken, uitgebreider showbeheer en spelersbeheer, en idempotente showcreatie zijn behouden. De nieuwe showwerkplek vormt de centrale ingang; geavanceerde productiefuncties blijven in de bestaande engine.

De reactieve spelersapptest vond na samenvoegen een dubbele eigenaar van de showtitel (Lit en de bestaande spelercontroller). De titel heeft nu uitsluitend de spelercontroller als eigenaar. De regressietest doorloopt een hostwissel, QR-koppeling, navigatie en uitloggen.
