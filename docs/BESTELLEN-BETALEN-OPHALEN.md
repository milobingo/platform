# Bestellen, betalen en ophalen

Deze audit en wijziging zijn uitgevoerd op 16 november 2026, vanuit uitgangsversie `a1d419c6f5f0611e11171a6b3514aee642bf396d`. De bestaande gezinsomgeving, backoffice, rollen, orderstatussen, mailtemplates, bingobladgenerator en opslag zijn hergebruikt. Er zijn uitsluitend fictieve gezinnen en gesimuleerde betalingen gebruikt. Er is geen productie-uitrol of wijziging van echte bestellingen uitgevoerd.

## Aanpassing 17 november: bestelcodes en één betaalbevestiging

Nieuwe bestellingen krijgen een willekeurige referentie van zes hoofdletters/cijfers achter `MF-`, bijvoorbeeld `MF-8JK655`. De server gebruikt cryptografische willekeur en bewaart het resultaat bij de bestelling. Een herhaalde aanvraag behoudt dezelfde code. De bestaande atomaire opslag controleert nieuwe codes over alle shows heen; een botsing wordt opnieuw geprobeerd, ook bij gelijktijdige bestellingen. Bestaande nummers zoals `MF-0001` worden niet herschreven. Er is geen databaseconversie of nieuwe tabel nodig.

In de bestelgegevens kiest de regie **Betaald**. Eén bevestigingsvenster toont gezin, bestaande bestelreferentie en verschuldigd bedrag. **Annuleren** wijzigt niets; **Ja, betaald** bevestigt de betaling en zet dezelfde unieke bladen klaar. Er zijn geen invulvelden of vinkjes. Dubbelklikken geeft geen tweede betaalbevestiging of extra bladenset. Bij een opslagfout blijft het venster open met de fout en kan dezelfde actie opnieuw worden geprobeerd.

`POST /api/bingo/games/:gameId/orders/:orderId/approve` accepteert hiervoor `{confirm:true}`. De server neemt bestelnummer, totaal en EUR over uit de opgeslagen bestelling en legt de bevoegde regiegebruiker en het tijdstip vast als `payment.method:'manual_host'`. Dit is een handmatige betaalbevestiging; er wordt geen banktransactie of transactiereferentie verzonnen. Het gezin kan zichzelf niet als betaald markeren. De bestaande bewijsroute voor financiële uitzonderingen en terugbetalingen blijft beschikbaar. De twee duurzame fasen en het herstel na een fout bij het genereren blijven hieronder beschreven.

## 1. Bestaande bestelstroom en gevonden gaten

| Onderdeel | Al aanwezig bij de audit | Aangepast of toegevoegd |
|---|---|---|
| Gezinsportaal | Show kiezen, aantal en spelers kiezen, bestelling controleren en versturen, eigen bestellingen bekijken, betaling melden en na uitgifte downloaden. | Drie ontvangstkeuzes, opgeslagen bij de bestelling; keuze in controle en orderdetails; duidelijke betaalde verwerkings-/herstelstatus. |
| Backoffice | Orderlijst, show-/statusfilter, details, betaalgegevens, expliciet betalingsbewijs, goedkeuring en orderdownloads. | Ophaalplanning voor `pickup` én `both`, showfilter, naam/order/aantal/betaalstatus, betaalde printlinks, Bunq-plakverwerking, afzonderlijk opslaan/versturen en veilig generatieherstel. |
| Server en database | Eigenaarschap en regierol, serverprijs, showgebonden orders in het JSON-document van `bingo_games`, CAS-mutaties en unieke ontvangstclaims in `bingo_payment_receipts`. | Verplichte geldige ontvangstkeuze bij nieuwe orders, vast bedrag volgens de prijs bij bestelling, Bunq-validatie, duurzame betaalbevestiging vóór de afzonderlijke uitgifte. |
| Mail | Bestaande Milo-opmaak, ordercontext, gatewayacceptatie, verzendlease, berichtversies, idempotentiesleutel en onderscheid tussen aantoonbaar mislukt en onzeker. | Alleen bewust versturen via de knop; genormaliseerde Bunq-link, knoptekst ‘Betaal via bunq’, geen betaalverzoek meer na bevestigde betaling; ontvanger en feiten blijven uit de order komen. |
| Generator en PDF | De bestaande generator maakte bij goedkeuring één orderbatch. Order-/blad-PDF's werden pas bij downloaden gerenderd en privé gecachet. | Betaling blijft bevestigd als generatie/opslag faalt; hervatten behoudt bestaande nummers. Ook algemene batch-PDF's controleren alle orderbladen vóór rendering én cachetoegang. Betaalstatus en complete uitgifte zijn downloadvoorwaarden. |

