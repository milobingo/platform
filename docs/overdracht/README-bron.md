# Milo & Friends BingoShow · Studio

De nieuwe React 19-regie, familie-app en Sterrenplein-studio vormen de hoofdomgeving.
Vlampie blijft een aparte productie, met zijn bestaande karakter, Showtime-decor en
Sinterklaasdecor. Bestaande shows, spelersaccounts, boekjes en servercontroles blijven
hun bestaande API’s en gegevens gebruiken.

## De nieuwe omgeving

- `/` en `/regie`: overzicht, shows, draaiboek, regiekamer, boekjes, personages,
  studio, momentbibliotheek, deelnemers en instellingen.
- `/uitzending`: schoon 16:9-uitzendvenster. Open het vanuit de regie; beeldstatus
  loopt via BroadcastChannel en de bestaande uitvoerrelay. Alleen de regie trekt
  en bevestigt nummers. Kies in de regiekamer waar het geluid wordt afgespeeld.
- `/spelen`: nieuwe familie-app met bestaande e-mailaanmelding, gezinsleden,
  boekjes koppelen, kaarten, chat en servergestuurde bingocontrole.
- `/klassiek` en `/spelen/klassiek`: compatibiliteitsroutes voor oude bladwijzers.
  De nieuwe werkplek heeft geen navigatie naar deze oude pagina’s nodig.

De regieroutes vereisen de bestaande eigenaaridentiteit. De ingestelde doelgroep
van de Site is behouden; een spelerslink wijzigt die toegang niet.


## Volledige productiewerkplek

De hoofdregie gebruikt een afzonderlijk PROGRAM- en PREVIEW-beeld, camerabank,
scènevoorbereiding en expliciete TAKE. Een voorbereid shot verandert de uitzending
pas na TAKE. Draaiboek, transport, officiële nummers, meldingen, audio, acteurs,
showelementen en publieksdock staan in dezelfde regiekamer. Handmatige scènes,
belgesprekken en uitslaganimaties blokkeren verborgen trekkingen. Pauze stopt de
zichtbare productieklok en hervatten bewaart de onderliggende show.

**Publiek & bellen** bevat de echte showchat, moderatie, kijkersvraagcontrole en
belwachtrij met geluidscheck. Dezelfde verbinding blijft bestaan wanneer een ander
beheerpaneel wordt geopend. Een gekozen belpresentator wordt met zijn opgeslagen
personageboek en compatibele Realtime-stem vastgelegd. TTS-only stemmen nova, onyx
en fable gebruiken in gesprekken respectievelijk coral, cedar en verse; de UI toont
de daadwerkelijke gespreksstem. Dezelfde globale OpenAI-sleutel geldt voor beide.

**Showelementen** bevat de elf beslisspellen, voorprogramma, goedgekeurde groeten,
verhaallijnen, scènes, geluidsmix, stemarchief, extra lotnummerprijzen, levering en
herinneringsinstellingen. Animaties tonen uitsluitend de door de server vastgelegde
winnaar. Stemfragmenten voorbereiden vereist een bewuste klik. Automatische
publieksreacties werken alleen bij een actieve echte show met het opgeslagen
automatische profiel; standaard begeleiding maakt geen achtergrondaanvragen.

Deelnemersbeheer, uitgifte/correctie/intrekken van boekjes, mail/TURN, profiel- en
spelregels en veilig herstel zijn native onderdelen van de nieuwe React-omgeving.
De familie-app bevat QR-scannen/invoer, begroetingen, toestemming, belaanmelding en
persoonlijke herinneringskaarten. De normale gebruikersroutes verwijzen niet meer
naar de klassieke interface.

## Eén OpenAI-koppeling, eigen personages

Voer de bestaande OpenAI-sleutel één keer in bij **Instellingen → Globale
OpenAI-koppeling**. Het bestaande versleutelde opslagmechanisme en eventuele
serverconfiguratie blijven gelden. Een sleutel wordt nooit in een karakterprofiel,
PDF of uitzendstatus bewaard. Een bestaande ingestelde verbinding wordt hergebruikt.

Alle twaalf vrienden en Vlampie hebben een eigen instellingenpagina met stemkeuze,
spreektempo, stemregie, uitspraakwoordenboek, personageboek, vaste uitspraken,
bewegingsenergie, rustbeweging en mondanimatie. De twaalf vrienden hebben standaard
twaalf verschillende stemidentiteiten. Sla wijzigingen eerst op om de echte
AI-stemproef te beluisteren. De browserstem is alleen bedoeld voor repetitie.
De AI-stemmen moeten met de eigen sleutel nog worden beluisterd en afgeregeld.

De D1-migratie `0008_character_settings.sql` voegt eigenaargebonden karakterprofielen
toe. Opslaan controleert de actuele revisie; een oud venster overschrijft geen
nieuwere instellingen. De API staat onder `/api/characters`.

## Show en studio

Studio 1, **Sterrenplein**, is een 2,5D-compositie van het gekozen decor, geanimeerde
beeldrigs, belichting, deeltjes en vloeiende camera-uitsneden. Het is een 2D-uitzending
met dieptewerking; er is geen vrij beweegbare 3D-wereld. De twaalf personages hebben
ieder een rust- en praatbeeld, hoofd- en armbewegingen, knipperen en mondanimatie.
Een gemeten audioniveau stuurt de AI-spreekmond; browserrepetities gebruiken een
benadering. Dit zijn geen exacte foneemvisemen.

