# Lokale oplevering en verificatie — 4 november 2026

De bestaande overdracht is in `/home/codex/repos/milobingo` overgezet naar een zelfstandige Next.js/Node-app. Dit verslag beschrijft lokale controles. Op 5 november 2026 is GitHub-repository `milobingo/platform` als remote `origin` gekoppeld voor synchronisatie naar `main`. Staging, productie en echte provideraccounts zijn nog niet aangesloten. Het actuele projectprofiel laat die doelgegevens bewust onbekend.

## Bron en toolchain

- Bron: Sites-versie 63, volledige commit `08e1a652a78586d2e791179eead388acad8a3266`.
- Pakketintegriteit vóór wijzigingen: alle 531 gecontroleerde bestanden kwamen overeen met het meegeleverde SHA-256-manifest.
- Huidige assets: alle 133 bestanden uit `public/assets/` en 8 bestanden uit `source-assets/` zijn bytegelijk aan de overdracht. Zie `verification/assets.json`.
- Node `24.18.0`, pnpm `11.25.0`, Next.js `16.4.5`, React/React DOM `19.3.1`, Motion `14.4.0`; exacte dependencies in `pnpm-lock.yaml`.
- De lokale Git-repository volgt `origin/main` van `https://github.com/milobingo/platform.git`. De bestaande initialisatiecommit wordt behouden. De oude Sites-broncommit is provenance, geen nieuwe DG-release-SHA.

## Uitgevoerde controles

| Controle | Resultaat en bewijs |
| --- | --- |
| Installatie | `pnpm install --frozen-lockfile` geslaagd. |
| Productiebuild | `pnpm build` geslaagd, inclusief statische pagina's en dynamische Node API-/authroutes. Volledige uitvoer: `verification/build.log`. |
| Lint en types | `pnpm lint` en `pnpm typecheck` geslaagd. Typecheck omvat de nieuwe TypeScript-integratie; historische JavaScript-modules worden met lint en gedragstests gecontroleerd. |
| Regressies en nieuwe infrastructuur | 35 controlescripts geslaagd via `scripts/run-checks.mjs`, inclusief de geporteerde authcontroles. Resultaten: `verification/local-tests.json`, uitvoer per script onder `verification/local-testlogs/`. |
| PostgreSQL | Echte lokale PostgreSQL 17.11, alle vier storagecontracttests geslaagd, geen skip in deze testrun. Zie `verification/postgres-integration.log` en de actuele storagechecklog. Supabase Storage-HTTP is hierbij gesimuleerd; PostgreSQL-transacties, locks en beperkte databaserollen zijn echt. |
| Browser | 8 Playwright-controles geslaagd op de gebouwde productie-runtime. Zie `verification/browser-tests.json` en `verification/browser.log`. |
| Responsive stress | 54 layoutasserties geslaagd op 320×844, 390×844, 430×844, 768×844, 1280×720 en 1024×600. Zie `verification/responsive-stress.json` en screenshots. |
| Configuratie | Lokale build-/runtimevalidatie geslaagd. Zeven gerichte configuratiegevallen controleerden onder meer ontbrekende namen, verboden publieke secrets, lokale/remote vermenging en productiebeveiliging, zonder waarden te tonen. |
| Dependencies | `pnpm audit --prod`: geen bekende kwetsbaarheden gemeld op dit controlemoment. |

De overgenomen controles zijn inhoudelijk behouden. Fixtures geven hun al geverifieerde identiteit nu via een expliciete testbinding door. Werkelijke HTTP-aanvragen krijgen daarmee geen vertrouwen in Sites-headers. De oude zelfgemaakte Resend-OTP-tests zijn ongewijzigd gearchiveerd in `docs/overdracht/tests/`; de actuele authtests controleren delegatie aan Supabase en de servergrenzen. OTP-uitgifte, geldigheid en providerlimieten moeten later ook met het eigen Supabase-project worden geaccepteerd.

Drie aanvullende Canvascontroles (`check-bingo-board`, `check-milo-effect-continuity`, `check-milo-minigame-catalog`) slaagden na het portable maken van de Canvasimports. Er is geen nieuwe visuele stijl ingevoerd.

## Werkelijk lokaal aangetoond

