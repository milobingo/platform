# Bouwopdracht · spel, privacy, live regie en familieapp

**Basis:** Sites-versie 70, commit `f81d0c1c60cbe1422d43ce46d896af6cd4d2939c`. De taken hieronder zijn werkvoorraad. In de overdracht zijn deze correcties nog niet gebouwd. Bronverwijzingen wijzen naar versie 70; zoek na porteren op gedrag en symbool, niet alleen op regelnummers.

## Volgorde en grenzen

| Fase | Wat moet eerst | Voorwaarde voor vrijgave |
|---|---|---|
| A · P0 | Isoleer claimgegevens. Maak prijsstappen definitief. Valideer patronen na normalisatie. Bind de melding aan de oorspronkelijke spelcontext. Maak bel- en trekstatus ondeelbaar. | Geen echte gezinnen of prijzen zolang een toepasselijke P0 openstaat. Bellen kan afzonderlijk uit blijven. |
| B · P1 | Borg herstel, uitslagpublicatie, vaste regels, mobiele BINGO, capaciteit, regie en audio. Rond bestellingen en mail af volgens het aparte werkdocument. | De betreffende functie pas live na de eigen technische test én de praktische repetitie. |
| C · P2 | Lichtgewicht livefeed, QR-herstel, toegang en showbeleving. | Houd kernspel, autorisaties en merkscheiding intact. |

Reproduceer iedere fout eerst op deze basis met fictieve spelers. Leg de juiste uitkomst vast in een regressietest voordat je de fix afrondt. Respecteer bestaande gegevens en schema: geen oude resultaten, uitgiften of lotingen herschrijven om een test groen te maken. Doe geen echte campagne, betaling, publicatie of oproep vanuit een test.

## Vast spelcontract voor bouw en tests

- **75 ballen:** B 1–15, I 16–30, N 31–45, G 46–60, O 61–75. Een speelkaart is 5×5 met een vrij middenvak. De actuele rondekaart van een gekoppeld, toegelaten en niet ingetrokken boekje is leidend. Digitale vinkjes en papieren strepen veranderen de validatie niet. De server trekt zonder dubbels; een preview telt pas na bevestiging. Een nieuwe ronde krijgt een nieuwe reeks, een volgende prijsstap binnen dezelfde ronde behoudt de reeds bevestigde ballen.
- **Meldvenster:** de eerste bevestigde melding bevriest de serverstand. Standaard 30 seconden en drie trekkingen terugkijkmarge; beide zijn showinstellingen. Binnen hetzelfde venster kunnen andere gezinnen en andere geldige boekjes melden. Geen nieuwe bal zolang het venster loopt. Gebruik de server-eindtijd; exact op die tijd is het venster gesloten. Bevestigen zonder boekje en een ingediende ongeldige kaart blijven verschillende gebeurtenissen.
- **Voorrang:** de vroegste geldige voltooiingsindex wint. Bij bevriezing op 31 is 28 inbegrepen en 27 uitgesloten. Voltooiing bij 28 gaat vóór 29, ook wanneer 29 als eerste meldde. Bij een nieuw doel kan het patroon al compleet zijn; boekjes krijgen dan als vroegste index het moment waarop dit doel opengaat. Een kaart kan verschillende prijsstappen winnen als het reglement dit toestaat.
- **Gelijkstand:** de server bepaalt éénmaal een winnaar onder boekjes die op dezelfde vroegste geldige index compleet zijn. Het minigame toont de opgeslagen winnaar, ook na refresh of twee regietabs. Verander niet stilzwijgend van loting per boekje naar loting per kind. Maak de geldende regel expliciet; wijzig haar alleen na productbesluit, vóór publicatie.
- **Troostprijs:** optioneel, alleen voor een latere geldige voltooiing; maximaal één per kind per uitslag. Vroegste finalisten vallen erbuiten, ook als zij de loting verliezen. Een te late of ongeldige bingo krijgt geen troostprijs. Een eventuele extra lotnummerprijs is apart; in v70 één kans per toegelaten, gekoppeld, niet ingetrokken boekje van een niet-geblokkeerd account.
- **Sancties:** inhoudelijk valse bingo telt standaard 60 seconden afkoeling, blokkade van het hele gezinsaccount voor die show na drie valse meldingen; regie kan deblokkeren. Standaard 120 seconden wachten na drie bevestigde vensters zonder ingediend boekje is een aparte regel. Een te late volledige kaart, achterhaalde spelcontext, herhaald identiek verzoek of afgewezen autorisatie mag geen nieuwe valse-bingosanctie opleveren.