Het draaiboek bepaalt hoofdpresentator, co-presentator, spreker, gast, camera en
beweging. Nieuwe Milo-shows beginnen met de première en twee aparte geanimeerde
trucs: de zwevende sterrenhoed en de linten die een sterrenvlinder vormen. Bestaande
draaiboeken worden niet automatisch herschreven. Trucs veranderen geen bingonummers.

Bij het openen zonder geselecteerde echte show verschijnt een herkenbare lokale
repetitie. Maak of selecteer een echte show om boekjes, deelnemers en resultaten op
de server te bewaren. Houd het regievenster tijdens de uitzending geopend.

## PDF-boekjes

De server genereert unieke kaarten per show en bewaart hun identiteit. Downloaden
hergebruikt dezelfde boekjes. Milo-boekjes gebruiken het originele groepslogo,
het Sterrenmagie-ontwerp: middernachtblauw/paars, gouden sterrenbeelden, lichte
vakken en een luxere finale. Vier 5x5-kaarten, bladnummer, boekjecode, uitleg en QR. Beschikbaar
in A5, A4 met twee A5-boekjes per vel en een inktzuinige zwart-wituitvoering. Bestaande
Vlampie- en Rocco-printstijlen blijven beschikbaar voor hun oorspronkelijke shows.
De Boekjes-pagina toont afzonderlijke kleur- en inktarme voorbeelden; de gekozen
uitvoering gaat mee naar het generatievenster. De witte zwart-witversie gebruikt
dunne lijnen en geen gevulde nummervakken. Beide uitvoeringen zijn beschikbaar als
A5 en A4 dubbel. De voorbeeld-PDF's zijn gemarkeerd en geen geldige boekjes.

De printbasis staat in `server/milo-print-layout.js`; `bookPdf()` plaatst de bestaande
kaartnummers, rondekoppen, bladnummer, code en QR als vectoren eroverheen. De
versie `milo-friends-sterrenmagie-a5-v4` isoleert de PDF-cache van oudere ontwerpen.
Herbouwen: render met `scripts/render-milo-print-art.mjs` (authoring: @napi-rs/canvas),
daarna `node scripts/build-milo-print.mjs` en `node scripts/example-milo-print.mjs`.
Preview-JPEGs worden vanuit beide voorbeeld-PDF's met Poppler op 180 dpi gerenderd.
De statische voorbeelden bevatten een niet-activeerbare QR; deelnemers-PDF's houden
altijd hun opgeslagen boektoken. Bestaande batches worden niet herschreven.

## Implementatie en controle

`frontend/main.jsx` splitst de nieuwe admin en familie-app. Motion verzorgt de
interfaceovergangen; de studiocompositor gebruikt Canvas2D. De bestaande Worker,
D1, R2, gezinsauthenticatie, trekkingsadministratie, chat en uitvoerrelay blijven
behouden. De build gebruikt esbuild; gedeelde modellen worden vanuit `server/`
naar `public/` gekopieerd. Wijzig gedeelde modellen daarom in `server/`.

Bouw met `npm run build`. Functionele controles staan in `scripts/check-*.mjs`;
controleer in elk geval de nieuwe karakter-, showrunner-, engine- en PDF-controles,
plus de bestaande OpenAI-, planner-, speler-, bingo- en chattests.
Een echte streamrepetitie met eigen API-sleutel, geluid, meerdere deelnemers en
bingo-afhandeling blijft nodig voor ingebruikname.

---

# Technische achtergrond van de bestaande Vlampie-modules

Onderstaande oorspronkelijke modulebeschrijvingen documenteren de behouden
klassieke onderdelen. De nieuwe routes en bediening hierboven zijn leidend.

Premium 2,5D-bingostudio met de originele 2D-Vlampie, blauwe/gouden decors,
twee zijtribunes, een grote bingomolen en een dynamisch nummerscherm.
De standaardweergave gebruikt Canvas2D, zonder WebGL-context of 3D-modeldownload.
`?view=show` toont het podium zonder bediening; `?view=overlay` toont Vlampie
transparant. Showvensters op hetzelfde apparaat volgen de regie via BroadcastChannel.

## Studio en animatie

`public/studio-25d.js` combineert drie gegenereerde studioachtergronden met de oorspronkelijke
Vlampie-PNG. De aangeleverde premium Showtime-illustratie was het decorreferentiebeeld.
Via de studioknoppen kies je Showtime of Sinterklaasfeest. Het extra decor gebruikt
rood fluweel, gouden mijters/staven, cadeaus en verlichte grachtenhuizen. De Sinterklaasstudio opent standaard bij de eerste start van deze versie; daarna
blijft de eigen studiokeuze bewaard. De drie decorbeelden en twee transparante props
worden samen geladen en daarna hergebruikt. Cadeaupakketten en verspreide kruidnoten
staan per camera op de vloer, in dezelfde coördinatenruimte als het decor. De keuze
blijft bewaard en wordt gedeeld met showvensters. De afbeeldingen zijn 1672×941; de compositie gebruikt één 1920×1080-coördinatenruimte.
De scènewisselaar combineert de camerastandpunten met een eigen showmoment.
Losse cameraknoppen blijven beschikbaar onder de extra bediening. Camerawissels
gebruiken een crossfade van 0,5 seconde en blijven binnen de decorgrenzen.

`canvas-presenter.js` gebruikt de botten en gewichten van `illustrated-presenter.js` om
de oorspronkelijke pixels op de CPU te vervormen. De 24×36-tekenmesh slaat transparante
driehoeken over: 992 zichtbare driehoeken, 670 gebruikte vertices. Rust, zwaaien, welkom,
juichen, nadenken, buigen, kijken en aanwijzen mengen soepel. Het gezicht en de vlammen
blijven uit de bronafbeelding. `blink-texture.js` gebruikt twee kleine, zacht gemaskeerde
oogpatches voor korte knipperbewegingen; buiten die patches blijft de tekening exact gelijk.

