# 02 · Bestellingen en mail — herstelwerk na Sites v70

**Uitgangspunt:** Sites v70, commit `f81d0c1c60cbe1422d43ce46d896af6cd4d2939c`. In v70 werken de negen bestaande eventmails en vier handmatige campagnes met een providerstub; echte aflevering is niet bewezen. De prijsmail is een bestaand voorbeeldtemplate zonder automatische koppeling. Onderstaande werkzaamheden staan **open**. Bij overname in een andere stack zijn bestandspaden referenties naar het Sites-prototype, geen voorschrift voor de doelarchitectuur.

| Volgorde | Ticket | Blokkeert |
|---|---|---|
| 1 | ORD-01 Tijd, sluiting en start | Bestellingen en echte show met uitgegeven boekjes |
| 2 | ORD-02 Eigenaarschap en uitgifte | Gekoppelde boekjes, PDF-download en speltoelating |
| 3 | MAIL-01 Wachtrij en veilige retry | Echte servicemails en marketing |
| 4 | ORD-03 Betaalreconciliatie, verplaatsen en terugbetalen | Betaalde deelname |
| 5 | MAIL-02 Servicetriggers en bevestigde prijs | Echte order-/winnaarscommunicatie |
| 6 | MAIL-03 Toestemming, afmelden en bezorging | Nieuwsbriefcampagnes en vrijgave mail |

Begin met een regressietest die het probleem op de uitgangsversie aantoont. Maak de correctie klein, behoud beide merkwerelden en test elke overgang ook rechtstreeks via de server. Gebruik twee of meer fictieve gezinnen, verschillende merkwerelden en vaste testklokken. Werk met providerstubs en testdomeinen; voer hier geen echte betaling, provideractie, campagne of verzending naar bestaande gezinnen uit.

## ORD-01 · Eenduidige showtijd en vergrendeling

**Aanleiding:** `frontend/App.jsx:146` geeft een lokale datum zonder zone door. `server/bingo-order-model.js:11–14` interpreteert die op een UTC-runtime anders. `server/bingo.js:96` laat starten zodra er één toegelaten boek is, ook als andere orders in betaalcontrole staan; goedkeuring wordt na de start geweigerd.

- Bewaar een canoniek UTC-tijdstip plus `Europe/Amsterdam` als showzone; accepteer geen impliciete runtimezone aan de API-grens. Toon in regie, familie, PDF en mail dezelfde lokale datum, tijd en deadline. Scheid de besteldeadline van showstart; bepaal voor de deadline één serverklok en grensregel.
- Signaleer ontbrekende of dubbelzinnige lokale tijden bij zomertijd. Breng oude zonevrije tijden in kaart. Gebruik alleen een Nederlandse interpretatie als de oorspronkelijke intentie aantoonbaar is, laat uitzonderingen controleren en migreer herhaalbaar met een uitdraai voor en na. Verschuif geboekte shows niet stil.
- Introduceer een serverpoort voor start en definitieve toelating. Laat regie open betaalcontroles en betaalde boekjes zonder uitgifte zien. Hanteer een expliciete gecontroleerde oplossing vóór start: uitgeven, verplaatsen, terugbetaling registreren of terugbetalingsroute formeel in gang zetten volgens afgesproken beleid. Een betaald gezin mag niet stil buiten het spel vallen. Trekking en uitgifte mogen niet tegelijk langs de startcontrole glippen; toets de actuele revisie atomair.
- Scheid een vastgelegde toegangs-/boekjessnapshot voor het spel van de administratieve orderhistorie. Houd na de start reconciliatie en klantoplossing mogelijk zonder alsnog stil een kaart aan de lopende ronde toe te voegen.

**Acceptatie:** op een UTC-runtime is een show op 18 november om 13:30 Amsterdam opgeslagen als 12:30 UTC en is een deadline om 13:30 om 13:31 Amsterdam verstreken. Test winter, zomer, niet-bestaand en dubbelzinnig lokaal tijdstip, precies op de deadline, en gelijktijdig starten en goedkeuren. Bij een nog niet afgehandelde betaalmelding blokkeert start met een bruikbare foutmelding; na oplossing komen boekje, order en startcontrole overeen.