De audit vond geen persoonlijke generatie bij het aanmaken van een bestelling of bij het versturen van een betaalmail. Er is geen achtergrondtaak of generatiequeue voor onbetaalde orders toegevoegd. Een PDF-route maakte al wel een bestand bij de eerste toegestane download; deze rendering is nu bij alle ordergerelateerde routes achter de actuele betaal- en uitgiftecontrole geplaatst. De oorspronkelijke algemene batch-downloadroute controleerde de regierol, maar controleerde orderbladintegriteit niet per blad. Die omweg is afgedekt.

Aanvankelijk accepteerde de betaalvalidator algemene HTTPS-betaallinks, kon beheer het orderbedrag aanpassen en verstuurde opslaan direct een mail. Betaling en generatie zaten in dezelfde mutatie: een generatiefout draaide daardoor ook de betaalbevestiging terug. Deze punten zijn gewijzigd.

## 2. Bestellen en ophalen

In het gezinsportaal: **Boekjes → Bingobladen bestellen**. Het gezin kiest show, aantal en een van:

| Schermkeuze | Opgeslagen `fulfillmentChoice` |
|---|---|
| Zelf printen | `print` |
| Ophalen | `pickup` |
| Zelf printen én ophalen | `both` |

`POST /api/bingo/games/:gameId/orders` controleert op de server de open verkoop, show/deadline, hoeveelheid, geldige ontvangstkeuze, eigen spelers en het e-mailadres uit de geverifieerde accountidentiteit. De server bewaart ordernummer, showsnapshot, hoeveelheid, prijs per blad, verschuldigd totaal en keuze. Een meegestuurd afwijkend bedrag of e-mailadres bepaalt de order niet. Bij `both` wordt het aantal niet verdubbeld.

De backofficepagina **Bestellingen** bevat **Ophaalplanning**. Dit overzicht neemt zowel `pickup` als `both` op, ook wanneer ze nog openstaan. Het showfilter verandert alleen de selectie. Iedere rij toont naam, ordernummer, aantal, keuze en betaalstatus. De link **Printbladen** verschijnt pas wanneer betaling en volledige uitgifte bevestigd zijn. Deze link verwijst naar dezelfde order-PDF als in het gezinsaccount; er ontstaat geen tweede set voor ophalen.

## 3. Bunq-link en betaalmail

In de orderdetails accepteert **Bunq-betaallink** een losse URL of de volledige deeltekst:

```text
🙏 Betaal € 5,00 voor "test" via https://bunq.me/o/VoorbeeldCode123
```

Direct na plakken blijft exact `https://bunq.me/o/VoorbeeldCode123` in het veld staan. De gedeelde parser wordt ook op de server gebruikt. Alleen HTTPS met exact `bunq.me` en een geldige, niet-lege code direct onder `/o/` wordt geaccepteerd. Hoofdletters in de code en URL-parameters blijven behouden. Omliggende deeltekst, aanhalingstekens en afsluitende leestekens buiten de URL worden verwijderd. Lookalikes, gebruikersgegevens, afwijkende poorten, ontbrekende links, ongeldige paden en meerdere verschillende links leveren een concrete fout op. Het scherm behoudt ongeldige invoer voor correctie. Alleen de genormaliseerde URL wordt opgeslagen.

