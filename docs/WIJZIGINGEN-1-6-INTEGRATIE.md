# Integratie van overdracht 2026-11-06-v6

De zes wijzigingen zijn overgenomen in de bestaande native Next.js/Supabase-app. De expliciete gebruikersopdracht van 6 november autoriseert ook productie. De documenten in het pakket zijn bronvereisten en referenties; zij vervangen geen echte productiegegevens of serverautorisatie.

## Herkomst en vergelijking

Doelbaseline: `d10f923108b28cbf0c332374394d3ab8091ea47a`. Nieuwe Sites-bron: `2a32f65f464e78f22a256ba74af3ea85765c2482`, versie `2026-11-06-v6`. Alle **583** vermeldingen in het aangeleverde SHA256-manifest zijn gecontroleerd vóór integratie. De originele documenten, bronidentiteit, manifesten en dertien referentiescreenshots staan in [overdracht-wijzigingen-1-6](overdracht-wijzigingen-1-6/START-HIER.md). De bestandsinventaris staat in [handoff-v6-inventory.json](../verification/handoff-v6-inventory.json).

De Cloudflare-worker, oude Sites-identiteitsheaders, browserformulieren voor providersleutels en oude hostingconfiguratie zijn niet naar het DG-platform teruggebracht. De bestaande Supabase-identiteit, private SQL-regierollen, Node-provideradapter, serversecrets, migratiehistorie en native releasegrenzen blijven leidend. Het oorspronkelijke overdrachtsarchief blijft apart bewaard.

| Wijziging | Integratie | Gericht bewijs |
| --- | --- | --- |
| 1. Vroegste bingo en troostprijs | Eén vroegste voltooiingsindex; alleen exacte gelijke standen in het beslisspel. Troostprijs standaard uit, afzonderlijke uitgifte, gezinsweergave, herinnering en CSV. | `check-claim-priority`, `check-family-consolation`, bestaande bingo/production-tests |
| 2. Milo en studiorondje | Bronrig met beweegbare benen en voetcontact; studiorondje van 64 seconden met deskdiepte, schaal, camera, pauze en terugkeer. | `check-milo-motion`, `check-milo-leg-render`, `check-milo-studio-tour`, Canvas-rendercontroles |
| 3. Twaalf goocheltrucs | Canonieke `server/magic-cues.js`, gekopieerd naar de browser tijdens voorbereiding; eigen cuebeelden en effecten. Oude draaiboeken worden niet automatisch aangevuld. | `check-magic-catalog`, `check-milo-magic-render`, planner/showcue-regressies |
| 4. Bestellen en goedkeuren | Toekomstige open shows, aantallen en eigen gezinsleden; persoonlijke HTTPS-betaallink; oudermelding; expliciete betaalcontrole; één transactionele uitgifte; dezelfde bladen in kleur/zwart-wit/A4/A5. | `check-bingo-orders`, echte lokale Node-sessie/API/PDF-flow, CAS en eigendomsnegatieven |
| 5. Werkruimte | Twaalf routes, personages, subtabs, compacte regie, panelen en mobiele bediening uit de bron; native login en configuratiestatus behouden. | Navigatie-/UI-regressies en Playwright met herkenbaar gesimuleerde backendantwoorden |
| 6. Privéfluisteren | Versleutelde privéstatus; voorstel apart voorbereiden en bewust toepassen; live route gebruikt bestaande AI-sessie; passende protocolbevestiging betekent alleen geaccepteerd. | Server-, wachtrij- en livefluistertests plus echte lokale WebSocket-adaptertests met nagebootste provider |

## Gegevensbehoud en terugkeer

Deze wijziging voegt **geen SQL-tabellen of migraties** toe. Bestellingen en troostprijzen zijn uitbreidingen van bestaande game-JSON; fluisterstatus gebruikt bestaande versleutelde privéopslag en belstatus. De bestaande achttien beheerde tabellen, boekjes/codes/QR, families, rollen en migratiechecksums worden behouden. Ontbrekende nieuwe velden krijgen een standaardwaarde tijdens gebruik; er is geen gegevensreset of bulk-herschrijving.

