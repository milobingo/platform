# Lokaal draaien en staging releasen

Dit runbook hoort bij de lokale port. Het actuele projectprofiel staat in `PROJECTPROFIEL.json` in de root; de oorspronkelijke documenten staan onder `docs/overdracht/`. De afgesproken scope omvat lokale bouw, synchronisatie naar `main` van `milobingo/platform`, staging en productie. De huidige releaseprocedure staat in [STAGING-DEPLOY.md](STAGING-DEPLOY.md), de configuratiescheiding in [BESCHERMDE-CONFIGURATIE.md](BESCHERMDE-CONFIGURATIE.md). Oudere deploydetails hieronder bewaren de eerdere bootstrap. Productiedomein en Supabase-project zijn inmiddels bevestigd; zie [PRODUCTIE-DEPLOY.md](PRODUCTIE-DEPLOY.md) voor inrichting en resterende acceptatie.

## Lokaal

Gebruik Node `24.18.0` en pnpm `11.25.0`, vastgelegd in `.nvmrc` en `package.json`. Start de app vanuit de projectroot, zodat migraties en assets via de afgesproken relatieve paden worden gevonden. Installeer uit het lockfile:

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open de URL die Next.js meldt; de lokale standaard is `http://127.0.0.1:4173`. `/spelen?demo=1` is de herkenbare fictieve familie met haar eigen opslag en resetfunctie. De demo opent geen echte AI-/LiveKit-/microfoonverbinding en is geen ingelogd gezin.

`MILO_LOCAL_AUTH=true` biedt op een developmentserver op loopback expliciete lokale regie-/spelerrollen via de loginpagina. Remote projectconfiguratie en proxyverkeer sluiten deze toegang uit. Gebruik voor echte accounts de Supabaseconfiguratie in `PROJECTGEGEVENS-EN-SECRETS.md`.

De lokale Node-adapter bewaart de database en private objecten standaard onder `.data/`. Deze bestanden zijn geen broncode, blijven buiten Git en mogen geen productie-export of echte secrets als fixture bevatten. Stop de app vóór het kopiëren van een SQLite-database; bewaar database, eventuele WAL-/SHM-bestanden en private objecten als samenhangend herstelpunt. Een nieuw `.env.local` of een andere encryptiesleutel kan bestaande versleutelde instellingen onleesbaar maken.

Een productiebuild kan zonder externe accounts worden gemaakt. Een lokale productiebuild activeert de developmentlogin niet. Beschermde routes blijven zonder echte Authconfiguratie gesloten; een geslaagde build bewijst geen werkende OTP of providerverbinding.

```bash
node scripts/check-config.mjs --phase=build
pnpm build
pnpm start
```

Valideer vóór een aangesloten omgeving ook de serverruntimeconfiguratie, zonder waarden te tonen:

```bash
node scripts/check-config.mjs --phase=runtime --profile=supabase
```

Dit controleert aanwezigheid en formaten, geen accounttoegang. `RELEASE_SHA`, `RELEASE_ID` en `CONFIG_VERSION` zijn optionele niet-geheime runtimevelden voor releasebewijs; een ontbrekende identiteit blijft onbekend en wordt niet verzonnen.

De historische `scripts/preview-dev.mjs` is een UI-preview en niet de nieuwe server. `scripts/build-worker.mjs`, de oorspronkelijke `.openai/hosting.json` en de D1-migraties onder `drizzle/` blijven bronreferenties; gebruik ze niet als DG-releasepipeline of PostgreSQL-migratie.

## Verificatie

Voer de in `package.json` vastgelegde lint-, type-, unit- en buildcommando’s uit. De CI doet dit op de uitgecheckte commit, zonder providercredentials of externe mutaties. De actuele lokale resultaten staan in `docs/LOKALE-VERIFICATIE.md`; de logs uit de ZIP bewijzen alleen de oorspronkelijke bronmomentopname.

Controleer in de echte browser minimaal:

- Familie-app: vijf tabs, uitzending/controller blijft bestaan bij wisselen, bord 5×15, expliciete BINGO-bevestiging, lange namen/e-mails en 320/390/430/768 px.
- Expliciete demo: fictieve data, lokale reset, geen wijziging van echte account- of boekjesgegevens, geen providerverbindingen.
- Lokale server: regie kan een show maken; speler kan geen officiële nummers, winnaars, rollen of andermans gezin wijzigen; verversen behoudt data.
- Regie/studio: PROGRAM/PREVIEW/TAKE, elf camera’s, pauze/herstel, de twaalf vrienden, vijf gekozen minigames, Milo/Vlampie-branding en bestaande links.
- PDF: opgeslagen unieke kaarten en tokens blijven gelijk bij opnieuw downloaden; controleer A5/A4, kleur/inktarm en een gescande QR op een tweede apparaat.

Offline tests gebruiken stubs voor providers en media. Een Canvasrender bewijst niet de OBS-/YouTube-audiomix. De echte belproef uit `docs/overdracht/STATUS-EN-ACCEPTATIE.md` en `docs/live-calls-rehearsal.md` blijft nodig na aansluiting van accounts.