**Betaallink opslaan** gebruikt de bestaande `payment-link`-route zonder verzending. **Betaalverzoek versturen** roept die route aan met `sendMail:true`. De mail gebruikt het bij de order opgeslagen volwassen e-mailadres, show, ordernummer, hoeveelheid en bedrag. De bestaande Milo-template heeft de knop **Betaal via bunq**. De server herhaalt de linkcontrole voordat een betaalmail wordt aangeboden.

Een verzending krijgt pas `sent` nadat de adapter een geldige acceptatie met bericht-ID heeft teruggegeven. Dit bevestigt gatewayacceptatie, geen inboxbezorging. Een aantoonbare afwijzing blijft zichtbaar en kan via **Opnieuw proberen** worden aangeboden met dezelfde berichtidentiteit. De schermblokkering en serverlease voorkomen dubbele aanbieding door dubbelklikken. Een onzekere eerdere aanbieding blijft onder de bestaande herstelregels vallen. Opslaan, mailen en het openen van een betaal-URL bevestigen geen betaling.

## 4. Betaling, uitgifte en privé downloaden

Alleen de bestaande serverbevoegde regie van de betreffende organisatie kan goedkeuren. Het gezin kan uitsluitend melden dat het betaald heeft; zo'n melding geeft geen bladen vrij. De medewerker controleert de ontvangst buiten de app en gebruikt **Betaald → Ja, betaald**. Het opgeslagen orderbedrag en bestelnummer worden automatisch overgenomen; handmatige invoer van betaalreferenties is niet nodig.

Goedkeuring heeft twee afzonderlijke, duurzame fasen:

1. **Betaling vastleggen.** Een spelmutatie bewaart `payment.state:'verified'`, `verifiedBy`, `verifiedAt`, bedrag, valuta en bestelnummer. De gewone bevestiging krijgt `method:'manual_host'` en een auditregel, zonder verzonnen ontvangstclaim. Alleen de afzonderlijke bewijsroute bewaart de unieke ontvangstclaim in `bingo_payment_receipts`. Deze mutatie commit vóór de generator begint. De bestaande orderstatussen blijven bestaan; het scherm toont **Betaald** op basis van deze opgeslagen betaalbevestiging.
2. **Bladen uitgeven.** Een volgende CAS-mutatie gebruikt de bestaande generator, orderbatch, gezinsgegevens en codes. Precies de bestelde hoeveelheid wordt gegenereerd of aan de bestaande orderbatch ontleend. De volledige uitgifte wordt `fulfilled`; `issuance.state` wordt `ready`. Pas dan kan de boekjesmail worden aangeboden.

Bij een generatie- of opslagfout blijft de eerste fase bewaard. De backoffice toont `issuance.state:'failed'` met een passende foutmelding en **Bladen opnieuw klaarzetten**. Het gezin ziet dat de betaling bevestigd is en de bladen nog worden klaargezet. Hervatten via dezelfde goedkeuringsroute gebruikt de bestaande betaling; er is geen nieuwe betaalbevestiging nodig. Gelijktijdige en herhaalde bevestigingen behouden dezelfde orderbatch. Een bestaande gedeeltelijke batch wordt gecontroleerd en aangevuld zonder eerder opgeslagen bladnummers, codes of kaarten te vervangen. Een inconsistente bestaande set vraagt beheercontrole en wordt niet stil vervangen.

Voor alle drie ontvangstkeuzes verschijnen **Download kleur** en **Download zwart-wit** zodra `downloadReady` waar is. De order-PDF, losse blad-PDF en algemene batch-PDF controleren de actuele servergegevens vóór zij een nieuw of gecachet bestand teruggeven: bevoegde eigenaar/regie, bevestigde betaling, volledige uitgifte, orderrelatie, uitgiftestatus, eventuele intrekking en waar van toepassing toelating. Een andere klant krijgt via de directe order- of bladroute evenmin toegang.