De spreekmond gebruikt één gegenereerde mondvariant als kleine, zacht gemaskeerde
patch over de originele tekening. `mouth-texture.js` animeert alleen dit gebied met bredere kaakopening en
een versmalling voor ronde klinkers;
het volgt dezelfde vervormingsmesh als het hoofd. Stilte, einde, fout en Stop
herstellen de oorspronkelijke gesloten mond. Een klein patchcanvas voorkomt dat
voor elke driehoek een volledige veranderende karaktertextuur nodig is.
`speech-mouth.js` schat Nederlandse mondbeweging uit de tekst, leest waar beschikbaar
de woordgrenzen van de browserstem en valt anders terug op geschatte spreekduur.
Dit is benaderde spraakanimatie, geen analyse van de audio of precieze fonementiming.
Bij browserstemmen zonder woordevents blijft de mond na de geschatte duur rustig
articuleren totdat de echte eindmelding, fout of Stop volgt. Tekst-only playback
stopt op de eigen eindtimer. Dezelfde mond werkt in het reservebeeld en de
transparante overlay. “Spreektest van dichtbij” kiest het portretshot en spreekt
de ingevoerde tekst. Showvensters corrigeren ontvangstvertraging en vragen bij
terugkeer naar de tab opnieuw de actuele regiestatus op.

Een voorgrondmasker plaatst Vlampie achter de desk. Beide desks hebben een lager front op natuurlijke presentatorhoogte, met een volledig LED-bingobord: vijf rijen
van vijftien getallen (1–75). Alleen afgeronde trekkingen lichten goud op;
de nieuwste bal heeft een extra lichte ring. Het bord behoudt alle getrokken
getallen tot een reset. Het getal in een draaiende molen wordt nog niet onthuld.
In de deskshots blijft Vlampies bovenlichaam boven het blad zichtbaar; zijn schaal en de close-up zijn daarop afgestemd. De bingobordcamera kadreert het lagere scherm apart.
De regie houdt daarnaast een korte geschiedenis van de laatste zeven ballen. Balletjes en de binnenste kooi
bewegen los van de bingomolenachtergrond. Het publiek en de vloerreflecties zijn
onderdeel van het vaste decor; er is geen live spiegelbeeld van Vlampie.

De compositor richt zich op maximaal 30 fps. Hij past canvasafmetingen uitsluitend bij
een nieuwe tekenopdracht aan, met DPR maximaal 1,5 en een oppervlak van maximaal
1920×1080. Stop bevriest presentator en molen; cameraovergangen blijven bedienbaar.
De reserveweergave gebruikt dezelfde originele illustratie met rustige ademhaling.

## Bediening

De hoofdpagina is een dashboard met zes pagina’s: Regie control room,
Showvoorbereiding, Studio & beeld, Vlampie & stem, Publiekschat en Koppeling & stream.
De inklapbare sidebar bewaart zijn voorkeur op dit apparaat. De pagina’s wisselen
via een URL-fragment zonder herladen; showverloop, spraak en trekkingsgeschiedenis
blijven actief. Alleen de instellingenpagina’s scrollen.

De regiekamer gebruikt de volledige vensterhoogte, met een groot uitzendbeeld,
kleinere voorvertoning, scènewisselaar, transportknoppen en live regie. Ronde- en
prijsinformatie, de laatste bal, geschiedenis, camera en geluidsbediening blijven
in dezelfde werkruimte. Op smalle schermen wissel je tussen uitzending en
voorvertoning. Extra regieopties staan dan in een paneel. Een ResizeObserver
controleert tevens de werkelijke beschikbare hoogte; wanneer de live opties niet
passen, komen ze achter de knop Regieopties. Dit voorkomt verbergen onder de
onderrand of scrollen tijdens de show.

Publieksreacties worden vóór de presenterlaag getekend. De tribune-uitsneden kunnen
daardoor Vlampies hand, arm of vlam niet meer overschilderen tijdens de finale.

Het regiecentrum heeft een onafhankelijke voorvertoning en een uitzendbeeld. Een
scène selecteren verandert alleen de voorvertoning; **Zet live** neemt die scène over
in de uitzending. De negen scènes zijn opening, presentator, trekking, bingobord,
ronde, prijs, pauze, publiek en finale. Titel, ronde, speelpatroon, prijs en afteltijd
kunnen vooraf worden ingevuld en bekeken. De rondescène wist het bord niet; een nieuwe
trekkingsreeks begint uitsluitend met **Wis bord** of een volledige reset.

`show-director.js` beheert het showverloop uitsluitend in de regie. Opening telt af
en laat Vlampie welkom zeggen. Een trekking gaat van Vlampie naar 4,3 seconden
draaiende molen, een grote balonthulling, het verlichte bingobord en terug naar de
desk. Er verschijnen 75 unieke nummers, gekozen met cryptografische toevalsgetallen
zonder modulovertekening. Alleen de onthullingsstap bevestigt het nummer. De
onthulling wacht indien nodig tot de echte spraak klaar is. Pauzeren bewaart de
lopende bal en stap; hervatten trekt geen nieuw nummer. **Noodstop** pauzeert ook
spraak, muziek en bewegingen. Het showvenster kiest of bevestigt zelf nooit een bal.

**Bingo gemeld** vraagt naam en optioneel kaartnummer, onderbreekt de trekking en
toont een rustig controleshot. De regie moet de kaart handmatig controleren en het
controle-vinkje zetten voordat **Bingo goedkeuren** beschikbaar wordt. Goedkeuren
start de felicitatie, confetti en optioneel publieksapplaus. Afwijzen geeft een
vriendelijke reactie en hervat dezelfde onderbroken trekking. Er zijn nog geen
gekoppelde deelnemersaccounts, QR-kaarten of automatische kaartcontroles.