Ook de echte ontwikkelserver is gestart met `pnpm dev` en de normale bestandslimiet. In Chromium is via de loginpagina een lokaal ouderaccount geopend, onboarding afgerond en zijn twee kinderen toegevoegd. Na herladen bleven drie profielen bewaard, zonder browserfouten. Hiervoor is een eigen tijdelijke testdatabase gebruikt. Zie `verification/local-account-ui.json`.

De Node-tests gebruiken de echte duurzame SQLite-adapter en oorspronkelijke serverhandlers voor regie, show aanmaken, unieke boekjes genereren, ouderaanmelding, onboarding, koppelen en starten. Ze controleren toegang van andere accounts, valse beheerheaders, gemanipuleerde cookies, CSRF, private regierollen en profielselectie bij een volledig gezin.

De server-PDF wordt werkelijk gegenereerd en tweemaal via de Node-route gedownload. De cache retourneert gelijke bytes; kaartnummers, code en token blijven gelijk. Een niet gekoppeld gezin en een anonieme bezoeker krijgen geen toegang tot het boekje. De oorspronkelijke printtest controleert daarnaast A5/A4, kleur/inktarm en meerdere unieke kaarten. Een fysieke print-/QR-proef op een tweede apparaat blijft apart nodig.

De opslagchecks bewijzen herstartpersistentie, atomaire game-/gezins-/codemutaties, gelijktijdige updates, codebotsingen, rollback bij een mislukte CAS, chatcursoren en private object-CAS. In PostgreSQL blijft RLS ook gesloten nadat een beperkte testrol per ongeluk tabelgrants krijgt. Deze checks wijzigen uitsluitend eigen tijdelijke testschema's en testbestanden.

De Node-spraakadapter is met echte lokale WebSockets getest op handshakefouten, geen redirects, vroege berichten, audioprotocol, annulering, bevestigde sessieafsluiting en onzekere afsluiting. Het overgedragen GPT-Live-model en protocol zijn behouden. Een succesvolle lokale socket betekent geen bevestiging van toegang tot OpenAI of beschikbaarheid van alle stemmen.

De browsercontroles openen alle vijf familietabs, controleren alle 75 ballen en de laatste bal, behouden dezelfde spelercomponent, testen accountmodal en demo-reset en bewijzen dat er geen echte API-/media-/providerverbinding wordt geopend in de demo. Echte API's geven geen demodata terug bij `?demo=1`. De productie-runtime weigert een lokale regieaanmelding.

Lange namen en e-mail zijn voor de layoutstress in de echte demo-DOM vervangen. Een lagere viewport simuleert de beschikbare ruimte bij een toetsenbord; dit is geen proef met een fysiek telefoontoetsenbord. De oorspronkelijke tijdelijke overflow tijdens development werd veroorzaakt door ontbrekende CSS tijdens wijzigingen/HMR. De stabiele productiebuild had dit probleem niet; er was geen responsive CSSwijziging nodig.

## Nog aan te sluiten en te accepteren

De concrete inventaris staat in `docs/PROJECTGEGEVENS-EN-SECRETS.md`. Na het beschikbaar komen van de projectgegevens volgen echte Supabase OTP/Google-sessies, twaalf stemmen/modeltoegang, LiveKit-microfoon/WebRTC, gescheiden backstage-/uitzendaudio, YouTube/OBS, fysieke print/QR, mailbezorging en herstelrepetitie.

Het bestaande DG-mailgateway-/outboxcontract is niet meegeleverd. Dat contract en de bijbehorende signing-/worker-/webhookinrichting moeten worden aangesloten voordat applicatiemail kan worden geaccepteerd. Er is geen eigen direct-mailcontract verzonnen.

De CI-workflow is voorbereid en bevat ook een geïsoleerde PostgreSQL-testservice. De push naar `milobingo/platform` start deze workflow; raadpleeg GitHub Actions voor de status van de exacte commit. Runnerlabels, deploywrapper, hosts, paden en domeinen zijn onbekend. Er is geen staging-/productie-uitrol, remote migratie of externe accountcreatie uitgevoerd. `/api/health` meldt alleen HTTP-status; onbekende releasevelden blijven `null`.
