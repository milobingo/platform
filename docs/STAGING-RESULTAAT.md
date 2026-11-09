# Milo staging: OBS-browserbron en bruikbare startcontrole

De regie kan nu voor een opgeslagen show een aparte **OBS-link** maken via **Studio & camera’s → OBS-browserbron**. Die link opent het uitzendbeeld zonder Google-aanmelding in de OBS-browser. Kies **Beeld naar OBS sturen**, houd de regiepagina open en plak de link als OBS-browserbron van 1920 × 1080. De link hoort bij één show, is zeven dagen geldig en kan worden vervangen of ingetrokken. [Bediening en toegangsgrenzen](OBS-UITZENDING.md).

De melding over **Bindende spelregels** heeft nu een directe vervolgstap: de regels bekijken en bewust publiceren vanuit de startcontrole. De status wordt pas gereed na bevestiging van de actuele opgeslagen publicatie. We hebben geen regels namens de organisatie gepubliceerd en geen bestaande deelname- of startblokkade omzeild.

| Onderdeel | Bewezen resultaat |
|---|---|
| Actieve appbron | `a8bccabba771b6d2ada33e946d2b2d148bf03b76`, samengevoegd op main |
| Release / configuratie | `42713543591-1` / `staging-2026-11-05-v1` |
| Exacte main-CI | [42711956992: geslaagd](https://github.com/milobingo/platform/actions/runs/42711956992): 92 controleprogramma’s, 23 native controles, build/lint/typecheck en 27 browsertests |
| Native staginguitrol | [42713543591: alle drie jobs geslaagd](https://github.com/milobingo/platform/actions/runs/42713543591); bestaande wrapper/helper en beperkte runtime; `apply_database=false` |
| OBS-controles | 14 backend- en 11 clientcontroles; werkelijke lokale PostgreSQL-locator/CAS en expliciete browserfixtures |
| Browser op werkelijke staging | 27/27 in 61.7 seconden; geen skips, flaky tests of onverwachte fouten; dezelfde release vóór/na; 7 screenshots handmatig beoordeeld |
| Publieke HTTPS-nacontrole | Exacte SHA/run/config; 94 bronidentieke publieke modules/afbeeldingen; anonieme en ongeldige OBS-toegang geweigerd |
| Werkelijke opslag vóór activatie | Milo 17 en Vlampie 17 mailtemplates; Auth-template alleen-lezen; providerinstellingen leesbaar/bewerkbaar zonder credentials terug te geven; geen schrijf- of providerverzoek |
| Database en configuratie | Bestaande 23 tabellen en beperkte TLS-runtime gecontroleerd; geen migratie, rolwijziging, bronrestore of nieuw runtime-secret |
| Lokale definitieve run | 92 controleprogramma’s in één run; 27 browsertests in 60.4 seconden; 23 native controles; eigen PostgreSQL 17-fixture en private tijdelijke bestanden opgeruimd |

## Bewijs en afbakening

De [exacte CI](../verification/obs-source/main-ci.json), [CI-samenvatting](../verification/obs-source/main-ci-summary.json), [native uitrol](../verification/obs-source/staging-deploy.json), [deploymentgates](../verification/obs-source/staging-gates.json), [publieke bestandshashes](../verification/obs-source/staging-public.json), [stagingbrowserregistratie](../verification/obs-source/staging/a8bccabba771b6d2ada33e946d2b2d148bf03b76/42713543591-1/release-acceptance.json) en [visuele beoordeling](../verification/obs-source/staging/a8bccabba771b6d2ada33e946d2b2d148bf03b76/42713543591-1/manual-visual-review.json) zijn aan bovenstaande appbron gebonden. [Lokale acceptatie](../verification/obs-source/local-acceptance.json), [volledige lokale suite](../verification/obs-source/local-tests.json), [14 OBS-backendcontroles](../verification/obs-source/local-testlogs/check-obs-access.log), [11 OBS-clientcontroles](../verification/obs-source/local-testlogs/check-obs-source-ui.log) en [fixtureopruiming](../verification/obs-source/local-fixture-cleanup.json) bewaren hun afzonderlijke bewijsscope.

HTML, CSS, canvas, modules, afbeeldingen, release-identiteit en anonieme HTTP-toegangsgrenzen zijn op de echte staginghost gecontroleerd. Aangemelde regie-/gezinsantwoorden en OBS-tokens in de browsertests zijn expliciete fixtures; externe providers zijn gesimuleerd of geblokkeerd. De lokale backendcontroles gebruiken echte opslag en PostgreSQL voor tokenopzoeking en gelijktijdige wijzigingen. Ze controleren onder meer intrekking tijdens heartbeat, wachtrij en providerstart, behoud van de bekende externe sessie-ID en trekkingblokkade bij onbevestigde opruiming, en het weglaten van privégegevens. Er is geen echte Google-/OTP-aanmelding, OBS-installatie, microfoonverbinding, betaalde provideracceptatie, YouTube-uitzending of mailbezorging bewezen. Er zijn geen echte accountlinks aangemaakt of regels voor een gebruikersshow gepubliceerd.

Het toegangsbewijs staat in het URL-fragment `#obs=` en gaat uitsluitend via een aparte header naar de beperkte OBS-routes. De bestaande database bewaart alleen de willekeurige identificatie, tokenhash, show en vervaltijd. De link geeft geen regierechten, instellingen, deelnemersadministratie, privépersonagegegevens of toegang tot het voorgesprek. Opgeslagen sleutels blijven in de bestaande versleutelde voorziening; [OpenAI en LiveKit instellen](REGIE-SLEUTELS.md) en het herstel van 17 mailtemplates blijven beschikbaar. Er zijn voor deze toevoeging geen nieuwe accounts, omgevingsvariabelen, secrets of databasekolommen nodig.

De [vorige regiesleutelrelease](STAGING-RESULTAAT-2026-11-09-REGIESLEUTELS.md) en [vorige profielstatus](../verification/obs-source/previous-staging-status.json) bewaren `a272301` en haar eigen bewijs. De eerdere backup, herstelproef, upgrade van 18 naar 23 tabellen en capaciteitsmetingen blijven aan hun oorspronkelijke bron gebonden. De meting op `cb84f03` slaagde alleen voor het expliciete 180-secondenopslagprofiel met 100 fictieve huishoudens: 500/500 operaties, respons-p95 circa 27,1 seconden en alle claims circa 127,9 seconden na openen. De afzonderlijke 30-secondenproef bleef NO-GO met 121/500 operaties. Deze release kwalificeert geen nieuwe publieke belasting en verandert het standaardvenster niet.

Een terugrolrelease moet zowel de native regiesleutels als de OBS-toegang ondersteunen. Een oudere app kan die instellingen of OBS-link niet gebruiken; herstel zo nodig met een compatibele correctie vooruit. Het intrekken van een OBS-link heft geen trekkingblokkade op en vervangt geen bewezen opruiming van externe audioverbindingen.

## Resterende vrijgavepoorten

Deze release is beschikbaar voor technische review en besloten voorbereiding. Nog afzonderlijk nodig:

- Verdere verbetering en een geslaagde 100-huishoudenproef binnen het standaardvenster van 30 seconden. Het expliciete 180-secondenopslagprofiel is bewezen; publieke HTTP-/account-/livefeedbelasting en acceptabele interactieve responstijden blijven open.
- Aangewezen volwassen Google-/OTP-testaccounts met regierol, twee fictieve gezinnen en fysieke iOS-/Androidtelefoons; eigenaarschap, oude context, tie, publicatie, QR/PDF, verbindingsverlies en reserveoperator doorlopen.
- Organisatie-/afzendergegevens, werkelijk DG-mailgateway-/reconciliatiecontract, afzonderlijke wrapperconfiguratie en volwassen testontvangers. **Alle zeven mailnamen worden door de huidige stagingwrapper geblokkeerd; echte mail blijft uit.** Marketing wordt bovendien door de native adapter geweigerd. Supabase Auth gebruikt een afzonderlijk dashboardtemplate.
- Volwassen gast, LiveKit/OpenAI/OBS/YouTube met echte gescheiden geluidsopnamen, mute/noodstop, publicatie en bewezen terugkeer naar live voordat bellen wordt vrijgegeven. Sleutels of een browserframe zijn geen audioproef.
- Vastgestelde deelnamevorm, regels, prijzen, betaalbewijs-/refund- en bezwaarprocedure vóór betaalde of publieke deelname.

Productie is eerder geautoriseerd, maar heeft nog geen concrete productie-URL, DG-site/runner of afzonderlijke Supabase-configuratie. Het GitHub-environment heeft ook bij de laatste controle op 9 november **nul variabelen en nul secrets**: [actuele inventaris](../verification/v70/production-readiness.json). Er is niets naar productie uitgerold. De [productieprocedure](PRODUCTIE-DEPLOY.md) en [namenlijst voor accounts/configuratie/secrets](PROJECTGEGEVENS-EN-SECRETS.md) beschrijven exact wat nog moet worden aangeleverd en ingericht.

Het [queueherstel van vandaag](STAGING-RESULTAAT-2026-11-09-QUEUEHERSTEL.md), de [eerste v70-uitrol van vandaag](STAGING-RESULTAAT-2026-11-09-EERSTE-V70.md), [v6-uitrol van 6 november](STAGING-RESULTAAT-2026-11-06.md) en [bootstrap van 5 november](STAGING-RESULTAAT-2026-11-05.md) blijven historische onderbouwing. De afsluitende documentatie-/bewijscommit verandert de expliciet gekozen actieve appbron niet. **Na v70-claims of mailaanbiedingen is terugrollen naar de oude v6-app NO-GO**: herstel met een compatibele v70-correctie vooruit; geen automatische schema-downgrade, bronrestore, herloting of verwijdering van historie.