Automatische camera, stem, geluid, tussenzinnetjes en publieksreacties kunnen
afzonderlijk worden geschakeld. `show-audio.js` maakt eigen korte WebAudio-cues en
applaus, verlaagt het volume tijdens spraak en speelt alleen in de regie. De studio
gebruikt rustige verlichting tijdens het spreken en subtiele publieksbeweging bij
applaus. De pauzescène heeft een timer; de regie kiest wanneer de show verdergaat.
**Bekijk alle scènes** doorloopt alleen de voorvertoning, zonder een bal te trekken.

Het dashboard heeft diepblauwe panelen, champagnegouden accenten en duidelijke
primaire showknoppen. Naast de laatste bal staat een permanent raster van vijf
rijen met vijftien nummers. Het regieraster gebruikt dezelfde bevestigde
getallen als het LED-scherm: eerdere ballen blijven verlicht en alleen de nieuwste
krijgt extra nadruk. Tijdens een volgende trekking blijft de vorige bal zichtbaar
en brandt de nieuwe pas bij de onthulling. Op kleine of lage schermen opent
**75 ballen** hetzelfde raster als een paneel; sluiten of navigeren onderbreekt
de show niet. Escape sluit eerst een geopend menu of paneel.

Sneltoetsen: 1–9 selecteren een scène, Enter zet live, N trekt de volgende bal,
Spatie pauzeert of hervat, B opent de bingomelding en Escape stopt. Ze zijn
uitgeschakeld tijdens tekstinvoer en in het bingo-dialoogvenster. Show en overlay
volgen dezelfde regie op hetzelfde apparaat. Neem voor OBS ook het regiegeluid op.

Spraak kiest tussen OpenAI Ballad en de bestaande browserstem. Ballad gebruikt
`gpt-4o-mini-tts` met een enthousiaste Nederlandse instructie. De AI-publieksreactie
gebruikt `gpt-4.1-mini` via Responses; de regie leest de reactie na en drukt zelf op
spreken. De interactie loopt via de eigen showchat; YouTube wordt alleen voor de videostream gebruikt.
De gekoppelde bingo-administratie controleert de originele kaarten op de server.
De AI mag geen bingo, prijzen of nieuwe trekkingen bevestigen. De regietest blijft
onder het bestaande owner-only toegangsbeleid. Een privé-Site kan om
inloggen vragen; gebruik voor OBS een vensteropname van een aangemeld showvenster.

## Showvoorbereiding, patronen en prijzen

De showvoorbereiding bevat een tijdlijn met drag-and-drop vanaf de widgetbibliotheek.
Blokken kunnen worden gekopieerd, verwijderd of met **Hoger/Lager** verplaatst;
op aanraking werkt slepen via pointer-events. Elk blok heeft een instelpaneel.
Aftellen en pauzes accepteren seconden of minuten. Welkom, uitleg en finale
hebben maximaal 500 tekens tekst en een wachttijd na het spreken. Een ronde
bevat één of meer opeenvolgende combinaties van een patroon en een prijs,
een interval tussen trekkingen en een optie om met een leeg bingobord te beginnen.

**Patronen** biedt een editor met 5 × 5 vakjes, een vrij middenvak en exact getekende
patronen of elke horizontale rij. **Prijzen** bewaart een titel, korte omschrijving
en optioneel een afbeelding. De prijs en het patroon verschijnen ook in de studio;
de bingocontrole toont het actieve patroon. Dit vervangt geen gekoppelde
bingokaarten: controle en goedkeuring blijven handmatig.

**Start show** en **Start deze show** starten een opgeslagen kopie van de tijdlijn.
`ShowRunner` plant de bestaande `ShowDirector`; alleen de director trekt en
bevestigt ballen. Tekstblokken wachten op de daadwerkelijke spraak. Na goedgekeurde
bingo en de felicitatie volgt de volgende combinatie of ronde. Afwijzen hervat
de oorspronkelijke trekking. Na 75 ballen wacht de ronde op de regie; ook dan kan
een goedgekeurde bingo verdergaan. **Volgend blok** slaat een blok over zonder een
nog niet onthulde bal te bevestigen. Handmatig een scène live zetten beëindigt de
automatische tijdlijn. Pauzeren bewaart het showmoment; een stemfout pauzeert
de show en hervatten probeert dezelfde uitspraak opnieuw. Het regievenster moet
open blijven. De actieve show gebruikt een aparte kopie, zodat het bewerken van
de voorbereiding geen lopende trekkingen wijzigt.

De **Belronde** reserveert een tijdslot en een uitspraak. Er is nog geen
spraakverbinding met deelnemers. Het blok kan op de regie wachten of automatisch
na de ingestelde timer doorgaan.

Voorbereidingen en catalogi staan in D1 (`DB`, `show_workspaces`), per ingelogde
eigenaar. De migratie is met Drizzle gegenereerd en wordt met Sites gepubliceerd.
Autosave gebruikt een oplopende revisie en conditionele updates. Een verouderd
venster kan geen nieuwere voorbereiding overschrijven. Bij conflicten of fouten
blijven de eigen wijzigingen staan; de gebruiker kan bewust de opgeslagen versie
laden. Browseropslag is geen bron voor deze gegevens.
Prijsafbeeldingen staan onder `show-prizes/<owner>/<uuid>` in de bestaande R2-binding
`SETTINGS`, los van de versleutelde OpenAI-sleutel. Uploads zijn begrensd, worden
op bestandstype gecontroleerd en hebben alleen een eigenaargebonden leesroute.
De browser maakt grote afbeeldingen passend voor de studio. Alle planner-API's
vereisen dezelfde regie-eigenaar als de OpenAI-instellingen; writes vereisen daarnaast
dezelfde origin en een eigen aanvraagheader.