## P0 · kernspel en privacy

### S01 · Gesloten of afgewezen venster blokkeert nieuwe bingo

**Bron:** `frontend/FamilyApp.jsx:92,111,178`. BINGO is zichtbaar maar bevestigen blijft uitgeschakeld na een leeg of afgewezen venster. Een ander boekje binnen hetzelfde gezin kan ook geblokkeerd raken.

**Bouw:** bepaal knopstatus uit actuele show, ronde, doel, open venster, bevoegd boekje en geldende sanctie. Sorteer historiek apart van acties. Wis geen echte afkoeling of al geregistreerde claims. Wanneer geen venster meer open is, kan de volgende geschikte bevestiging een nieuw venster openen.

**Acceptatie:** doorloop een leeg venster én een afgewezen venster, laat regie verder trekken, meld daarna met boekje B uit hetzelfde gezin. Het oude venster blijft historiek; na eventuele afkoeling werkt bevestigen meteen, opent exact één nieuw venster en wordt de geldige claim opgeslagen. Herhaal met twee gezinnen die tegelijk bevestigen en na refresh. Een echt open venster blijft gedeeld; een actieve sanctie blijft van kracht.

### S02 · Eén definitieve prijsstap, zonder stil resetten van rondes

**Bron:** `server/bingo.js:97,113`, `server/bingo-model.js:85–96`, `frontend/show-runtime.js:91`. Na stap 1 → stap 2 → terug naar stap 1 kan een tweede uitslag ontstaan. Teruggaan kan trekvolgorde resetten.

**Bouw:** vergrendel definitieve uitslag en loting op duurzame show/ronde/prijsstap-identiteit. Valideer toestand en bevoegdheid in één servertransactie of conditionele revisiewijziging. Rondes en stappen uit het verleden zijn alleen terug te kijken. Eventuele correctie verloopt via apart, bevoegd en traceerbaar proces; nooit stil openen of opnieuw loten. Maak serverafsluiting afhankelijk van het afhandelen van open vensters én al bevestigde maar nog niet gepubliceerde uitslagen.

**Acceptatie:** voltooi stap 1, ga naar stap 2, probeer stap 1 te heropenen via UI én directe route. Geen extra winnaar, nieuwe loting, reeksreset of herhaalde prijsactie; historiek blijft beschikbaar. Twee gelijktijdige bevestigingen van dezelfde prijs geven maximaal één duurzame uitslag. Afsluiten via een tweede regietab met open venster of ongepubliceerde winnaar wordt geweigerd zonder gegevenswijziging; na publicatie volgt correcte afsluiting. Nieuwe ronde werkt nog normaal.

### S03 · Valideer de effectieve vakken

**Bron:** `server/bingo-model.js:56–59,79–83`, `server/bingo.js:71`. Een uitsluitend middenvak passeert met `freeCenter:false`; later maakt de server het vak vrij.

**Bouw:** normaliseer het patroon inclusief daadwerkelijk toegepaste middenvakregel, controleer bereik en betekenis, weiger iedere geldige patroonvariant die nul echte getallen vereist. Controleer op opslaan, publiceren en starten zodat oude opgeslagen configuraties ook veilig zijn.

