# Milo staging: regiesleutels en mailherstel op 9 november 2026

OpenAI- en LiveKit-sleutels zijn op [Milo staging](https://milo-staging.dgwebservices.nl/#/settings) vanuit de regie te beheren. OpenAI staat onder **Instellingen → AI & stemmen**; LiveKit onder **Instellingen → E-mail & bellen**. Opslaan en testen zijn aparte acties. [Bediening en beveiligde opslag](REGIE-SLEUTELS.md). De mailstudio opent weer haar **17 templates** en toont bij een echte laadfout een blijvende melding met **Opnieuw laden**.

| Onderdeel | Bewezen resultaat |
|---|---|
| Actieve appbron | `a2723018022a96849dcc769cdc21aac3864ef659` via [PR4](https://github.com/milobingo/platform/pull/4), samengevoegd op main |
| Release / configuratie | `42704066094-1` / `staging-2026-11-05-v1` |
| Exacte main-CI | [42702427145: geslaagd](https://github.com/milobingo/platform/actions/runs/42702427145): alle 90 controleprogramma’s in één volledige run, 23 native deploygrenscontroles, lint, build, typecheck en 21 browsertests |
| Native staginguitrol | [42704066094: alle drie jobs geslaagd](https://github.com/milobingo/platform/actions/runs/42704066094); bestaande hashgebonden wrapper/helper en beperkte runtime; `apply_database=false` |
| Werkelijke opslagcontrole vóór activatie | Milo 17 en Vlampie 17 templates, inlogtemplate alleen-lezen; OpenAI-/LiveKit-instellingen leesbaar en bewerkbaar, geen credentials teruggestuurd; nul schrijf- of providerverzoeken |
| Database | Bestaande 23 tabellen en beperkte TLS-runtime opnieuw gecontroleerd. Geen nieuwe migratie, rolwijziging of bronrestore |
| Publieke nacontrole | Exacte SHA/run/config; 93 publieke modules/afbeeldingen bronidentiek; vervalste anonieme toegang afgewezen en lokale login uit |
| Browser op echte staging | 21/21 in 55,2 seconden; geen skips, flaky tests of onverwachte fouten. Release vóór/na gelijk; 6 screenshots handmatig bekeken |
| Lokale controle | Alle 90 controleprogramma’s in één definitieve run, 21 browsertests, 23 native controles, build/lint/typecheck; eigen PostgreSQL 17-fixture en private tijdelijke gegevens opgeruimd |

## Bewijs en afbakening

De [exacte CI](../verification/regie-settings/main-ci.json), [controleprogramma’s](../verification/regie-settings/main-ci-summary.json), [native uitrol](../verification/regie-settings/staging-deploy.json) en [alle deploymentgates](../verification/regie-settings/staging-gates.json) horen bij bovenstaande actieve appbron. De [werkelijke opslagcontrole](../verification/regie-settings/staging-workspace.json) bevestigt ook de oorzaak van de lege werkplek: Supabase Storage gaf voor ontbrekende objecten HTTP400 met `NoSuchKey` en `statusCode:404`. De adapter herkent uitsluitend die combinatie als ontbrekend object. Bucket-, autorisatie- en andere fouten blijven fouten.

De [stagingbrowserregistratie](../verification/regie-settings/staging/a2723018022a96849dcc769cdc21aac3864ef659/42704066094-1/release-acceptance.json), [21 testresultaten](../verification/regie-settings/staging/a2723018022a96849dcc769cdc21aac3864ef659/42704066094-1/browser-tests.json), [visuele controle](../verification/regie-settings/staging/a2723018022a96849dcc769cdc21aac3864ef659/42704066094-1/manual-visual-review.json) en [93 publieke bestandshashes](../verification/regie-settings/staging-public.json) blijven afzonderlijk van de lokale resultaten. De nieuwe browsergevallen gebruiken expliciet een opgeslagen show, testen een 503-fout met herstel naar 17 templates en tonen lege bewerkbare sleutelvelden bij bestaande serverinstellingen op 390/1366 pixels. HTML/CSS/assets en de anonieme Auth-grenzen zijn echt; geauthenticeerde API-antwoorden zijn browserfixtures. Dit bewijst geen echte Google-/OTP-aanmelding, sleutelopslag met een echt account, betaalde provideroproep, mailbezorging of uitzending.

De [lokale registratie](../verification/regie-settings/local-acceptance.json) bewaart de eerste fouten en correcties apart van de definitieve groene volledige run. De bron is daarna alleen aangevuld met documentatie en bewijs; de actieve appbron blijft expliciet bovenstaande SHA.

De eerdere backup en echte herstelproef, upgrade van 18 naar 23 tabellen en capaciteitsmetingen blijven bij hun oorspronkelijke bron. Het [queueherstelrapport](STAGING-RESULTAAT-2026-11-09-QUEUEHERSTEL.md) bewaart die releasebinding. De meting op `cb84f03` slaagde alleen voor het expliciete 180-secondenopslagprofiel met 100 fictieve huishoudens: 500/500 operaties, respons-p95 circa 27,1 seconden en alle claims circa 127,9 seconden na openen. De afzonderlijke 30-secondenproef bleef NO-GO met 121/500 operaties. Deze wijziging kwalificeert geen nieuwe publieke belasting en verandert het standaardvenster niet.

Na gebruik van native regiesleutels moet een terugrolrelease die instellingen ook ondersteunen; een oudere app die alleen serverwaarden leest kan ze niet gebruiken. Werk zo nodig vooruit met een compatibele correctie.

## Resterende vrijgavepoorten

Deze release is beschikbaar voor technische review en besloten voorbereiding. Nog afzonderlijk nodig:

- Verdere verbetering en een geslaagde 100-huishoudenproef binnen het standaardvenster van 30 seconden. Het expliciete 180-secondenopslagprofiel is bewezen; publieke HTTP-/account-/livefeedbelasting en acceptabele interactieve responstijden blijven open.
- Aangewezen volwassen Google-/OTP-testaccounts met regierol, twee fictieve gezinnen en fysieke iOS-/Androidtelefoons; eigenaarschap, oude context, tie, publicatie, QR/PDF, verbindingsverlies en reserveoperator doorlopen.
- Organisatie-/afzendergegevens, werkelijk DG-mailgateway-/reconciliatiecontract, afzonderlijke wrapperconfiguratie en volwassen testontvangers. **Alle zeven mailnamen worden door de huidige stagingwrapper geblokkeerd; echte mail blijft uit.** Marketing wordt bovendien door de native adapter geweigerd. Supabase Auth gebruikt een afzonderlijk dashboardtemplate.
- Volwassen gast, LiveKit/OpenAI/OBS/YouTube met echte gescheiden geluidsopnamen, mute/noodstop, publicatie en bewezen terugkeer naar live voordat bellen wordt vrijgegeven. Sleutels of een browserframe zijn geen audioproef.
- Vastgestelde deelnamevorm, regels, prijzen, betaalbewijs-/refund- en bezwaarprocedure vóór betaalde of publieke deelname.

Productie is eerder geautoriseerd, maar heeft nog geen concrete productie-URL, DG-site/runner of afzonderlijke Supabase-configuratie. Het GitHub-environment heeft ook bij de laatste controle op 9 november **nul variabelen en nul secrets**: [actuele inventaris](../verification/v70/production-readiness.json). Er is niets naar productie uitgerold. De [productieprocedure](PRODUCTIE-DEPLOY.md) en [namenlijst voor accounts/configuratie/secrets](PROJECTGEGEVENS-EN-SECRETS.md) beschrijven exact wat nog moet worden aangeleverd en ingericht.

Het [queueherstel van vandaag](STAGING-RESULTAAT-2026-11-09-QUEUEHERSTEL.md), de [eerste v70-uitrol van vandaag](STAGING-RESULTAAT-2026-11-09-EERSTE-V70.md), [v6-uitrol van 6 november](STAGING-RESULTAAT-2026-11-06.md) en [bootstrap van 5 november](STAGING-RESULTAAT-2026-11-05.md) blijven historische onderbouwing. De afsluitende documentatie-/bewijscommit verandert de expliciet gekozen actieve appbron niet. **Na v70-claims of mailaanbiedingen is terugrollen naar de oude v6-app NO-GO**: herstel met een compatibele v70-correctie vooruit; geen automatische schema-downgrade, bronrestore, herloting of verwijdering van historie.