`server/plan-model.js` is het gedeelde validatiemodel. De build kopieert het naar
`public/plan-model.js`; verander het serverbestand bij modelwijzigingen.
Functionele controles: `check-show-plan.mjs`, `check-planner-api.mjs` en
`check-planner-ui.mjs` controleren respectievelijk het showverloop, daadwerkelijke
SQLite-opslag met conflicten en de DOM-bediening met upload en drag-and-drop.

## Gedeelde live showchat

De regie toont dezelfde chat als `/spelen`: op brede schermen links naast een exact
16:9-uitzendbeeld. De chat verhuist naar Publiekschat zonder nieuwe verbinding als
de host die pagina opent. De composer blijft onderaan zichtbaar. Op compacte laptops
kan de host tussen chat en uitzending wisselen; de showuitvoer zelf blijft ongewijzigd.
Op telefoons staan stream en BINGO-knop vóór de chat en accountinstellingen.

`public/live-chat.js` is de gedeelde component. Het account kiest bij meerdere
personen de voornaam van de afzender. De server controleert profielbezit en bepaalt
alle rollen; de regie-eigenaar verschijnt altijd als **Host**. De host beheert via
Chat beheren moderatorrollen per show. Host en moderators kunnen berichten van
spelers verwijderen en accounts tijdelijk muten. Moderators kunnen geen host of
andere moderator beheren; eigen berichten verwijderen kan wel. Een mute en de
berichtlimiet gelden voor alle namen en tabs van hetzelfde account. Leeftijd en
e-mailadressen gaan niet naar de chat. Na afloop blijft geschiedenis leesbaar;
nieuwe berichten zijn dan uitgeschakeld.

`server/chat.js` en `server/chat-store.js` gebruiken aparte D1-tabellen voor
berichten, rollen/mutes, aanvragen en een oplopend gebeurtenissenlog. Chat schrijft
geen bingospel- of accountdocumenten opnieuw. Een atomaire D1-batch kent de
volgende gebeurtenis toe en controleert tegelijkertijd actuele accountrechten,
mutestatus en de versie van profiel/spel. Een stabiele aanvraagcode maakt herhalen
na een verloren antwoord veilig. Berichten bevatten maximaal 500 Unicode-tekens;
er mag per account eens per twee seconden een nieuw bericht worden gestuurd.
Verwijderen wist de tekst uit de opslag en verstuurt een blijvende verwijdermelding.

De SSE-route `/api/bingo/games/:id/chat/stream` leest eenmaal per seconde een
consistente snapshot van nieuwe gebeurtenissen en chatrechten. De verbinding
vernieuwt na twintig seconden. Bij uitval gebruikt de client cursorpolling met
1,5 seconde tussen aanvragen, zonder overlappende polls. Terugkeren hervat vanaf
de laatste cursor. Dit gebruikt de bestaande D1-binding en vereist geen externe
chatdienst of nieuwe API-sleutel; typische doorlooptijd is circa één seconde plus
netwerkvertraging, geen gegarandeerde sub-seconde levering. De laatste honderd
berichten worden bij openen geladen; gebeurtenissen blijven duurzaam beschikbaar.
Verzendfouten houden de concepttekst vast. Verwijderde berichten mogen ook na een
laat bevestigingsantwoord niet terugkomen.

**Laat Vlampie reageren** bij een bericht gebruikt de bestaande OpenAI-koppeling.
De host leest de gegenereerde reactie na en kiest daarna zelf **Laat Vlampie spreken**.
Gewone chatberichten maken geen AI-aanvragen. De deelnemer moet een toegelaten boekje
voor de gekozen show hebben gekoppeld, of moderator zijn. Toegang tot de Site zelf
blijft bepaald door de ingestelde doelgroep; die is bij deze wijziging niet aangepast.

`node --test scripts/check-live-chat.mjs scripts/check-chat-client.mjs` controleert
de daadwerkelijke SQLite-transacties en gedeelde DOM-bediening, inclusief honderd
gelijktijdig verzendende accounts, herhaalde aanvragen, verwijderde geschiedenis,
naamkeuze en rechten die tijdens een aanvraag veranderen. Dit is een lokale
integratietest, geen meting van honderd echte browsers op de gepubliceerde Site.

## Ontwikkeling en controle

`public` bevat de bestaande browserapp en assets. `npm run build` maakt
`dist/client`, `dist/server` en de hostingmetadata. De rootpagina blijft dezelfde
studio; de Worker behandelt `/api/openai/status`, `/test`, `/speech` en `/reply`.
De API vereist de door Sites doorgestuurde ingelogde gebruikersidentiteit en
weigert cross-origin verzoeken. De huidige Site blijft owner-only; alle API-routes controleren daarnaast de ingestelde regie-eigenaar.
De eigenaar kan de OpenAI-sleutel in de regie invoeren bij API-instellingen.
De server valideert de sleutel via `/models` en slaat pas daarna een AES-256-GCM
versleutelde blob op in de private R2-binding `SETTINGS`. Elke opslag gebruikt een
nieuwe 96-bit nonce en projectspecifieke additional authenticated data. De aparte
versleutelingssleutel `VLAMPIE_SETTINGS_KEY` staat uitsluitend als Sites-runtimegeheim;
behoud deze bij latere deployments. `VLAMPIE_ADMIN_EMAIL` staat eveneens in Sites
en wordt vergeleken met de vertrouwde, door Sites doorgestuurde gebruikersidentiteit.
Alle OpenAI-routes vereisen die eigenaar, niet alleen de instellingenroute.
De gebruiker koos expliciet voor sleutelbeheer in de Site; OpenAI Developers is
voor deze route niet vereist. De studio kan gepubliceerd worden vóór invoer van
een API-sleutel. Optionele modellen staan in `.env.example`.