**Acceptatie:** alleen middenvak faalt met beide waarden van `freeCenter` en met een geïmporteerde ongeldige configuratie; zonder getrokken bal is geen winst mogelijk. Een geldig patroon inclusief vrij middenvak wint exact bij het laatste vereiste echte getal. Geef regie een precieze foutmelding en laat het concept herstellen zonder een show te starten.

### S04 · Verouderde bevestiging doet niets in een nieuwe prijsstap

**Bron:** `frontend/FamilyApp.jsx:89,103–107,178`. Polling kan het doel in een geopende dialoog vervangen.

**Bouw:** bevries de servercontext van het bevestigingsscherm: show-ID, ronde, doel, patroonversie en epoch/venstercontext. De server controleert die context vóór claimvalidatie of sanctie. Modelleer ook de situatie waarin de dialoog opent voordat het eerste venster bestaat: twee gezinnen met dezelfde doelcontext kunnen meedoen aan het gezamenlijk geopende venster zonder dat de latere klik onterecht wordt geweigerd. Bij verlopen context toont de app de nieuwe situatie en laat opnieuw kiezen.

**Acceptatie:** open dialoog voor A, laat regie door naar B, bevestig de oude dialoog ook via een nagebootst direct verzoek. Geen nieuwe claim, geen verhoging van de vals-teller, geen nieuwe deadline. Herhaal bij gesloten venster en een volgende ronde. Tegelijk indienen op hetzelfde actuele doel werkt; een exacte retry levert dezelfde veilige uitkomst, geen dubbele verwerking.

### S05 · Sluit uitlekken bij retry en beperk gegevens per rol

**Bron:** `server/bingo.js:90`, `server/bingo-store.js:21`; bredere leesroutes `server/bingo.js:56,64` en `server/bingo-store.js:9–12`.

**Bouw:** valideer autorisatie op show en boekje vóór lookup/return. Scope de idempotentiesleutel op geauthenticeerd gezin, actie en spelcontext, en bewaar een genormaliseerde invoerbinding plus veilig antwoord. Zelfde sleutel met afwijkende invoer levert een generiek conflict of afwijzing op zonder informatie over andere gezinnen. Borg de binding ook bij gelijktijdigheid; een globale cache op request-ID is onvoldoende. Gebruik afzonderlijke uitleesmodellen: eigen gezinsdata, taakgebonden regievelden, publieke resultaten met alleen toegestane alias en noodzakelijke uitslag. Geen ruwe geboortedatum, profiel-ID, gezins-ID of boek-ID via publieke feed, fouten of clientlogs; redigeer gevoelige payloads in logging.

**Acceptatie:** gezin A claimt rechtmatig en herhaalt zijn request-ID met het boek-ID van gezin B. Controleer status én volledige responsebody: geen claim of gegevens van B. Test dezelfde ID vanuit B, ander doel, andere show en andere merkwereld; test directe uitslagroutes en geldige retry met identieke invoer. Inspecteer publiek en regie apart, ook na refresh en via oudste compatibele endpoint. Eigen ouder ziet uitsluitend de daarvoor bedoelde boekjes en profielen.

## P0/P1 · belregie en uitzending

### L01 · Werkelijke trekblokkade voordat een belactie doorgaat · P0

**Bron:** `server/live-calls.js:77–85,121–125`, `server/bingo.js:98–99`. Tussen twee writes kon belstatus actief zijn terwijl de server nog een bal bevestigde.

**Bouw:** maak één duurzame bron van waarheid voor de spelblokkade, gekoppeld aan show, gesprek en laatste officiële bal. Leg de overgang atomair vast of gebruik een aantoonbaar veilige tussenstatus: geen uitnodiging, backstage/live-overgang of groen regielabel zonder bevestigde hold. Laat alle trekpaden (auto, handmatig, AI, bevestigen van al voorbereide bal) dezelfde servercheck uitvoeren. Een belvoorbereiding mag een bestaand meldvenster niet afsluiten; geef uitstel of blokkeer de belactie zolang de speltoestand het niet toestaat. Een mislukt gesprek, refresh of verloren client herstart nooit automatisch. Trek pas na veilige opruiming, bewezen terugkeer en expliciete regieactie.