## ORD-02 · Boekjes, downloads en gecontroleerde reparatie

**Aanleiding:** via algemeen boekbeheer kan een aan een betaalde order gekoppeld blad van gezin A naar gezin B gaan; A behoudt een status afgerond maar zijn PDF geeft 409, terwijl B het blad kan downloaden. Zie `server/production.js:32–37` en `server/bingo-orders.js:57–59`.

- Maak show, eigenaar en orderrelatie onderdeel van de serverinvariant. Blokkeer overdracht via algemeen boekbeheer voor uitgegeven orderbladen. Verifieer voor losse PDF én order-PDF de actuele show, eigenaar, geldigheid en boektoelating waar die vereist is.
- Houd aanpassen van het kind **binnen** hetzelfde gezin gescheiden van een eigendomsoverdracht. Houd een eventuele correctieroute voor regie expliciet, bevoegd, gelogd en afgesloten na spelstart. Genereer bij een toegestane heruitgifte één geldige set; trek oude codes in volgens beleid. Gebruik geen bestaande downloadlink als zelfstandig bewijs van eigendom.
- Borg idempotente uitgifte: herhaald goedkeuren mag geen tweede boekje, QR-code of bevestigingsmail opleveren. Kleur- en zwart-wit-PDF's hebben hetzelfde boeknummer, dezelfde kaarten en dezelfde koppeling. Een mailstoring mag nooit een al uitgegeven kaart opnieuw genereren.

**Acceptatie:** twee gelijktijdige goedkeuringen geven één boekjesset; beide afdrukversies geven dezelfde speelgegevens en leesbare QR. Toegestane koppeling aan een ander kind in A werkt voor het relevante moment; directe verplaatsing naar B en downloaden door B worden geweigerd. Bestaande gedocumenteerde toegestane correcties blijven werken en zijn aantoonbaar gelogd.

## ORD-03 · Afhandeling van betalingen, wijzigingen en refunds

**Aanleiding:** `payment_reported` is een melding van een ouder, geen betaald feit. Betaling en annulering kunnen kruisen; een al aangeboden betaallink blijft buiten de app mogelijk werken. Datum wijzigen is nu geblokkeerd zodra er een boek of actieve order is. Zie `server/bingo-order-model.js:53–86`, `server/bingo-order-mail.js:53,65–72` en `server/bingo.js:71`.

- Leg per overgang vast wie die mag uitvoeren en welk bewijs vereist is. Scheid link uitgegeven, betaling gemeld, betaling geverifieerd, uitgifte, annulering vóór betaling, terugbetaling vereist/in behandeling/geverifieerd en verplaatsing. Sluit aan bij het bestaande statusmodel met een expliciete migratie en overgangstabel. Gebruik het geverifieerde bedrag, de valuta en de orderreferentie; voorkom dat twee orders aan één betaling worden gekoppeld.
- Een betaalde of vermoedelijk betaalde order mag niet ongemerkt in een definitief verliesgevende status eindigen. Hercontroleer link-/orderstatus vóór verzending. Vervang of trek links in voor zover de gekozen betaalroute dat werkelijk ondersteunt. Als een link eenmaal bij de provider ligt, beloof geen ongedaanmaking van een aangeboden e-mail. Behandel betaling op een oude link via reconciliatie; laat boekjes niet automatisch opnieuw vrijkomen.
- Bied een afzonderlijke bevoegde operatie voor showverplaatsing of annulering met previews, wijzigingshistorie, veilige mapping naar nieuwe show en keuze voor terugbetaling waar van toepassing. Houd financiële handelingen controleerbaar met auditlog zonder onnodige PII. Als provider/webhook wordt gekozen: verifieer handtekening, merchant, order, bedrag en valuta; verwerk dubbele en niet op volgorde ontvangen events zonder dubbele uitgifte/refund. Tot echte koppeling: houd verwerking handmatig verifieerbaar en label simulatieresultaten.
- Afhankelijkheid: deelnamevorm door organisatie laten beoordelen vóór betaalde deelname wordt aangezet. De technische test vereist geen echte verkoop. Gebruik voor dit traject geen deelnemersgeld of productielinks.

