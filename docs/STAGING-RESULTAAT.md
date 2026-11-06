# Milo staging: resultaat 6 november 2026

De zes wijzigingen uit overdracht `2026-11-06-v6` staan op [Milo staging](https://milo-staging.dgwebservices.nl). De [familiedemo](https://milo-staging.dgwebservices.nl/spelen?demo=1) is zonder account beschikbaar. De native doelrepo blijft [milobingo/platform](https://github.com/milobingo/platform), branch `main`.

| Onderdeel | Resultaat |
| --- | --- |
| Actieve volledige appbron | `16305c0d70fff1a5a80fccabf3703175e03df1d3` |
| Release / configuratie | `42154203480-1` / `staging-2026-11-05-v1` |
| Exacte bron-CI | [42153719888: geslaagd](https://github.com/milobingo/platform/actions/runs/42153719888) |
| Native stagingdeployment | [42154203480: alle drie jobs geslaagd](https://github.com/milobingo/platform/actions/runs/42154203480) |
| Toolchain | Node `24.18.0`, pnpm `11.25.0`, Next `16.4.5` |
| Hostcontract | Bestaande native wrapper v1, vaste stagingrunner en loopbackpoort `4173`; entry-/helperpins gecontroleerd |
| Database | Readonly audit geslaagd; dezelfde 18 beheerde tabellen, schema en migratiehistorie; beperkte runtime-login met echte TLS bevestigd |
| Migraties / reset | Geen migratie aangevraagd of uitgevoerd; geen datareset |
| Publieke nacontrole | Exacte SHA/run/config, 25 bronidentieke modules/cuebeelden en toegangsgrenzen geslaagd |
| Browser | 13/13 geslaagd op de echte staging-URL; geen skips of consolefouten |

Het [integratierapport](WIJZIGINGEN-1-6-INTEGRATIE.md) beschrijft bingoprioriteit/troostprijzen, Milo’s rig en tour, twaalf trucs, bestellen/goedkeuren, de werkruimte en privéfluisteren. De onafhankelijke review heeft onder andere wachtende audio bij een nieuw bingovenster, de asynchrone outputbevestiging, korte aanwijzingsecho’s, oude betaalmailversies en dubbele legacy-troostprijzen aangescherpt.

## Bewijs en reikwijdte

- [Exacte CI](../verification/handoff-v6/ci.json): configuratie, lint, 62 controleprogramma’s met afzonderlijke PostgreSQL-testservice, 23 native deploy-/rollbacktests, build, typecheck en 13 browsertests. De eerste CI ontdekte de sudo-rs-parser op Ubuntu 26; de test kiest nu aantoonbaar een digest-capabele C-parser. De sudoersbeveiliging is behouden.
- [Native uitrol](../verification/handoff-v6/staging-deploy.json): eigen main-CI, ongewijzigde rootwrapper-/helperhash, gescheiden buildaccount, runtimeallowlist, echte readonly database-/rolcontrole, activatie en publieke nacontrole. Nieuwe host-artifactdigest en proces-PID zijn zonder nieuwe SSH-beheertoegang niet afzonderlijk uitgelezen; er wordt geen nieuwe volledige SSH-inventaris geclaimd.
- [Publieke source-/assetcontrole](../verification/handoff-v6/staging-public.json): dezelfde volledige bron en release-ID, 25 identieke modules/afbeeldingen, geconfigureerde anonieme Auth-grens, vreemde Origin `403`, vervalste identiteit `401`, lokale login `403` zonder cookie, anonieme orders/fluisteren `401`.
- [Stagingbrowsertests](../verification/handoff-v6/staging-browser-results.json): vijf familiebreedtes en echte openbare autorisatiegrenzen; daarnaast de echte app/CSS/Canvas met uitsluitend in de browser gesimuleerde regie-API-antwoorden. Die simulatie doorloopt 24 routes/personagepagina’s, 33 subtabs en 7 modules op 390/1366 pixels, korte modals, tour/pauze/hervatten/terugkeer, een nieuwe truc, bestelvenster en privéfluisteren. [Screenshots en transportverslagen](../verification/handoff-v6/staging-browser/) zijn apart van lokale captures opgeslagen. Dit is geen echte regie-login, betaling, mail of providerproef.

De [vorige volledige host-/backup-/herstelacceptatie van 5 november](STAGING-RESULTAAT-2026-11-05.md) blijft historische onderbouwing; de toenmalige status is bewaard in [staging-status-2026-11-05.json](../verification/staging-status-2026-11-05.json). Er is voor deze wijziging geen nieuwe schemamigratie of muterende herstelproef nodig geweest. Een approllback verwijdert geen nieuwe orders/prijsgegevens, maar oudere code begrijpt die velden niet: controleer compatibiliteit vóór oudere code daadwerkelijk schrijft en kies bij nieuwe featuredata bij voorkeur een compatibele correctie vooruit.

Een volgende documentatiecommit op `main` verandert de expliciet gekozen actieve appbron niet automatisch.

## Wat productie nog blokkeert

Productie is expliciet geautoriseerd. De echte productie-URL, DG-host/site/runner en afzonderlijke Supabase-configuratie ontbreken echter nog. Het GitHub-environment `production` heeft bij de laatste controle geen variabelen of secrets. In de verbonden Supabase-accounts is geen Milo-productieproject zichtbaar; er is geen project of bestemming geraden of aangemaakt.

Verder ontbreken het daadwerkelijk ingerichte Milo-mailgateway-/worker-/afzender-/reconciliatiecontract en de echte releasegebonden gezins-/regie-, bestel/PDF-, mail- en show-/belacceptatie. De geïnstalleerde stagingwrapper v1 ondersteunt de vier nieuwe mail-runtimevelden nog niet; bestelmail blijft veilig uitgeschakeld totdat die afzonderlijk beoordeelde koppeling is ingericht. Ontbrekende verzending blijft zichtbaar bij de bestelling; bestellingen en goedgekeurde bladen blijven bewaard.

De concrete [productieprocedure en vereiste configuratie](PRODUCTIE-DEPLOY.md) zijn gebouwd en met tien gerichte controles getest. Het lege profiel wordt geweigerd. Na een echte bestemming worden de beoordeelde bootstrapbestanden en de workflow gerenderd; promotie vereist geslaagde CI én volledige echte stagingacceptatie van precies dezelfde bron. De [account-/secretinventaris](PROJECTGEGEVENS-EN-SECRETS.md) blijft de namenlijst. Geen echte testmail, betaling of betaalde providerrepetitie is uitgevoerd en er is niets naar productie uitgerold.