**Acceptatie:** forceer uitval vóór en tussen alle writes, en race voorbereiding tegen een in-flight balbevestiging. Eén beslissende servervolgorde: de bal telt vóór hold en wordt onderdeel van de checkpoint, of hij telt niet; de gebruiker ziet dezelfde stand. Geen call live zonder hold. API, auto en AI geven dezelfde blokkade, ook na refresh of vanaf een tweede regietab. Start geen gesprek dat het actieve meldvenster afbreekt. Na expliciete vrijgave blijft de nummerreeks uniek en wordt de volgende bal exact één keer bevestigd.

### L02 · Herstel van verloren of vertraagde AI-start · P1

**Bron:** `server/live-calls.js:28–34,106,131–134`. Reservering zonder opgeslagen sessie-ID laat opruimen permanent op 409 hangen.

**Bouw:** gebruik begrensde reservering, duurzame correlation-ID, veilige retry en reconciliatie. Laat verlopen of late providerantwoorden niet alsnog een gesprek openen. Sluit of isoleer verweesde media voordat vrijgave mogelijk is. Geef regie onderscheid tussen tijdelijk in behandeling, onzekere toestand, opgeruimd en gecontroleerd te hervatten. Blokkeer API-sleutelwissel tijdens actief gesprek of opruiming; houd noodzakelijke credentialreferentie server-side. Eén actieve gast en één AI-sessie per geldig gesprek.

**Acceptatie:** injecteer crash na reservering, vóór opslaan van sessie-ID, late providerrespons na annuleren, time-out en mislukte hangup. In geen geval live audio na annuleren of automatische trekhervatting. Een geautoriseerde herstelactie brengt het systeem uiteindelijk naar aantoonbaar opgeruimd of een verklaarde, handmatig te behandelen toestand met veilige fallback. Beproef dubbele verzoeken en sleutelaanpassing. Onderzoek het oorspronkelijke 503/409-verschil op contract en gedrag, niet alleen op verwachte statuscode.

### L03 · Livepunt en call-eigenaarschap · P1

**Bron:** `frontend/youtube-player.js:27–34`, `frontend/player-live-call.js:39–43`. In de repro werd afspelen op 120 s als teruggekeerd gezien terwijl live 240 s was.

**Bouw:** leg het laatste bevestigde nummer als checkpoint vast; geef het gezin gelegenheid om dat nummer te horen en kaart bij te werken. Demp YouTube tijdens rechtstreeks geluid en houd de beller uit zijn eigen terugmix. Laat de speler na afloop aantoonbaar naar live springen waar meetbaar; waar de embed dit niet betrouwbaar meldt, toon een herkenbare actuele cue en laat een gerichte terugkeerbevestiging volgen. Play, geluid of vaste wachttijd alleen zijn onvoldoende. Bind opnemen, weigeren, annuleren en media aan de geselecteerde gast en actieve oproepclient; tweede tab blijft passief. Intrekken van toestemming moet altijd kunnen, ook bij gesloten aanmelding of verloren eerste tab; beëindig/mute onmiddellijk, en laat de trekking onder hold.

**Acceptatie:** stream met DVR, 120 s afgespeeld/240 s live, muten, reconnect en verloren toestemmingen. Verifieer dat er geen vrijgave is terwijl de kijker achterloopt of bewijs ontbreekt. Test hoorbare, actuele cue, aparte toestemming, weigering, geen antwoord, uitval, nieuwe tab en ouder die toestemming intrekt na sluiten van aanmelding. Tweede gast krijgt uitsluitend eigen roepnaam en gevalideerde spelcontext; eerdere gegevens verdwijnen. Gewone kijkers openen geen LiveKit- of AI-sessie.