De bestaande `SETTINGS`-objectopslag blijft in gebruik. De API geeft geen publieke opslag-URL uit. PDF-responses hebben `Cache-Control: private, no-store`. Lokale opslag staat buiten de publieke assets; de bestaande remote adapter leest objecten met serverbevoegdheid. De daadwerkelijke toegangsregels van een live remote bucket zijn in deze opdracht niet extern onderzocht.

### Bestaande orders en migratie

Voor deze wijziging is **geen SQL-migratie nodig**. De nieuwe ordervelden staan in het bestaande JSON-document. Er is geen backfill uitgevoerd en een leesactie schrijft historische orders niet om.

Ontbrekende of onbekende `fulfillmentChoice` wordt geprojecteerd en getoond als **Onbekend**. Dit wordt niet automatisch als printen of ophalen geïnterpreteerd. De order blijft zichtbaar in de gewone orderlijst en details; alleen expliciete `pickup`/`both`-orders komen in de ophaalplanning.

Een historische `fulfilled`-order zonder modern `payment`-object kan op basis van zijn reeds opgeslagen betaal-/goedkeuringsmoment als betaald worden herkend. De bestaande bladen, batch, nummers, codes, kaarten en eigenaarschap blijven bewaard. Er zijn geen echte historische bestellingen of betaalde bladen gewijzigd.

## 5. Uitgevoerde controles en grenzen

De onderstaande resultaten beschrijven de lokale verificatie op het moment van deze rapportage. Een volledige nieuwe CI-run volgt; een groene productiebuild of volledige uiteindelijke CI is hier nog niet afgetekend.

| Controle | Resultaat | Wat is daadwerkelijk gecontroleerd |
|---|---|---|
| Laatste gecombineerde gerichte suite | **79/79 geslaagd** | Ordertests, maildienst, demostroom, gezinsclaimcontext, Bunq-parser en native Resend-contracten; zie de bewaarde resultaatbestanden hieronder. |
| Actuele ordertests, `scripts/check-bingo-orders.mjs` | **36 tests geslaagd** | Echte handlers en opslagmutaties: keuze/prijs, normalisatie, autorisatie, ontvangstclaim, geen voortijdige generatie/download, concurrentie en herhaling, betaalbehoud bij fouten, herstel van een gedeeltelijke batch, legacybehoud en PDF-omwegen. |
| Gerichte mail- en Bunq-controles | **40 tests geslaagd** | Parsergrenzen, behoud van code/parameters, Milo-knop en orderfeiten, templates, maildienst en adaptercontracten met testtransport. |
| `tests/browser/orders-flow.spec.mjs` | **3/3 geslaagd**, 36,5 seconden | Normale gezins- en backofficeschermen op 1366 en 390 pixels; drie keuzes met 1/3/2 bladen en totaal € 15,00; ophaalfilter; los/share/parameters plakken; opslaan versus bewust mailen; dubbelklik; mailfout en opnieuw proberen; link openen blijft onbetaald; vóór betaling geen bladen/batches/codes/PDF-objecten; onbevoegd goedkeuren/downloaden geweigerd; betaalde download met dezelfde nummers; herhaalde bevestigingen; generatie-opslagfout, betaalde tussenstatus en herstel; onbekende legacykeuze en ongewijzigde betaalde kaarten. |
| Eerste volledige lokale projectrun | **130 van 131 checkscripts geslaagd** | De ene mislukking zat in een bestaande `node-resend`-fixture die nog `pay.example` gebruikte en daarom door de nieuwe Bunq-regel terecht werd geweigerd. |
| Herstelde `tests/check-node-resend-mail.mjs`-fixture | **11 tests geslaagd** | De fictieve link is naar Bunq aangepast; de gerichte herhaling slaagde. Dit vervangt nog niet de volledige nieuwe CI-run. |
| `pnpm lint` en `pnpm typecheck` | **Beide exitcode 0** | Projectlint en TypeScript-controle geslaagd. Ook de gerichte browserlintcontrole, syntaxis/importcontrole en `git diff --check` slaagden. |

