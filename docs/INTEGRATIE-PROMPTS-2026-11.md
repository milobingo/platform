# Integratie van stagingreparatie, belmomenten en Ontwerp met AI

## Uitgangspunt en samenhang

De technische uitgangsversie was stagingrevision `a1323ef9cc45e1a3373c4c051d9858cb7d67634b`, release `43761454747-1`, configuratie `staging-2026-11-11-v2`. De al aanwezige duurzame winnaaroproepen/twee willekeurige belmomenten en de lokale cache-/verbindingsreparaties zijn behouden.

De drie aangeleverde opdrachten gebruiken dezelfde spelserver, showrunner, providerinstellingen, deelnameprofielen, LiveKit-bediening en uitzendmix. De nieuwste reparatieopdracht gaat bij het belcontract vóór de oudere oproepprompt: Milo verandert YouTube niet en vraagt geen tweede microfoontest of retourformulier. De gezinsapp adviseert de ouder zelf het showvolume te regelen. Vlampies eigen route en regellogica blijven apart.

| Onderdeel | Gevonden probleem | Samenhangende wijziging | Controle |
| --- | --- | --- | --- |
| Audio herstellen | Een lege tabcache leek op ontbrekende voorbereiding. Een lopende show kon op de voorbereidingsmelding vastlopen. | Herstel leest bestaande serverclips; alleen de expliciete voorbereidingsknop mag genereren. Pauze, serverepoch, ballen, meldvenster en belblokkade blijven behouden. | `audio-preparation.spec.mjs`, `check-prepared-show-audio.mjs` |
| Officiële bal | Herhaalde nummertekst, losse audio-/beeldidentiteit en lokale deduplicatie. | Eén Nederlandse nummeroproep, policy `v4-once`, immutable commitbinding en duurzame claims aan regie- én uitvoerzijde. | `check-official-audio.mjs`, `check-output-preload.mjs`, `check-studio-engine.mjs` |
| Bingo en winnaars | Controlezin kon als winnaarbericht klinken; dynamische winnaarcontext kon verouderen. | Eén enthousiaste melding per officieel venster; alleen definitieve uitslag levert naam/prijs/winnaaroproep. Voorbereide veilige alternatieven en resultaatbinding. | `check-winner-call-results.mjs`, `check-magic-call-cues.mjs` |
| Bellen | Oude dubbele controleformulieren en YouTube-automatisering. | Eén belkaart, vooraf geteste apparaatcontext, passieve ontvangstcontrole, afzonderlijk ouderakkoord en bewuste liveknop. Privé, live en afsluiting blijven door de server gescheiden. | `check-live-call-regie-ui.mjs`, `check-livekit-media.mjs`, `family-calls.spec.mjs`, `call-card.spec.mjs` |
| Vastgelopen regie | Geen veilige presentatieherhaling of gerichte noodherstelroute. | Herhaling verandert alleen presentatie. Noodhervatten vereist reden, rechtenintrekking en bevestigde afsluiting; echte spelblokkades kunnen niet worden gewist. | Engine-, output- en callhersteltests |
| AI-ontwerpen | Nog geen complete ontwerproute binnen de bestaande voorbereiding. | Drie duurzame voorstellen, volledige preview, revisies, scèneherschrijving, nieuwe conceptshow en expliciete tekstovername met vergelijking en herstel. | `check-show-design.mjs`, `check-design-client.mjs`, `show-design.spec.mjs` |
| Concept opslaan | Ontbrekende echte prijzen blokkeerden ook een gewone tekstwijziging. | Alleen ongebonden Milo-concepten mogen lege prijskoppelingen bewaren; overige structuur wordt volledig gevalideerd. Start, boekjes en bindende controle blijven strikt. | Werkelijke opslag-/start-/boekjeshandlers in `check-design-client.mjs` |

## Bediening

- **Voorbereiden:** bewerk het bestaande draaiboek of kies **Nieuwe show → Ontwerp met AI**. Een gekozen voorstel wordt een nieuwe conceptshow. Vergelijk afzonderlijke teksten vóór overname in een bestaand concept.
- **Audio:** bereid na de laatste wijziging zelf de vaste audio voor. Door de eenmalige Nederlandse nummeroproep is de audiopolicy veranderd; oude dubbel uitgesproken clips worden niet stilzwijgend gebruikt. Starten of hervatten genereert zelf geen vervangende audio.
- **Uitzending testen:** beoordeel beeldverbinding, geactiveerde uitzendmix en het expliciete testgeluid afzonderlijk. Een verbinding of geslaagd browserfragment betekent nog niet dat OBS het geluid opneemt.
- **Bellen:** het gezin neemt eerst privé op. Na passieve ontvangstcontrole en ouderakkoord kiest de regie bewust live. Sluit het gesprek veilig af en kies daarna het passende vervolg. De finale gaat naar afsluiting.
- **Herstellen:** gebruik presentatieherhaling voor een gewone tekst/cue; gebruik Noodhervatten uitsluitend voor een vastgelopen onderdeel, met een reden. Dit start of trekt geen nieuwe bal.

Er zijn geen nieuwe GitHub-variabelen, secrets, accounts of database-migraties nodig. De AI-route gebruikt de al ingestelde centrale OpenAI-koppeling en bestaande versleutelde private opslag. De regierol blijft vereist. LiveKit heeft zijn eigen beschermde configuratie.

## Bewijs en praktische grens

De lokale offlinepoort bevat 130 controles. Voor browserrepetities worden fictieve gezinnen, synthetische clips en geïsoleerde API-transporten gebruikt; echte deelnemers worden niet uitgenodigd. De AI-providertest is afzonderlijk uitgevoerd met uitsluitend creatieve fictieve briefings en de bestaande centrale sleutel. De gescrubde rapporten staan onder `verification/prompts-2026-11-15/`.

Het bestaande, afgeschermde Sites-prototype heeft de vernieuwde klikbare belrepetitie op `/bel-demo`. Desktop en mobiel zijn doorlopen met succes, weigering, geen gehoor, verbindingsverlies, finale en eenmalige effectkeuze. Alle gebeurtenissen zijn herkenbare simulaties en doen geen provider-/deelnemersaanvragen.

Een echte OBS-installatie en een echt gesprek met afzonderlijke LiveKit-tracks zijn hier niet beschikbaar. Controleer daarom nog op een echte OBS-installatie de bronmeter en een korte proefopname met beeld én testgeluid; luister de opname terug. Repetitie met vrijwillige volwassen testaccounts moet bovendien de echte privé-/live-audioscheiding, afwezigheid van zelfecho, intrekken van toestemming en herverbinden bevestigen. Browseropnames en mocks vervangen die controles niet.

Officiële OBS-instructies: [Browser Source](https://obsproject.com/kb/browser-source), [Audio Mixer Guide](https://obsproject.com/kb/audio-mixer-guide).

## Uitrol

Alleen staging: push de volledige wijziging naar `main`, wacht op groene CI voor exact die SHA, voer de bestaande `Deploy staging`-workflow uit met configuratie `staging-2026-11-11-v2` en verifieer publieke healthrevision/release/config plus hoofdroute. De genoemde uitgangsrevision is het eerdere werkende herstelpunt. Deze apprelease wijzigt geen schema; een approllback draait geen speldata of private opslag terug. Er wordt geen productieworkflow gestart.