### L04 · Uitzendbeeld hervatten en audio veilig scheiden · P1

**Bron:** `public/output-bridge.js:3,12–16`, `server/output.js:18`, `server/live-director-whisper.js`, `frontend/live-call-output.js:81–86,128–135`.

**Bouw:** versies voor uitzendbron bestaan uit generatie plus volgnummer; alleen de bevoegde actieve bron kan herverbinden en een nieuwe generatie krijgen. Bevestig daadwerkelijk gepubliceerd beeld; een succesvolle HTTP-status is geen publicatiebewijs. Voeg een herkenbare wachtstand en gecontroleerde regie-overdracht toe. Geef backstage een aparte ruimte/routing; backstage-audio mag nooit in program, AI-invoer of transcriptie verschijnen. Geef regie aparte privémicrofoon, gastmute en AI-mute/noodstop. Laat prijs- en bingoteksten uitsluitend komen uit expliciet door spelserver en regie bevestigde feiten; gebruik vaste servergestuurde zinnen. Behandel vrije AI-reacties als begeleide uitzendinhoud, niet als autoriteit. Fluisteren bevat geen gevoelige of geheime informatie.

**Acceptatie:** publiceer beeld op hoge volgnummers, refresh en toon aantoonbaar de volgende camerawissel op Program/OBS. Vertraagde berichten van oude generatie worden geweigerd, ook wanneer de tab online komt. Speel audio met herkenbare proefzinnen af in backstage, livegast, AI en YouTube; controleer in aparte opnamen en transcriptie dat alleen gewenste sporen aanwezig zijn en geen echo of eigen stem terugkeert. Forceer mute en overname bij uitval. Laat een fictieve gast een onbevestigde prijs claimen; die komt niet als officiële aankondiging door. Repeteer met een volwassen gast via echte LiveKit, OpenAI, OBS en YouTube voordat live bellen aangaat.

## P1/P2 · werkplekken, regels en capaciteit

