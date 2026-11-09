# v70: serverkern en opslagmarge

De overdracht beschrijft Sites-commit `f81d0c1c60cbe1422d43ce46d896af6cd4d2939c`. Deze correcties zijn gemaakt in de bestaande Next/Node-port, met behoud van geverifieerde identiteit en SQLite/PostgreSQL-CAS. Geen externe provider, cloud-database, campagne, betaling of publicatie is uitgevoerd voor deze tests.

`node --disable-warning=ExperimentalWarning tests/check-game-invariants.mjs` bevat 17 regressies. De eerste vier faalden aantoonbaar vóór de correctie: alleen-middenvak, heropening van een gewonnen stap, afsluiten met ongepubliceerde uitslag, en een gewijzigde claimretry die een ander gezinsboekje retourneerde. De overige gevallen toetsen gedeelde gelijktijdige vensters, herstel na een ongeldige claim, actuele sancties, exacte deadlines, verouderde context, gelijktijdige request-ID-botsingen, eenmalige settlement, bestaande uitslagen zonder nieuwe identificatievelden, publieke projecties en de gedeelde trekblokkade.

Prijsstappen zijn definitief op show-/ronde-/doel-ID. Bestaande uitslagen zonder dit nieuwe veld worden op hun bestaande ronde-/doelindex herkend en blijven ongewijzigd. Regiepublicatie blijft `acknowledged: true`; afsluiten weigert open vensters en ongepubliceerde uitslagen. Een correctie van historische winnaars is geen gewone activeringsroute.

Meldingen vereisen de door de server geleverde `state.claimContext`: gameId, brandId, roundId, goalId, epoch, patternVersion, windowId, windowStatus en windowSequence. De patroonversie is de canonieke effectieve patrooninhoud. Een dialoog van vóór het eerste venster mag het gezamenlijke nieuwe venster gebruiken; een dialoog voor een eerder geopend venster kan geen volgend venster openen. Oudere clients zonder volledige context ontvangen een veilige 409. De primaire melding/claim bewaart een compacte gehashte invoerbinding in zijn private historische record, ook na meer dan 250 andere handelingen. Geautoriseerde exacte retries behouden hun eigen antwoord; gewijzigde invoer krijgt een conflict en autorisatie wordt ook vóór de replaylookup gecontroleerd.

Publieke uitslagprojecties bevatten alleen expliciete velden. Boek-ID wordt uitsluitend toegevoegd voor het eigen gezin; account-ID, profiel-ID, geboortedatum, private mailmetadata en opgeslagen willekeurige extra velden worden niet vanuit de uitslag verspreid. De gepubliceerde limiet van 150 geldige boekjes per gezin geldt ook bij handmatig koppelen en hosttoewijzing. Een oud concept boven die limiet blokkeert publiceren/starten zonder de bestaande uitgifte te herschrijven. De regie-familielijst beperkt zich tot gezinnen bij de eigen shows en geeft geen geboortedatums terug.

## C01: begrensd document als expliciet equivalent

Bestaande spelhistorie is niet verplaatst of weggeknipt. De harde documentgrens is 32 MiB. Een startcontrole reserveert conservatief 1 MiB + 1.500 bytes per boekje per prijsstap + 512 bytes per mogelijke rondebal. Een nieuw meldvenster vereist daarnaast 3.000 bytes per boekje + 384 KiB vrije ruimte voor afronding en herstel. Iedere write tijdens een open venster bewaart die marge. Er zijn maximaal 20.000 spelgebeurtenissen, waarvan de laatste 1.000 zijn gereserveerd voor kernafronding/herstel; nieuwe vensters en gewone extra historie worden vóór uitputting geweigerd. De laatste 256 KiB zijn bestemd voor kern- en belherstel. Orders zijn al begrensd op 100, betaalmailversies op 20 per order, financiële/koppelhistorie op 100 en spelreplayrecords op 250. Nieuwe studio-mailoutboxen/payloads staan buiten het speldocument. Historische ordermailpayloads blijven behouden en tellen mee in iedere bytecontrole.

De regie ontvangt `game.capacity` met gemeten bytes, grenzen, gereserveerde bytes, geprojecteerde omvang en `startReady`. Dit is een conservatieve toelatingscontrole, geen garantie voor iedere denkbare showlengte. Een import die al buiten de grenzen valt vraagt gecontroleerd beheer; er worden nooit stil gegevens verwijderd.

`node --disable-warning=ExperimentalWarning tests/check-game-capacity.mjs` slaagde lokaal met:

| Fictieve configuratie | Werkelijke documentomvang | Gereserveerde groei | Uitkomst |
|---|---:|---:|---|
| 1.000 boekjes, 4.000 kaarten, 10 doelen | 656.854 bytes | 16.202.176 bytes | startmarge beschikbaar |
| 81 orders, 162 boekjes, 648 kaarten, huidige standaardmail | 1.382.267 bytes | 3.632.176 bytes | startmarge beschikbaar |
| Zelfde 81 orders, geldige bevroren mailtekst van 8.000 tekens | 3.851.957 bytes | 3.632.176 bytes | start via echte API; alle historische payloads behouden |
| 100 gelijktijdige gezinnen, 400 boekjes, 1.600 kaarten | piek 1.114.901 bytes | vooraf beschikbaar | 500 geslaagde API-verzoeken; 400 unieke geldige claims; één opgeslagen winnaar; circa 8,9 s |

De oorspronkelijke 1,73-MB-baseline is niet identiek aan de huidige compacte port: de huidige 4.000 kaarten en standaardmails blijven kleiner. De toegestane lange templatevariant reproduceert wel concreet het overschrijden van de oude 1,50-MB-grens. Byteaantallen kunnen door willekeurige kaartgetallen enkele bytes variëren.

Dit bewijs gebruikt de echte lokale native SQLite-adapter en serverhandlers. Het bewijst geen prestaties bij 32-MiB-documenten, maximaal kaartvolume onder alle gelijktijdige claims, PostgreSQL/Supabase-load of een beoogde staging-/productiecapaciteit. Dezelfde volumetest op het beoogde opslagpad en de praktische repetitie met fysieke apparaten blijven nodig vóór vrijgave van dat volume of live bellen.