**Acceptatie:** kind/gezin kan eigen melding doen maar zichzelf niet als betaald markeren. Late bevestiging na annulering creëert een zichtbaar reconciliatiegeval en geen speelrecht. Een dubbel providerbericht leidt niet tot een tweede mutatie. Bedrag-/referentiemismatch vraagt controle. Verplaatsing met bestaande betaalde order behoudt orderhistorie en juiste rechten; terugbetaling is pas voltooid na bewijs. Een mislukte terugbetaling blijft zichtbaar en opnieuw te behandelen.

## MAIL-01 · Herstelbare wachtrij en deduplicatie

**Aanleiding:** onderbreking vóór providercontact laat `pending` onbeperkt staan. Een marketingmail met oude verzendfout kon na het uitzetten van de nieuwsbriefmodule via retry alsnog naar de providerstub. Zie `server/mail-service.js:27–63,93–104,116–120` en `server/mail-api.js:72–74`.

- Koppel duurzame enqueue van operationele mail aan de succesvolle domeinactie, of herstel systematisch een ontbrekend enqueue-record via het domeinevent. Gebruik een vaste identiteit per merk, ontvanger, doelobject, eventversie en template. Gebruik geen mail- of linkinhoud als identiteitsbewijs. Een ontvanger krijgt een eigen bericht.
- Maak onderscheid tussen klaar voor verzending, geclaimd met vervallende lease, aanbieding in uitvoering, geaccepteerd, aantoonbaar niet geaccepteerd, onzekere uitkomst, geblokkeerd en (alleen met bewijs) bezorgd of gebounced. Een hervatter neemt alleen veilig te claimen records over via atomaire overgang. Geen automatische replay na onzekere acceptatie zonder reconciliatie of een door de provider gedocumenteerde deduplicatiegarantie.
- Pas dezelfde beleidscontrole vlak vóór providercontact toe bij de eerste poging, automatische verwerking én handmatige retry. Voor marketing: module nog aan, actieve toestemming voor juiste merk, geen onderdrukking, geldige campagne/ontvanger. Registreer een geblokkeerd resultaat met reden. Markeer provideracceptatie niet als inboxbezorging.
- Gebruik batches, beheers retrytempo en voorkom dubbele afhandeling bij parallelle workers. Maak voor regie onderscheid tussen veilig opnieuw proberen en eerst onderzoeken. Bewaar alleen benodigde metadata en verberg inlogcodes, betaallinks, mailadressen en kindgegevens in logweergave en debug-uitvoer. Leg bewaartermijnen en toegang vast.

**Acceptatie:** injecteer uitval (a) vóór claimen, (b) na claimen maar vóór providercontact, (c) na mogelijke provideracceptatie maar vóór opslag van het resultaat. A en veilig herkenbare B worden éénmaal opgepakt, C leidt niet tot dubbel versturen. Twee workers versturen één bericht. Na afmelding of uitschakelen gaat een eerder voorbereid bericht en een oude retry naar geblokkeerd zonder providercall. Een werkende, afzonderlijke servicemail blijft verwerkbaar als marketing uitstaat.

## MAIL-02 · Servicemails op de juiste acties

**Aanleiding:** v70 heeft showwijziging alleen als opt-in-campagne; een geboekt gezin zonder nieuwsbrief mist een wijziging. De bestaande prijstemplate is nog niet gekoppeld. Gebruik de actuele v70-templatecatalogus en behoud bestaande shortcodes, Nederlandse tekst en merkstijl.

