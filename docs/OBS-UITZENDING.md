# Het uitzendbeeld in OBS

Open in de aangemelde regie de gewenste Milo-show en kies **Overzicht → Uitzending testen**. **Open uitzendvenster** opent de gekozen show. **Kopieer OBS-link** opent het beheer van de aparte OBS-link; maak de link zo nodig bewust aan en kopieer hem. Houd de regiepagina open. Vlampie behoudt de route **Studio & camera’s → OBS-browserbron**.

Voeg in OBS een **Browserbron** toe, plak de OBS-link en stel **1920 × 1080** in. Zet **Audio beheren via OBS** aan. De link werkt zonder Google-aanmelding in de OBS-browser. Beeld en geluid starten automatisch zodra de juiste regie is verbonden. De browserbron vraagt bij normaal starten of tijdelijk verbindingsverlies geen klik. Audio wordt pas bevestigd nadat een kort testgeluid werkelijk is afgespeeld. Alleen als de browser automatisch geluid echt blokkeert, blijft een kleine melding met de fallback **OBS → Bronnen → rechtsklik → Interactie → Beeld & geluid activeren** zichtbaar; het beeld wordt daarbij niet afgedekt of wazig gemaakt.

Kies vervolgens **Speel testgeluid** in de regie. Dit geluid gebruikt dezelfde uitzendmix als de presentator. De voorbereiding toont drie afzonderlijke controles: verbinding met deze show, audio in het uitzendvenster en jouw OBS-controle. **Geluid afgespeeld** bewijst nog geen ontvangst door OBS. Controleer de meter van de juiste bron in de OBS-mixer, maak een korte proefopname met beeld en testgeluid en luister die terug. Vink beide OBS-controles pas daarna aan. Een browseropname vervangt deze controle op de echte OBS-computer niet.

Gebruik je **Vensteropname**, open de OBS-link dan in een aparte browsertoepassing zonder regie- of backstagetabs. Activeer beeld en geluid en kies **OBS → Bronnen → + → Vensteropname**. Leg alleen deze uitzendbrowser vast met **Toepassingsaudio vastleggen** en zet algemene desktopaudio uit. Gebruik de Browserbron als audio per toepassing niet beschikbaar is. Privé-audio uit regie of backstage hoort buiten de uitzendmix te blijven.

Bij tijdelijk verbindingsverlies herstelt de OBS-browserbron automatisch de gekozen show, het beeld en de officiële spelstand. Ook een tijdelijke fout bij het controleren van de OBS-link wordt automatisch opnieuw geprobeerd. Een regulier browservenster houdt daarnaast **Opnieuw verbinden** beschikbaar. Pauze, BINGO-meldvensters en belblokkades blijven behouden. Controleer bij een verlopen of ingetrokken link het linkbeheer in de regie. Test stem, gastgeluid, mute, noodstop en terugkeer naar de show afzonderlijk tijdens een echte repetitie.

## Geldigheid en vervangen

Een link is zeven dagen geldig en hoort bij één show. Per regieaccount is één link actief; een link voor een andere show vervangt de vorige. **Nieuwe OBS-link maken** en **OBS-link intrekken** vragen een bevestiging wanneer er al een actieve link is. De server geeft de volledige link alleen direct na het maken terug. Ben je hem kwijt, maak dan een nieuwe.

Na intrekken, vervangen of verlopen weigert de server verdere aanvragen met de oude link. Een ongeldige link wordt niet door automatisch herstel opnieuw geldig; maak daarvoor in de regie een nieuwe link en vervang de URL van de Browserbron. De gewone OBS-browserbron stopt dan beeld en geluid; bij een netwerkstoring wacht zij op een geldige verbinding. Een al uitgegeven verbinding met een externe audioprovider heeft daarnaast haar eigen opruiming en vervaltijd. Intrekken hervat geen trekking en heft geen onzekere belblokkade op.

De gewone knop voor een uitzendvenster in je aangemelde browser blijft beschikbaar. Gebruik voor OBS de apart gemaakte link, niet alleen `/uitzending`.

## Toegang en opslag

De link geeft alleen toegang tot het gepubliceerde uitzendbeeld, de actuele stemclip en het uitzendgedeelte van een live gesprek voor de gekozen show. Hiermee kun je geen regie voeren, andere shows lezen, backstage meeluisteren, instellingen wijzigen of sleutels opvragen. Privépersonagegegevens en gastadministratie worden uit het antwoord verwijderd. De regiesessie blijft afzonderlijk met Supabase gecontroleerd.

Het toegangsbewijs staat achter `#obs=` in de link; de browser stuurt het voor de beperkte uitzendroutes in een aparte header. Het staat niet in queryparameters, cookies of lokale browseropslag. De server bewaart alleen een willekeurige identificatie, een hash, show en geldigheid in de bestaande uitzendopslag. Er zijn geen nieuwe accounts, omgevingsvariabelen, secrets of databasekolommen nodig.

Bewaar de link bij de persoon die OBS bedient. OBS slaat browserbron-URL’s op in zijn scènecollectie; deel zo’n collectie alleen als je die toegang wilt delen. Bij een vermoeden dat de link is gedeeld kun je hem in de regie vervangen of intrekken.

Kies bij een correctie een release die native regiesleutels, OBS-toegang en de actuele showinstellingen ondersteunt. Voor nieuwe standaardshows moet die release ook de officiële vijftiensecondenklok, automatische Milo-regels en versiecontrole bij opslaan behouden.

## Annuleren en langere uitleg

**Show geforceerd annuleren** in de live regie vraagt de exacte shownaam als bevestiging. De server stopt de show definitief, behoudt de officiële nummers, boekjes en uitslagen en verwerkt geen nieuwe meldingen of niet aangekondigde prijsuitslagen. Bestaande uitzendvensters stoppen hun stem, muziek en gespreksaudio en houden de laatste spelstand zichtbaar. Oude tabs kunnen de show niet hervatten. Als externe gespreksaudio nog niet aantoonbaar is gesloten, blijft dat in de regie zichtbaar met **Opnieuw afsluiten**.

De presentator accepteert maximaal **10.000 tekens**. De volledige tekst blijft in de regie staan; langere uitleg wordt na elkaar via dezelfde stem en uitzendmix afgespeeld. Pauze en Stop onderbreken ook de resterende tekst. Een tekst boven de limiet blijft bewaard en geeft een duidelijke melding.

Na een uitrol moet een reeds geopende OBS-browserbron eenmaal worden vernieuwd om de nieuwe appcode te laden. De automatische herstelprocedure verandert geen showpauze, melding of belblokkade. Controle op een echte OBS-installatie blijft nodig: bronmeter, korte opname met beeld en testgeluid, en terugluisteren.
