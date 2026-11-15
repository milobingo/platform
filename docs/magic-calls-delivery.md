# Milo: winnaars bellen en Magische Belletjes

Technische basis: staging draaide bij aanvang commit `669729e73e4c559c9db32730e8fc69a0c1b75ed9`, release `43737000059-1`. Er is doorgebouwd op deze versie en op de bestaande spelserver, LiveCallStore, LiveKit-ruimten, showrunner en OBS-uitvoer. De uitbreiding gebruikt de bestaande JSON-opslag; er is geen nieuw belsysteem of databaseschema.

## In de regie

- Zet in **Draaiboek → Rondes & patronen** per ronde **Bel de winnaar van de volle kaart** aan. Ontbrekend of uit betekent geen automatische winnaaroproep. De startcheck noemt de gekozen rondes. De definitieve uitslag moet eerst in beeld én geluid zijn bevestigd.
- Nieuwe Milo-shows en de première bevatten twee **Willekeurig belmoment**-blokken. In bestaande concepten voeg je ze bewust toe met **Twee magische belletjes klaarzetten**. Je kunt de blokken naar andere veilige pauzes verplaatsen. Bestaande gepubliceerde of lopende shows worden niet aangepast.
- Klik na de laatste draaiboek-/stemwijziging op **Audio voorbereiden**. Ook de vaste belteksten voor alle twaalf Milo-presentatoren worden dan voorbereid en in het uitzendvenster geladen. Tijdens een voorbereid gesprek is geen nieuwe spraakgeneratie of live AI-sessie nodig.
- De vaste **Belkaart** naast Program/Preview behandelt zowel de automatische als handmatige route. Handmatig plannen bewaart de bewerkbare controlekaart meteen. Het gezin spreekt eerst privé met regie, geeft afzonderlijk live-akkoord en wordt daarna uitsluitend met een bewuste regieklik live gezet.
- Het kind kiest sterren of bubbels op de telefoon, of zegt het hardop waarna regie dezelfde keuze tikt. De server staat slechts één uitvoering van het gekozen effect toe. **Bedank & sluit af** speelt de voorbereide afsluiting; **Stop gesprek** grijpt direct in.
- Terugkeer vereist gecontroleerd beeld én geluid. Ook weigeren, niet opnemen en uitval houden de trekking vast nadat een uitnodiging is gestart. Daarna kiest regie bewust hervatten, de volgende ronde of na de finale de afsluiting. Een eerdere handmatige pauze blijft behouden.

De voorbereide begroeting is algemeen; de gecontroleerde roepnaam staat op de controlekaart en op beeld. Voor spontaan uitspreken van de naam kies je expliciet het AI-gesprek. Privéaudio gaat nooit naar de AI of uitzendmix. Twee geplande willekeurige kansen garanderen geen twee geslaagde gesprekken; een onbereikbaar kind wordt niet vervangen of opnieuw geloot.

## Technische controle

De gerichte lokale controles omvatten echte kaartvoltooiing en officiële meldvensters in alle vier rondes, eerder voltooide kaarten die later worden gemeld, gelijke bingo met het bestaande beslisspel, aparte troostprijzen, winnaaroproepen aan/uit, niet beschikbare winnaars, unieke willekeurige selectie, duurzame selectie na fouten, twee regietabs, toestemming intrekken, gescheiden audiobussen, expliciet live-akkoord, eenmaal magie en terugkeer met behoud van de 15-secondenklok.

- `tests/check-magic-call-cues.mjs`: 24/24 geslaagd, waaronder gelijktijdige uitnodigingen uit twee tabbladen op een echte, tijdelijke PostgreSQL-database. De database/container is na de test verwijderd.
- `tests/check-obs-access.mjs`: 16/16 geslaagd, waaronder een integratietest op dezelfde geïsoleerde PostgreSQL-installatie; voorbereide media-acties blijven beperkt tot de gebonden OBS-bron.
- `tests/check-winner-call-results.mjs`: acht echte kaart-/vensterscenario's, vier rondes met en zonder gelijke hoofdprijsbeslissing.
- `tests/check-show-call-cues.mjs`: negen controles van aankondiging, blokkades, eenmalige uitnodiging, veilige pauzes en het vervolg na de finale.
- `tests/check-call-rundown.mjs`: nieuwe en bestaande plannen, maximaal twee momenten, Vlampie-isolatie en alle vaste belteksten.
- Nieuwe browsercontroles gebruiken de echte regie-/gezinscomponenten met fictieve gezinnen en expliciet gesimuleerde media. Ze behandelen mobiel 320/390 px, controlekaart opslaan/fout/herladen, een tweede presentator, privé/live, weigeren, niet opnemen en verbindingsverlies. Bestaande browsercontroles blijven ook de tien prijsstappen, interval/pauze/herladen, showvoorbereiding en Vlampie controleren.

De bestaande Sites-omgeving bevat een gekoppelde klikdemo op `/bel-demo`: desktop en mobiel, succes, weigeren, niet opgenomen en verbindingsverlies. De demo is herkenbaar een simulatie en benadert geen deelnemers of providers. De toegang van de bestaande Site wordt behouden.

## Nog echt repeteren

De technische tests hebben **geen echte kinderen, kijkers, Cloud-gesprekken, OpenAI-sessies, YouTube-stream of OBS-installatie** gebruikt. De PostgreSQL-transacties zijn wel daadwerkelijk uitgevoerd. Browseraudio en geïsoleerde audiobussen zijn technisch getest; dit is geen bewijs van een fysieke OBS-mixer of echte livestream.

Er zijn voor deze uitbreiding geen nieuwe GitHub-variabelen, secrets of Supabase-projecten nodig. Gebruik de bestaande centrale OpenAI-koppeling, stemmen per presentator en de eigen geteste LiveKit Cloud-instellingen. Bereid de showaudio expliciet voor en gebruik de juiste YouTube-video-ID en OBS-link van de show.

Repetitie blijft nodig met een volwassen testgezin op een tweede apparaat, headsets, LiveKit Cloud, YouTube-vertraging en een echte OBS-proefopname. Controleer privé versus live met afzonderlijke tracks, geen eigen stem terug, hoorbaar laatste nummer, zichtbaar en hoorbaar terugkeren, dempen, toestemming intrekken en netwerkuitval. De procedure staat in [live-calls-rehearsal.md](live-calls-rehearsal.md).