`/api/openai/settings` vereist POST, dezelfde Origin en een speciale requestheader.
De sleutel wordt nooit teruggestuurd, vooraf ingevuld, gelogd of in browseropslag
bewaard. Na succesvol opslaan en bij pagehide wordt het wachtwoordveld leeggemaakt.
Status bevat alleen configured/source en een revisietoken. Conditionele R2-writes
voorkomen overschrijven door oude tabs. Een fout bij valideren laat de oude sleutel
staan; opslag- en ontsleutelfouten worden expliciet gemeld. De encryptiesleutel
wordt niet automatisch geroteerd. Er bestaat geen route die R2-objecten publiceert.

Verwijderen overschrijft de versleutelde sleutel met een uitgeschakelde instelling;
deze voorkomt ook terugvallen op een eventuele oudere `OPENAI_API_KEY` omgevingswaarde.
Zonder opgeslagen record blijft die omgevingswaarde ondersteund. Nieuwe verbindingen
kunnen daarna opnieuw via dezelfde instellingen worden opgeslagen.

De verbindingstest controleert API-authenticatie via `/models` zonder audio te
maken. Een geslaagde test bewijst nog niet dat een specifiek model beschikbaar is
of dat er voldoende tegoed is; doe daarna één korte uitspraak. Requests hebben
limieten op lengte, duur en gelijktijdigheid per Worker-isolate. Dit is geen globale
kostenlimiet. Foutmeldingen geven geen ruwe upstream-antwoorden of secrets terug.

Audio klinkt alleen in het regievenster. Ontvangen MP3 wordt volledig gedecodeerd;
mond/ondertitels volgen de echte afspeelduur met benaderde teksttiming. Stop annuleert
fetch/playback en negeert late callbacks. Autoplayblokkering biedt expliciet afspelen;
contextonderbreking biedt hervatten van dezelfde bron. Showvensters ontvangen visuele
klokupdates en snapshots met de pauzestatus. Neem in OBS ook het regiegeluid op.

Three.js 0.180.0 is lokaal gebundeld en wordt alleen
voor de skeletberekeningen gebruikt; de actieve renderer is Canvas2D.
Bij dependencywijzigingen: `npm ci` en `npm run build`.

`node scripts/check-studio25d.mjs [uitvoermap]` tekent de werkelijke compositor met
`@napi-rs/canvas`. Het controleert negen shots, stilstaande pixels bij pauze,
animerende balletjes, cameraovergangen tijdens pauze, atomaire resize, transparante
overlay en blauwe achtergrond. Visuele renders controleren deskocclusie, LED-inhoud
en mobiele compositie. Gemeten in de uitvoeromgeving: ongeveer 9 ms mediaan en 14 ms
p95 per frame op 1280×720. Dit is geen meting op een mobiele browser.

Deze behouden browserapp met eenvoudige Worker heeft hier geen ondersteunde browserpreview. Browserstemmen,
de nauwkeurigheid van spraak/mondtiming en prestaties op het gebruikersapparaat en het complete browservenster zijn daarom
niet in een echte browser gevalideerd.

`node --test scripts/check-speech-mouth.mjs` controleert de geschatte timing,
woordgrenzen, pauzes en gesloten mond bij stoppen. `node scripts/check-festive-mouth.mjs`
controleert het ongewijzigde beeld buiten de mond, ronde/brede mondvormen, onmiddellijk sluiten, de geladen feestprops, negen
Sinterklaasshots en dat bij snel wisselen het laatst gekozen decor wint.

## Eerdere 3D-versie

Twee oudere karaktermodellen staan in `legacy/assets` en gaan niet meer mee in het
webpakket. De eerdere Three/WebGL-modules, studiomesh en geanimeerde Meshy-modellen blijven
in de bron bewaard. Ze worden niet door de huidige interface geladen of aangeboden.
De bijbehorende `check-showtime.mjs` en `check-character.mjs` controleren die historische
3D-implementatie, niet de nieuwe standaardstudio.

`node --test scripts/check-bingo-board.mjs` controleert alle 75 posities,
verlichting na een voltooide trekking, behoud van oude getallen, reset, twee
themas, cacheverversing en de regie als enige bron voor trekkingsuitslagen.

`node --test scripts/check-openai.mjs` controleert toegangscontrole, invoerlimieten,
ontbrekende sleutel, serverkeuze van Ballad, antwoordverwerking, geheimhouding,
annuleren, late responses, autoplayherstel en pauze/hervatten met gecontroleerde
API- en audiomocks. Een echte OpenAI-aanvraag en device-audioproef zijn pas mogelijk
nadat de sleutel is ingesteld; mocks vervangen die laatste controle niet.

`node --test scripts/check-show-director.mjs` controleert de onafhankelijke
voorvertoning, alle 75 unieke ballen, commit bij onthullen, pauze/hervatten,
onderbroken en afgewezen bingo, de verplichte goedkeuringscontrole, spraakwachttijd
en automatisch cameraverloop. `node scripts/check-show-graphics.mjs [uitvoermap]`
rendert twaalf showmomenten in beide studio’s en controleert dat knipperen alleen
de oogpatches verandert en daarna de oorspronkelijke pixels herstelt.