| ID | Bouw | Acceptatie |
|---|---|---|
| U01 · P1 | Maak servergegenereerde, bindende regels beschikbaar vóór aanmelden of bestellen. Neem inhoud, publicatiemoment en showversie op; scheid welkomsttekst van vaste regels. Toon patroon, prijs, boeklimiet, tiebeleid, terugkijkmarge, sancties, verbindingsbeleid en bezwaarroute. | Deelnemer ziet dezelfde waarden en volgorde als de server toepast. Regie kan kernregels niet wegvinken of na publicatie ongemerkt wijzigen. Werk door met expliciete, geldige versie bij een noodzakelijke wijziging; deelnemers kunnen zien welke versie geldt. |
| U02 · P1 | Eén gedeelde BINGO-actie en servertimer bij Kijken én Boekjes, op mobiel in duimbereik. Op mobiel: 16:9-video, 5×15-bord met grote BINGO-bal ernaast waar passend, chat onder het bord. Op desktop: links video en bord, rechts chat. Laat laatste bevestigde bal en chronologische historiek per ronde zien; videoweergave mag achterlopen op het officiële bord. | Met een trage of gedempte stream ziet de speler de actuele serverstand en kan vanuit de digitale kaart melden. Wisselen van tab of refresh maakt geen tweede timer. Controleer iOS Safari, Android Chrome, desktop, toetsenbord, grote tekst, slechte verbinding, schermvergrendeling en klokafwijking. |
| U03 · P1 | Eén startcontrole voor regie: toegelaten boekjes, patronen en prijzen definitief, bestelstatus, uitzendpad, audio en callstatus. Houd PAUZE, MUTE, laatste bal en timer bereikbaar in Program/Preview en de modulaire regie. Leg officiële gebeurtenissen en operatoracties vast met tijd, context en resultaat, zonder overmatige persoonsgegevens. | Blokkeer start met toepasselijke rode voorwaarden; laat zien welke functie uitstaat en waarom. Bij verbindingsuitval toont publiek een wachtstand met bevestigde ballen. Een reservebediening neemt bevoegd over zonder ronde, melding of uitslag terug te zetten. Controleer beide merken en beide Vlampie-studio’s. |
| C01 · P1 | Splits live speldata van order-, mail- en eventhistoriek of gebruik een aantoonbaar veilig equivalent. In de audit kwam een configuratie met 4.000 kaarten op circa 1,73 MB tegenover een grens van 1,50 MB; ook 81 orders met twee bladen en vier rondes passeerden de grens zonder showhistoriek. Bereken werkelijke bytes en reservecapaciteit vooraf; migreer behoudend. | Reproduceer beide omvangscenario’s. Houd genoeg ruimte voor de beoogde piek plus afgesproken marge, inclusief hele showhistoriek en foutscenario’s. Toon waarschuwing of harde weigering vóór start bij onvoldoende ruimte. Test 100 gelijktijdige huishoudens met 400 boekjes als lokale regressie en herhaal op het beoogde staging-opslagpad met het echte volumedoel. Geen verloren of dubbele bal/claim; rapporteer gemeten piek en beperkingen. |
| C02 · P2 | Vervang drie frequente polls op volledige showdocumenten door een lichte geautoriseerde livefeed met versie en incrementeel herstel. Gebruik snapshots bij gemiste versies, backoff bij storing en een compacte cache per rol. | Minder requests en bytes onder hetzelfde scenario; na gemiste updates, refresh en reconnect convergeert de officiële stand. Een gezin kan nooit een feedvariant van een ander gezin of merk lezen. |
| U04 · P2 | QR-herstel bij onleesbare code, toegangscheck per kind, terugblik na regiegoedkeuring, korte publieksreacties, ondertiteling en rustige animatiestand. Nieuwe minigames blijven een onthulling van de opgeslagen loting. | Offline en kapotte QR tonen een herstelroute; doorgifte blijft gezin- en showgebonden. Bekijk terugblik pas na toestemming/vrijgave. Reduced motion schakelt drukke animatie uit zonder spelinformatie te verbergen. Minigame hervat hetzelfde resultaat na uitval of overslaan. |

## Bewijs bij oplevering

1. Registreer commit, migratie, fixtures en testresultaat per ID. Geef per oorspronkelijk rood script de oorzaak: fout, verouderd testcontract of ontbrekende runtime. De auditbasis telt 94 van 101 geslaagde scripts na correcte uitvoermap voor studiobeelden. De zeven rode scripts zijn `check-broadcast-shell.mjs`, `check-workspace-navigation.mjs`, `check-calls.mjs`, `check-livekit.mjs`, `check-milo-ui.mjs`, `check-planner-ui.mjs` en `check-showtime.mjs`. Zet een test alleen om als het gewenste gedrag aantoonbaar is, bijvoorbeeld 13 werkplekken met mailstudio.
2. Test geautoriseerde en ongeldige routes via de server. Bewaar gelijktijdige en afgebroken scenario’s als regressies, niet alleen clicks door de demo. Test de grens op het serverdeadline-tijdstip, de loting eenmaal, troostprijs aan/uit, verlopen claim zonder straf en het uitblijven van een dubbele bevestiging.
3. Leg vast wat lokaal, op staging en met echte apparatuur is getest. Voor een besloten repetitie: twee fictieve gezinnen met meerdere boekjes, twee fysieke telefoons, regie plus reserveoperator en een volwassen testgast. Doorloop minstens één gelijkstand, één later geldige claim, één verbindingsterugkeer, twee goochelcues en gecontroleerde herstart van regie. Bij een open blokkade blijft de bijbehorende functie uit.