De Canvaschecks laden nu de vastgelegde repositorydependency `@napi-rs/canvas` via `scripts/canvas-runtime.mjs`; een expliciete `CODEX_PRIMARY_RUNTIME_NODE_MODULES`-override blijft mogelijk voor authoring. Sommige historische render-/authoringscripts gebruiken nog Linux DejaVu-fontpaden of een oud `/workspace/scratch/`-uitvoerpad. Controleer voor die afzonderlijke scripts de uitvoeroptie en fontbeschikbaarheid; videoauthoring vraagt ook `ffmpeg`. De normale Next-build gebruikt de meegeleverde assets en printtemplates en voert die extra authoringstappen niet uit.

`server/node-provider-fetch.js` vervangt het uitgaande Cloudflare-WebSockettransport voor GPT-Live door een Node-adapter. Zeven lokale loopback-WebSockettests dekken onder meer audio, bevestigde/onbevestigde afsluiting, handshakefouten, redirects, abort en timeout. Ze doen geen echte providerverzoeken. De OpenAI-status onderscheidt `transportReady: true`, `transportStatus: node_adapter_ready` en `liveVerified: false`: de adapter is beschikbaar; echte modeltoegang en de volledige stem-/uitzendketen blijven te verifiëren. Inkomende browser-WebSocket-upgrades op `/api/` zijn niet ondersteund; het GPT-Live-transport loopt server-side naar de provider. Het DG-mailgateway-/outboxcontract moet nog worden aangeleverd en geïmplementeerd.

## Staging uitrollen

De uitvoerbare procedure staat in [STAGING-DEPLOY.md](STAGING-DEPLOY.md), de eenmalige hostinrichting in [STAGING-HOST.md](STAGING-HOST.md) en de databaseprocedure in [STAGING-DATABASE.md](STAGING-DATABASE.md). De workflows `staging-preflight.yml` en `deploy-staging.yml` gebruiken de aangetroffen Milo-runner op `dg-nxttrack-01` en GitHub environment `staging`.

De hostinspectie van 5 november bevestigt de runner, maar vond nog geen deploywrapper, appservice, Milo-Caddy-site of benodigde deploymenttoolchain. De runner heeft geen sudo-bevoegdheid voor het releasepad. Daardoor is nog geen release geactiveerd en zijn geen hosted migraties toegepast. Een groene infrastructuurinspectie betekent dat de inspectie draaide; de afzonderlijke deploycontrole moet alle voorwaarden bevestigen.

De PostgreSQL-migratie blijft ongewijzigd in `supabase/migrations/20261104115830_milo_friends_server_schema.sql`. Het nieuwe migratiecommando inventariseert standaard alleen. Toepassen vereist eerst een versleutelde databasebackup en een echte herstelproef op een afzonderlijke lege lokale database. Een bestaande applicatiedatabase zonder bekende migratiehistorie wordt geblokkeerd en niet gereset.

`pnpm build` maakt een native `.next/standalone`-release met server, getraceerde dependencies, `public`, `.next/static` en lokale SQLite-migraties. De start op de host gebruikt Node met `server.js`, `HOSTNAME=127.0.0.1` en de door de beheerder bevestigde `PORT`. Omgevingsbestanden horen buiten de build; de packager weigert ze in het standalonepakket.

## Acceptatie en productie

Gebruik minstens een regieaccount, een ouderaccount met meerdere kindprofielen en een onafhankelijk meekijkapparaat. Test toegestane én geweigerde acties, OTP/Google, sessieherstel, boekjeskoppeling, PDF-identiteit, nummerreservering/commit, claims, gelijke bingo’s, pauze en herstel. Herhaal mediafouten: geweigerde microfoon, geen antwoord, verversen, netwerkverlies privé/live en mislukte resourceafsluiting. Centrale `drawHold` blijft staan tot bewuste herstelactie; backstageaudio bereikt uitzending en AI niet.

Houd bij echte mail provideracceptatie, mailserveraflevering en postbusontvangst apart. Test live geluid met meters en een apart YouTube-apparaat; labels en mocks zijn geen bewijs. Registreer overgeslagen stappen als openstaand of als expliciet afgesproken releasegebonden uitzondering.

Productie volgt pas binnen de afgesproken scope en na volledige stagingacceptatie van dezelfde SHA. De productierunner bouwt opnieuw met productieconfiguratie. Noteer per release:

| Bewijs | Vast te leggen |
| --- | --- |
| Bron en CI | Volledige commit, workflow-SHA, CI-run en geslaagde vereiste checks. |
| Toolchain | Node, pnpm, lockfile en deploywrapperversie. |
| Configuratie | Omgeving, configuratieversie, allowlists; uitsluitend namen, geen secretwaarden. |
| Activatie | Release-ID, run/poging, actieve runtime-SHA, startcommando en healthresultaat. |
| Backend | Migraties, backup/herstelbewijs, gateway/worker-/Edge-contractversies. |
| Acceptatie | Rollen, browserflows, print/QR, echte mail- en belproef, fouten en uitzonderingen. |
| Herstel | Vorige compatibele release, exacte wrapperrollback en aanvullende database/provideracties. |

Bij mislukte appactivatie nadat backendwijzigingen zijn toegepast, rapporteer een gedeeltelijke uitrol en controleer de nog actieve app. Gebruik de gedocumenteerde wrapperrollback voor de applicatie. Database, Edge Functions, Storage en providerinstellingen rollen niet automatisch mee terug. Verifieer na herstel opnieuw de actieve SHA en gebruikersflows.