De regressiecontrole leest en bewaart bestaande instellingen en controleert behoud van boekjes, tokens, bestaande bestellingen en prijsresultaten. Goedkeuring gebruikt de bestaande transacties/CAS en een afzonderlijke interne batchidentiteit. Afdrukvarianten wijzigen nooit de toegekende bladidentiteit.

Een approllback activeert de vorige gekoppelde app-/configrelease; dit verwijdert geen nieuwe bestel- of prijsgegevens. Een oudere app kan nieuwe velden niet bedienen. Keer daarom na een productie-uitgifte bij voorkeur vooruit terug met een compatibele correctie; inspecteer vóór een oudere release daadwerkelijk schrijfwerk doet of diens JSON-mutaties de nieuwe velden bewaren. Database- of providerrollback gebeurt niet automatisch.

## Mail, betaalcontrole en externe acceptatie

Bestelmail gebruikt een injecteerbare serveradapter. De native adapter volgt de bestaande DG-gatewaycode: één vaste Supabase-functie `send-email-hook`, een gesigneerde transactionele envelop, stabiele outboxcorrelatie en een door de worker beheerde afzender. De HMAC-envelop volgt [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md). Providerkeys komen niet in de app of browser.

`MAIL_MODE` is standaard `disabled`. Staging accepteert alleen `allowlist` met expliciete ontvangers; `live` vereist `MAIL_ENVIRONMENT=production`. Vereist zijn daarnaast `SEND_EMAIL_HOOK_SECRET`, de echte Supabase-projectorigin en een daadwerkelijk ingerichte gateway met eigen worker/outbox/afzender/providerwebhooks. Het gatewaycontract is herleid uit `lib/mail/gateway.ts` en `supabase/functions/send-email-hook/` in de bestaande DG-doelrepo `duindorphalloween-startregie-final-release`; dit bewijst nog geen installatie voor Milo.

Ontbrekende configuratie, geweigerde verzending en onzekere uitkomsten blijven duurzaam zichtbaar bij de bestelling. Alleen een controleerbaar gatewayreceipt geeft de status verzonden; dat bewijst provideracceptatie, niet postbusaflevering. Een onbekende uitkomst wordt niet automatisch herhaald: de Milo-gatewaygarantie voor reconciliatie en bewaartermijn moet nog bevestigd worden. Een afzender- of sleutelwijziging mag geen onzekere oude poging opnieuw verzenden. Bij een gewijzigde betaallink blijven eerdere mailversies, hun bevroren inhoud en receipts privé bewaard; de organisatie krijgt een waarschuwing over oudere onzekere pogingen. Maximaal twintig betaalmailversies voorkomt onbegrensde groei zonder historische pogingen te verwijderen. Controleer zo'n poging via de gateway voordat verdere actie volgt.

De geïnstalleerde stagingwrapper v1 bevat de vier nieuwe mailnamen nog niet in zijn runtime-allowlist. Staging kan met uitgeschakelde bestelmail normaal releasen. Actieve mail vereist eerst een beoordeelde wrapper-/configupdate; productie krijgt de mailnamen in zijn afzonderlijk gegenereerde hostcontract. Deel geen privésleutels of secrets in de chat.

Betalen blijft handmatig: het gezin meldt een betaling, de organisatie controleert die extern en keurt daarna bewust goed. Er is geen automatische bank- of betaalprovidercontrole. Tests sturen geen echte mail, doen geen betaling en maken geen betaalde providerverbinding.

## Productiegrens

De productie-URL, host/site, runner en afzonderlijke Supabase-configuratie zijn nog niet ingevuld. Het bestaande GitHub-environment `production` bevatte bij onderzoek geen variabelen of secrets; alleen de stagingrunner was beschikbaar. Er is daarom geen productiebestemming geraden en geen stagingdatabase als productie gebruikt. De productievoorbereiding moet eerst een volledig echt doel valideren en daarna exact dezelfde volledige broncommit als de geaccepteerde stagingrelease bouwen.

De gewone CI, offline tests en browserfixtures bewijzen geen volledige Google-login met een menselijk account, externe betaalcontrole, echte mailbezorging of live showgeluid. Voor productie horen de releasegebonden echte gezins-/regierollen, de benodigde gateway/worker en de show-/belrepetitie tot de afzonderlijke stagingacceptatie. Niet uitgevoerde controles tellen niet als geslaagd.