`node --test scripts/check-dashboard.mjs` controleert paginawissels zonder een
lopende trekking te resetten, menutoestand, compacte monitorbediening, de uitklapbare
regieopties en de zelfstandige showweergave. `node scripts/check-finale-layer.mjs`
vergelijkt Vlampies silhouet met en zonder publieksanimatie in twee studio’s en twee
shots; de controle detecteert ook het oorspronkelijke overschilderen van de hand.

`node --test scripts/check-secrets.mjs` controleert AES-GCM roundtrips, verschillende
nonces, verkeerde mastersleutel, eigenaarstoegang, cross-origin blokkering,
vooraf testen, behoud bij afwijzing, opslagconflicten en uitgeschakelde fallback.


## Live belmomenten met Vlampie

Regiekamer → Bellen bevat de gastenwachtrij, geluidscheck, oproep en livebediening.
Spellen → Showproductie → Belmomenten bevat de aanmeldinstellingen en de beveiligde
TURN-configuratie. Spelers melden zich vrijwillig aan; voor kinderen bevestigt een
ouder/verzorger toestemming. Na uitnodigen test de speler lokaal de microfoon en
bevestigt een koptelefoon. De host start daarna de echte verbindingscheck.

Het geactiveerde uitzendvenster ontvangt de microfoon eerst uitsluitend voor een
signaalmeting. De speler bevestigt de teruggestuurde testtoon. In de wachtstand staat
de microfoon uit. Pas na Laat Vlampie bellen, de aankondiging, beltoon en Opnemen
wordt de stem hoorbaar in de uitzending en doorgestuurd naar Vlampie. De ingebedde
YouTube-speler wordt onderbroken; geluid op andere apparaten moet de speler zelf
stilzetten. De show en automatische spraakreacties wachten tijdens het gesprek.
Afronden laat Vlampie afscheid nemen; Direct stoppen en de noodstop sluiten meteen
af. Na een storing blijft de bingo gepauzeerd. Gespreksaudio wordt niet door onze
server opgeslagen; de gekozen stream/OBS-opname kan het uitgezonden gesprek bevatten.

WebRTC zelf heeft geen API-sleutel. Vlampie gebruikt de bestaande versleuteld
opgeslagen OpenAI-sleutel met het Realtime-model gpt-realtime (optioneel
OPENAI_REALTIME_MODEL op de server) en stem Ballad. Productieverbindingen gebruiken
Cloudflare TURN: vul de TURN Key ID en bijbehorende API-token in op de belpagina.
Het token wordt getest en versleuteld in R2 bewaard; browsers krijgen alleen tijdelijke
ICE-inloggegevens. Directe lokale test is een expliciete optie zonder TURN en werkt
niet betrouwbaar tussen verschillende netwerken. De Sites-toegangsinstellingen en
geautoriseerde spelersaccounts blijven van toepassing.

De actieve browser voor de schone uitzending mengt speler en Vlampie voor OBS.
Neem dit browsergeluid precies eenmaal op. De speler ontvangt alleen Vlampie en de
testtoon, niet zijn eigen stem. Houd dit venster actief met audio ingeschakeld.

`node --test scripts/check-calls.mjs` controleert de belstatussen, toegang per rol,
versleutelde instellingen, weigeren, verlopen oproepen, gelijktijdige acties,
verbindingsverlies, showpauze en audiopoorten met gecontroleerde mocks. De overige
show-/productietests bewaken de bestaande functies. Een complete proef met echte
OpenAI/TURN-credentials, twee apparaten op verschillende netwerken, browserrechten
en de OBS-mix is nog vereist vóór gebruik in een echte show.


## Spelersapp: e-mail, boekjes en de live show

De spelersapp staat onder `/spelen` met afzonderlijke routes voor welkom, live,
boekjes, koppelen, spelers, prijzen, meedoen, spelregels en instellingen. De shell
gebruikt Lit en wordt in de bestaande esbuild-build lokaal gebundeld. De studio,
Worker en bestaande showmodules behouden hun architectuur. Pagina's blijven
geplaatst: chat, de YouTube-iframe en de oproepcontroller worden bij navigeren niet
opnieuw aangemaakt. Het livescherm gaat alleen open wanneer de host de show start.

E-mailaanmelding gebruikt een zescijferige code (10 minuten, maximaal 5 pogingen),
een apparaatgebonden verificatiecookie en een beveiligde HttpOnly-sessie van 30 dagen.
Codes zijn HMAC-gehasht, sessietokens gehasht en verzendlimieten staan in D1.
Spelerssessies krijgen nooit hostrechten. Hostrechten blijven uitsluitend gebaseerd
op de door Sites verstrekte identiteit en VLAMPIE_ADMIN_EMAIL. Een geverifieerd oud
spelersaccount met hetzelfde e-mailadres behoudt zijn oorspronkelijke account-id
(en daarmee boekjes/moderatorrechten); dit geldt niet voor de hostidentiteit.

Stel in de studio bij **Koppeling & stream → Spelerslogin · e-mailcodes** een
Resend-sleutel en geverifieerd afzenderadres in. Die sleutel wordt met de bestaande
VLAMPIE_SETTINGS_KEY versleuteld opgeslagen. RESEND_API_KEY en PLAYER_MAIL_FROM
zijn optionele serverfallbacks. De opslaanknop verstuurt geen e-mail: vraag daarna
zelf een echte inlogcode aan om afzenderverificatie en aflevering te testen.
De Sites-audience wordt niet gewijzigd: deze Site is nog eigenaar-privé. Externe
spelers hebben pas toegang wanneer de eigenaar de Site daarvoor openstelt. Alle
app-API's behouden hun eigen authenticatie en autorisatie.