De groepen in deze tabel overlappen; de aantallen moeten niet bij elkaar worden opgeteld. De laatste 79 tests en de afzonderlijke 9 mailtemplatetests zijn geslaagd. Samengevat bewijs staat in [results.json](../verification/orders-2026-11-16/results.json), met [de gerichte testlog](../verification/orders-2026-11-16/targeted-tests.log) en [de mail-/Bunq-testlog](../verification/orders-2026-11-16/mail-tests.log).

De browser gebruikte de echte Next-ontwikkelapp en de normale schermroutes `/spelen` en `/#/orders`. Alleen de transportgrens was geïsoleerd: serveridentiteiten werden aangeleverd als reeds geverifieerd, de echte order-, sessie- en livefeedhandlers draaiden op SQLite in het geheugen, mail werd opgevangen en objecten werden in een private geheugenmap opgeslagen. De geopende Bunq-pagina werd door een statische fictieve pagina vervangen; er ging geen verzoek naar bunq. De browserfout bij generatie was een geweigerde opslagbatch nadat de kaarten in de mutatie waren opgebouwd. Herstel van een reeds opgeslagen gedeeltelijke set is afzonderlijk door de ordertests gecontroleerd.

Browserrapport en schermafbeeldingen zijn lokaal beschikbaar in `/tmp/milo-orders-flow-browser.json` en `/tmp/milo-orders-flow-browser/`. De JSON-bewijzen bevatten de fictieve verzoeken en opgevangen mail. Dit zijn lokale werkbestanden, geen ingecheckte CI-artifacts.

Niet live geverifieerd: bankontvangst, een volledige externe login, echte mailprovider-/mailboxbezorging, Gmail/Outlook-weergave en de rechten van remote objectopslag. Er zijn geen echte gezinnen, echte betalingen of productiegegevens gebruikt. Een lokale productiebuild en een test van de verplaatste standalone-uitvoer zijn wegens onvoldoende vrije schijfruimte nog niet uitgevoerd. Volledige CI en productiebuild-/standalonebewijzen worden aan deze rapportage toegevoegd zodra die controles klaar zijn.

## Gewijzigde bestanden

| Gebied | Bestanden |
|---|---|
| Gezins- en backofficeschermen | `frontend/FamilyOrders.jsx`, `frontend/OrderAdministration.jsx`, `frontend/order-fulfillment.js`, `frontend/family-orders.css`, `frontend/orders-admin.css` |
| Bestaande demostroom | `frontend/family-order-demo.js`, `frontend/order-admin-demo.js`, `frontend/order-demo-store.js` |
| Gedeelde Bunq-parser | `public/bunq-payment.js` |
| Server, mail en PDF-beveiliging | `server/bingo-order-model.js`, `server/bingo-orders.js`, `server/bingo-order-mail.js`, `server/bingo.js`, `server/mail-templates.js` |
| Tests en testregistratie | `scripts/check-bingo-orders.mjs`, `scripts/check-order-demo.mjs`, `scripts/run-checks.mjs`, `tests/check-bunq-payment.mjs`, `tests/browser/orders-flow.spec.mjs`, `tests/check-family-claim-context.mjs`, `tests/check-node-resend-mail.mjs` |
| Documentatie | `docs/BESTELLEN-BETALEN-OPHALEN.md`, `docs/V70-ORDERS-EN-MAIL.md` |

Er is geen nieuwe database, betaalprovider of publieke bestandsopslag toegevoegd. Bestaande operationele instructies buiten de hier genoemde documentatie zijn niet aangepast.
