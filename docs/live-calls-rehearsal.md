# Repetitie: Milo & Friends bellen

De vernieuwde bediening gebruikt één spelserver, één YouTube-uitzending en maximaal één geselecteerd gezin in een LiveKit-gesprek. Gewone kijkers verbinden niet met LiveKit en krijgen geen eigen AI-sessie. De centrale OpenAI-sleutel blijft op de server; elke presentator gebruikt zijn eigen opgeslagen stem, personageboek en spreekstijl.

## Wat werkt en wat een demonstratie is

De echte route bevat servervalidatie, een blijvende trekkingblokkade, kindselectie, een privé- en een aparte livegeluidsruimte, beperkte LiveKit-tokens, serverhandhaving van dempen, OpenAI WebRTC, gecontroleerde naamoverdracht en een expliciete terugkeer naar YouTube. De uitzending krijgt alleen het livegeluid van presentator en geselecteerde deelnemer. Achter de schermen krijgt de studio of AI geen verbinding met het privégesprek.

Open de demonstratie via **Shows → Oefenstudio openen** of **Belregie → Open simulatie**. Pauzeer eerst een eventueel lopende echte show. De klikbare demonstratie simuleert oproepen en verbindingsstatussen en wordt als demonstratie getoond. Een geslaagde demonstratie bewijst geen echte Cloud-, microfoon-, OpenAI- of YouTube-verbinding. De geautomatiseerde tests gebruiken nagebootste providerantwoorden. Voor een echte geslaagde koppeling is onderstaande repetitie met echte accounts en twee afzonderlijke apparaten nodig.

## Eenmalig instellen

- Maak in de LiveKit Cloud-console een project. Open de projectinstellingen en maak een server API key met bijbehorend API secret. Kopieer ook de project-URL (`wss://…livekit.cloud`). Vul deze drie waarden in onder **Instellingen → LiveKit Cloud**, sla op en kies de echte verbindingstest. Een geslaagde test controleert de servertoegang; hij bewijst nog geen werkende microfoon of audioplayback. Verander deze gegevens niet tijdens een gesprek.
- Controleer de bestaande centrale **OpenAI-koppeling**, API-tegoed/modeltoegang en de instellingen van Milo. Het gesprek gebruikt standaard `gpt-realtime-2.1-mini`; de sleutel wordt niet naar de browser gestuurd. LiveKit gebruikt eigen verbindingsgegevens.
- Vul de YouTube-uitzend-ID in. Controleer dat de video ingesloten mag worden en voor de gezinnen toegankelijk is. Zet de uitzending eerst besloten of verborgen klaar voor een repetitie.
- Open het uitzendvenster en activeer daar beeld en geluid. Gebruik dit specifieke venster als beeld- en geïsoleerde audiobron in OBS. Schakel algemene desktop-/systeemaudio en de losse regiemicrofoon in de uitzending uit, zodat het privégesprek niet alsnog via OBS wordt meegestuurd. Controleer de echte OBS-meters en een privé-meekijkapparaat; een softwarelabel bewijst deze isolatie niet.
- Gebruik voor regie en testgezin een headset, twee afzonderlijke apparaten en bij voorkeur verschillende internetverbindingen. Een ouderaccount kan meerdere kinderen hebben: meld het juiste profiel aan, geef oudertoestemming en doorloop de microfoon- en verbindingscontrole. De app moet open blijven om te kunnen opnemen.

## De echte route in negen stappen

1. **Deelnemer selecteren.** Meld twee kinderen onder één ouderaccount aan. Controleer in de regie dat het gekozen kind, de roepnaam en eventuele uitspraakhulp kloppen. Gebruik nooit de ouderaccountnaam als kindnaam.
2. **Belmoment voorbereiden.** Plan dit na een afgehandelde bingo of tussen rondes. Controleer dat het laatste nummer en alle kaarten gelijk blijven. Probeer automatisch, handmatig en via AI te trekken: alle drie moeten blokkeren. Ververs de regie; de blokkade moet blijven. Milo mag ondertussen gewoon entertainment verzorgen.
3. **Bellen.** Het gezin ziet Opnemen/Weigeren. Laat het gezin eerst het checkpointnummer in de vertraagde YouTube-uitzending horen en de kaart bijwerken. Pas na die bevestiging en werkelijk gedempt YouTube neemt het gezin op. Geen vaste wachttijd gebruiken als bewijs.
4. **Privé spreken.** Controleer beide microfoons, leg het verloop kort uit en laat de regie spreken. Controleer op het YouTube-meekijkapparaat en de studio-/OBS-meters dat dit gesprek werkelijk onhoorbaar is. Er mag nog geen OpenAI-sessie draaien.
5. **Klaarzetten.** Rond de geluids- en uitlegcheck af. Corrigeer zo nodig de roepnaam en controleer de gastkaart opnieuw. Bevestigde uitslagen komen van de spelserver; een regienotitie of uitgesproken wens maakt iemand geen winnaar.
6. **Live met Milo.** Kies de expliciete knop. Wacht op de werkelijke liveaudio- en presentatorstatussen. Het privégesprek wordt eerst afgesloten. Controleer dat Milo de gecorrigeerde naam gebruikt, het gezin Milo rechtstreeks hoort en YouTube beide live stemmen bevat. Deelnemer en regie mogen geen vertraagde eigen stem terughoren. Test dempen én weer vrijgeven.
7. **Gesprek beëindigen.** Controleer dat de live-microfoon, Cloud-verbindingen en AI-sessie stoppen. De trekking blijft geblokkeerd. Bij een afsluitfout moet de fout zichtbaar blijven en afsluiten opnieuw geprobeerd kunnen worden.
8. **Terugkeer bevestigen.** Het gezin herstelt de normale YouTube-weergave en bevestigt dat beeld en geluid weer werken. Controleer dit met afspeelinformatie waar betrouwbaar en een expliciete ouder- of regiebevestiging. Bij handmatige regiecontrole is een concrete notitie verplicht. De getrokken nummers blijven zichtbaar.
9. **Nummertrekking hervatten.** Alleen de bewuste regieactie geeft de blokkade vrij, nadat terugkeer en afsluiten zijn gecontroleerd. Er wordt niet vanzelf een nummer getrokken. Bel daarna een ander kind en controleer dat de vorige naam/context nergens meer wordt gebruikt; herhaal desgewenst met een andere presentator.

## Foutgevallen tijdens dezelfde repetitie

Test ook weigeren, niet opnemen (90 seconden), microfoontoestemming weigeren, annuleren tijdens voorbereiding, tab verversen, internetverlies achter de schermen en live, en het uitzendvenster sluiten. Elke fout moet naar terugkeercontrole leiden met de trekking nog geblokkeerd. Een normaal open bingo-meldvenster mag hierdoor niet voortijdig sluiten. Herhaal de audioprivacycheck met ingeschakelde regiemicrofoon en controleer dat gewone kijkers geen LiveKit-token of AI-sessie krijgen. Verwijder geen Cloud-instellingen tijdens een onvolledig afgerond gesprek.

Voor lage gebruikskosten blijven Cloud en AI beperkt tot de geselecteerde beller en het uitzendvenster. De gespreksduur is begrensd; werkelijk verbruik en accountlimieten zijn bij de providers te controleren. Pas na deze echte audio-, terugkeer- en foutrepetitie kan de koppeling als gerepeteerd worden aangemerkt.