Nieuwe spelers voeren voornaam en geboortedatum in. Leeftijd wordt op de server
berekend, en geboortedata komen niet in chat/uitzending terecht. Oude profielen met
alleen leeftijd blijven werken. Bij migratie kan men een bestaand profiel kiezen,
ook wanneer het account het maximum van 30 spelers al heeft bereikt.

Het QR-doel wordt als tijdelijke formulierintentie op dit apparaat bewaard door
inloggen/onboarding heen en pas gewist na bevestigde kaartkoppeling of expliciet
annuleren. Kaartmarkeringen, rustige animaties en scherm-aan-voorkeur zijn lokale
apparaatvoorkeuren; kaartnummers en bingocontrole blijven servergestuurd.
De microfoontest stopt zijn tracks na zes seconden en bij verlaten van de pagina.
Een oproep blijft beschikbaar boven iedere pagina; opname/broadcast vereist de
bestaande expliciete toestemming en opneemactie.

Controleer met `node --test scripts/check-player-auth.mjs` de OTP-/sessiebeveiliging,
legacy-migratie, leeftijdsberekening, kaart-, chat- en beltoegang. Na `npm run build`
controleert `node scripts/check-player-app.mjs` de werkelijk gebundelde Lit-app met
een DOM-harnas: OTP → profiel → QR koppelen, kaarten afstrepen, blijvende controllers,
live-only toegang, sessieverlies en uitloggen. Het harnas gebruikt mocks en is geen
visuele browser-, echte e-mail- of WebRTC-proef.


## Showwerelden (versie 35)

De schakelaar **Showhost** bovenin en **Studio & beeld** selecteren Vlampie, Rocco Royale (Royale Theatre) of Milo Magico (Moonlight Atelier). De keuze wordt bij het actieve spel opgeslagen. Studio, camerastandpunten, scènes, logo-overgangen, minigames, spelersapp, OTP-afzender, herinneringskaart, AI-persoonlijkheid en A5-PDF volgen dezelfde `brandId`. Tijdens een actief belmoment of stemvoorbereiding blijft de identiteit vaststaan.

`server/show-brands.js` is het gedeelde register; de build kopieert dit naar de browser. Protocolnamen, accountcookies en boekjecodes blijven stabiel. Wisselen verandert geen kaartnummers, loting of uitslagen. Eigen geschreven tijdlijnteksten blijven behouden; bekende standaardintroducties wisselen mee.

Onder Studio & beeld → Alle scènes staat **Exporteer huidige scène · 8K**: 7680 × 4320 JPEG. Afbeeldingsbronnen zijn niet native 8K; de artworkbundels bevatten exacte originelen plus expliciet gemarkeerde Lanczos-upscales. De interactieve show gebruikt geoptimaliseerde WebP-platen en transparante PNG-hosts met bewegende mond/mesh. Bronprompts en werkelijke resoluties staan in de manifesten bij `public/assets/hosts`.

Validatie: `node scripts/check-brand-contract.mjs` controleert rechten, belblokkering, behoud van speldata, identiteit in prompts/regels en vier A5-templates. `node scripts/check-show-worlds.mjs <qa-map>` rendert 54 scènes/minigames en controleert 8K-export; dit gebruikt de primaire runtime canvas-library. Live OpenAI/TURN/e-mail blijven afhankelijk van de ingestelde providers.

## Bingo Studio redesign · versie 37

De bestaande show-engine en opslag zijn behouden. De operatorinterface heeft nu
één geconsolideerde shell in `public/studio-redesign.css`; de oudere losse shell-,
premium-, chat-layout- en polish-stylesheets worden niet meer in de host geladen.
Shows/planner/catalogi gebruiken `show-admin-redesign.css`, de spelersapp gebruikt
`player-redesign.css`. De bestaande Lit 3-basis is uitgebreid met een interactieve
`studio-home`-component voor Overzicht en Concept & startcheck. De build bundelt
zowel de spelersapp als deze component met esbuild.

Rocco is de standaard bij een nieuwe lokale studio of ongebonden spelerssessie.
Een al gekozen show/host blijft leidend. De hostkeuze staat bij Host & decor.
De regiekamer blijft de standaardroute; Overzicht is bereikbaar via de eerste
menuknop. Command-zoeken opent met Ctrl/Cmd+K. Een open dialoog blokkeert globale
show-sneltoetsen, zodat Escape in zoeken de uitzending niet stopt.

Mijn shows opent op een eigen overzicht, met vaste tabs voor rondes, boekjes,
deelnemers, uitzending, minigames, uitslagen en instellingen. Het draaiboek en de
herbruikbare bibliotheek hebben aparte bestemmingen. De spelersapp heeft vier
hoofdbestemmingen: Show, Boekjes, Spelers en Account. De echte QR/OTP-, chat-,
microfoon-, bel- en BINGO-flows blijven aangesloten op dezelfde API's.

Bij een dubbele gelijktijdige create-aanvraag wordt één hostgebonden show
opgeslagen. Er zijn geen databaseschema- of toegangsbeleidswijzigingen gedaan.

De startcheck in Overzicht maakt onderscheid tussen opgeslagen voorbereiding,
zelf bevestigde techniekcontrole en de nog uit te voeren live generale repetitie.
De nieuwe indeling is gecontroleerd met DOM-/backendtests en een productiebouw.
Visuele browser-QA was tijdens deze wijziging niet beschikbaar. De lokale
100-account/400-boekjes-tests vervangen geen belastingproef met echte apparaten.
