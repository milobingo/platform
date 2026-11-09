# Milo staging: v70-resultaat 9 november 2026

De v70-integratie staat op [Milo staging](https://milo-staging.dgwebservices.nl). De [familiedemo](https://milo-staging.dgwebservices.nl/spelen?demo=1) is zonder account beschikbaar. De doelrepo is [milobingo/platform](https://github.com/milobingo/platform), branch `main`. [Het integratierapport](V70-INTEGRATIE-EN-VRIJGAVE.md) onderscheidt de 21 werkpunten, softwarebewijs en resterende praktijkpoorten.

| Onderdeel | Bewezen resultaat |
|---|---|
| Actieve appbron | `f32a854b408ed750001f2f768fc0f454f102c4f9` |
| Release / configuratie | `42627937885-1` / `staging-2026-11-05-v1` |
| Exacte main-CI | [42625788676: geslaagd](https://github.com/milobingo/platform/actions/runs/42625788676): 85 controleprogramma’s, 23 native deploygrenscontroles, lint, build, typecheck en 19 browsertests |
| Native stagingdeployment | [42627937885: alle drie jobs geslaagd](https://github.com/milobingo/platform/actions/runs/42627937885); bestaande rootwrapper-/helperpins, gescheiden buildaccount en beperkte runtime behouden |
| Database | [42627576733: geslaagde additieve upgrade](https://github.com/milobingo/platform/actions/runs/42627576733) van 18 naar 23 tabellen, RLS, oorspronkelijke migratiehistorie, bestaande beperkte runtime-login met geverifieerde TLS en privébucket |
| Backup en herstel | Voor DDL werkelijk volledig hersteld op een afzonderlijke PostgreSQL17.11-scratch; gegevens en beveiligingsinstellingen exact gelijk. Versleutelde dump en extensiesidecar buiten de server bewaard, hashes en bestaande escrow-sleutel gecontroleerd; geen plaintextdump op schijf |
| Publieke nacontrole | Exacte SHA/run/config; 93 modules/afbeeldingen bronidentiek; anonieme/vervalste toegang geweigerd en lokale login uit. Nieuwe publieke regels-/afmeldroutes weigeren ontbrekende, ongeldige en niet-ondersteunde aanvragen veilig |
| Browser op echte staging | 19/19 in 53,7 seconden; geen skips, flaky tests of onverwachte fouten. Release vóór/na bevestigd; vijf actuele screenshots handmatig bekeken |
| C01 opslagpiek | [Proef 42628359660](https://github.com/milobingo/platform/actions/runs/42628359660) faalde met `409 closed`: het volume paste nog niet binnen de echte lease 180. Testschema verwijderd; alle 23 publieke tabellen ongewijzigd. Optimalisatie onder lokale beoordeling, C01 nog NO-GO |
| Tijdelijke hersteltoegang | Workerrelay en poorten 54388/54389 gesloten, eigen scratchcontainers/netwerk en private credentials verwijderd, tijdelijk GitHub-secret ingetrokken; Tailscale-policy niet gewijzigd |

## Bewijs en afbakening

De [exacte CI](../verification/v70/main-ci.json) en [samenvatting per controleprogramma](../verification/v70/main-ci-summary.json) horen bij de actieve appbron. De eerdere `capacity_api_refused` na 62.048 ms in de 60-secondenfixture is [afzonderlijk vastgelegd](../verification/v70/main-integration.json). De oorzaak was destijds niet voldoende gelogd om leaseverloop met zekerheid vast te stellen. Het huidige CI-profiel gebruikt 10 gelijktijdige aanvragen en 180 seconden; het standaard spelvenster blijft 30 seconden. CI bewijst geen 100 gelijktijdige aanvragen op Supabase of prestaties binnen het standaardvenster.

De [inventarisatie](../verification/v70/staging-inventory.json), [upgrade](../verification/v70/staging-upgrade.json), [herstelbewijs](../verification/v70/staging-restore.json), [beperkte runtime](../verification/v70/staging-runtime-role.json) en [opruiming](../verification/v70/staging-restore-cleanup.json) zijn afzonderlijk opgeslagen. In deze stagingdatabase stonden bij de inventarisatie nul shows; er zijn geen historische showtijden herschreven. De workflow beëindigde het exacte eigen runnerrelayproces; voor runnerpoort 55433 wordt geen onafhankelijke nacontrole geclaimd. [Vaste herstelroute](STAGING-RESTORE-RELAY.md).

De [native uitrol](../verification/v70/staging-deploy.json), [publieke gates](../verification/v70/staging-public.json), [93 assetchecks](../verification/v70/staging-public-assets.json) en [nieuwe routegrenzen](../verification/v70/staging-route-smoke.json) bevestigen deze release. De nieuwe host-artifactdigest is zonder SSH-beheer niet afzonderlijk uitgelezen. De geïnstalleerde native wrapper is niet gewijzigd.

De [stagingbrowserregistratie](../verification/staging-v70/f32a854b408ed750001f2f768fc0f454f102c4f9/42627937885-1/release-acceptance.json) bevat releasebinding, bron- en bewijshashes, echte anonieme Auth-grenzen en de [19 testresultaten](../verification/staging-v70/f32a854b408ed750001f2f768fc0f454f102c4f9/42627937885-1/browser-tests.json). Regie-/familie-API en providers zijn voor die UI-gevallen in de browser gesimuleerd. Dat bewijst echte staging-HTML/CSS/Canvas, maar geen echte Google/OTP-aanmelding, regierol, betaling, bezorging, provideroproep of zichtbare YouTube-ondertiteltrack. De lokale browserresultaten bleven intact.

## Resterende vrijgavepoorten

Deze release is beschikbaar voor technische review en besloten voorbereiding. Nog afzonderlijk nodig:

- Een geslaagde herhaling van C01 op het echte opslagpad en de haalbaarheid van het standaardvenster van 30 seconden; de eerste 100-proef faalde. Netwerk-/livefeedbelasting blijft een aparte meting.
- Echte volwassen Google-/OTP-accounts met regierol, twee fictieve gezinnen en fysieke iOS-/Androidtelefoons; eigenaarschap, oude context, tie, publicatie, QR/PDF, verlies van verbinding en reserveoperator doorlopen.
- Organisatie-/afzendergegevens, werkelijk DG-mailgateway-/reconciliatiecontract, afzonderlijke wrapperconfiguratie en volwassen testontvangers. Echte service- en marketingmail blijven uit; marketing wordt bovendien door de native adapter geweigerd. Supabase Auth gebruikt een afzonderlijk dashboardtemplate.
- Volwassen gast, LiveKit/OpenAI/OBS/YouTube met echte gescheiden geluidsopnamen, mute/noodstop, publicatie en bewezen terugkeer naar live voordat bellen wordt vrijgegeven. Sleutels of een browserframe zijn geen audioproef.
- Vastgestelde deelnamevorm, regels, prijzen, betaalbewijs-/refund- en bezwaarprocedure vóór betaalde of publieke deelname.

Productie is eerder geautoriseerd, maar heeft nog geen concrete productie-URL, DG-site/runner of afzonderlijke Supabase-configuratie. Het GitHub-environment heeft op 9 november nul variabelen en nul secrets: [actuele inventaris](../verification/v70/production-readiness.json). Er is niets naar productie uitgerold. De [productieprocedure](PRODUCTIE-DEPLOY.md) en [namenlijst voor accounts/configuratie/secrets](PROJECTGEGEVENS-EN-SECRETS.md) blijven beschikbaar.

De [v6-uitrol van 6 november](STAGING-RESULTAAT-2026-11-06.md) en [bootstrap van 5 november](STAGING-RESULTAAT-2026-11-05.md) blijven historische onderbouwing. Een documentatiecommit verandert de expliciet gekozen actieve appbron niet. **Na v70-claims of mailaanbiedingen is terugrollen naar de oude v6-app NO-GO**: herstel met een compatibele v70-correctie vooruit; geen automatische schema-downgrade, bronrestore, herloting of verwijdering van historie.