| Event na definitieve servermutatie | Ontvanger | Wanneer en wat |
|---|---|---|
| Show verplaatst | Volwassen boeker met relevante actuele order/boeking | Oude en nieuwe datum in Nederlandse tijd, uitleg over bestaande boekjes en route voor hulp/terugbetaling |
| Show geannuleerd | Volwassen boeker met relevante order, ook als refunds nog lopen | Feitelijke annulering en duidelijke actuele vervolgstap; geen reclame |
| Terugbetaling afgerond | Volwassen boeker van die order | Na verifieerbare bevestiging, met bedrag en orderreferentie; een aanvraag is nog geen afronding |
| Prijs bevestigd en gepubliceerd | Volwassen accountbeheerder van de gerechtigde deelnemer | Zodra definitieve serveruitslag gepubliceerd is. Geen mails bij claim, voorlopige winnaar of minigame. Voor eventuele troostprijzen alleen met duidelijk vastgelegd beleid en een eigen prijs-ID |

- Houd marketingcampagnes voor herinnering, wijzigingsnieuws, bedankje en nieuwsbrief herkenbaar als handmatige opt-in-mail. Een operationeel showbericht wordt door de showactie bepaald en niet door nieuwsbriefstatus. Laat de regie-UI de twee routes en aantallen duidelijk onderscheiden. Voorkom een dubbele feitelijke mededeling als beide routes voor hetzelfde event zouden worden gebruikt.
- Lever gedocumenteerde, per template toegestane shortcodes en valideer verplichte velden bij opslaan én renderen. Gebruik uitsluitend serverbevestigde gegevens, escaping en tekstalternatief; verwerp onveilige links. Handhaaf het veiligheidscontract van de inlogmail. Test merkgebonden logo, afzender en linkbasis; voeg geen onnodige persoonsgegevens toe.
- Deduplicatie op definitieve event-/resultaat-ID en ontvanger, ook na herladen of opnieuw publiceren. Slechts één hoofdprijsmail per resultaat; definieer apart wat er gebeurt bij herziening. Verzendlog mag nooit de prijsbeslissing of ordermutatie terugdraaien.

**Acceptatie:** het gezin zonder nieuwsbrief krijgt precies één operationeel verplaatsingsbericht, geen campagne. Een voorlopige bingoclaim doet geen providerpoging. Publicatie produceert één prijsmail voor het juiste volwassen account en niemand anders; herhaling, browserrefresh en providerretry wijzigen de uitslag niet. Onderwerp, tekst, knop, shortcodes en afzender zijn juist voor beide merken; lege verplichte waarden mislukken zichtbaar en veilig.

## MAIL-03 · Toestemming, afmelding en echte repetitie

- Nieuwsbriefmodule standaard beschikbaar, deelname standaard uit. Registratie van expliciete opt-in per merk met tijd en versie; afmelding voor Milo mag Vlampie niet afmelden, of andersom. Respecteer merkvoorkeuren en provideronderdrukking. Houd de afmeldlink zonder accountlogin bereikbaar op het echte maildomein; een scanner die alleen een link opent mag de voorkeur niet wijzigen. Test de bevestigde afmeldactie.
- Bewaar het campagneproces concept → ontvangers voorbereiden → bewuste start. Bevestig met een fictieve deelnemersset de telling en dat een afmelding tussen voorbereiden en versturen werkt. Geen campagne of nieuwe automatische planning activeren als onderdeel van deze codeoverdracht.
- Oefen eerst volledig met stubs. Pas bij expliciete toestemming en ingestelde provider: afgesproken volwassen testadressen, gecontroleerde afzender en publiek bereikbare HTTPS-assets; bekijk Gmail/Outlook en mobiel, HTML en platte tekst, met afbeeldingen uit. Controleer inlogcode, betaal-/accountlink, afmeldlink, mislukte aanbieding, inboxacceptatie en bounce. Provider-ID en testtijd zijn bewijs; log geen code of betaal-URL. Werk met een gereserveerde testontvanger, nooit de productielijst.

**Vrijgavebewijs:** documenteer geslaagde regressies per ticket, migratie- en terugvalplan, eventuele handmatige reconciliatiestappen, de afzonderlijke go/no-go voor betaling en mail, en wat echt gerepeteerd is tegenover wat nog gesimuleerd is. Publiceer of verstuur niets als onderdeel van deze overdracht.

