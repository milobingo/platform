# Milo & Friends BingoShow

Lokale Next.js 16-app op basis van de goedgekeurde overdracht van 4 november 2026 (Sites-versie 63, broncommit `08e1a652a78586d2e791179eead388acad8a3266`). De familie-app, twaalf vrienden, regie, Sterrenplein, Vlampie-werelden, spelmodellen, PDF-templates en alle assets zijn behouden.

De zes wijzigingen uit overdracht `2026-11-06-v6` (bron `2a32f65f464e78f22a256ba74af3ea85765c2482`) zijn geïntegreerd: bingoprioriteit/troostprijzen, Milo’s rig en studiorondje, twaalf goocheltrucs, bestellen/goedkeuren, compacte werkruimte en privéfluisteren. Zie [integratie, gegevensbehoud en acceptatie](docs/WIJZIGINGEN-1-6-INTEGRATIE.md).

Broncode: [milobingo/platform](https://github.com/milobingo/platform), integratiebranch `main`. De lokale checkout gebruikt deze repository als remote `origin`.

## Lokaal starten

Gebruik Node **24.18.0** en pnpm **11.25.0**:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:4173/login**. Kies expliciet **Open lokale regie** of **Open lokaal ouderaccount**. Dit zijn ontwikkelaccounts met echte lokale serveropslag, zonder e-mail of providerverbinding. De lokale aanmelding is alleen beschikbaar op loopback, buiten productie en zonder Supabase-/remote databaseconfiguratie. `pnpm dev` zet die testmogelijkheid expliciet aan; `pnpm start` doet dat niet.

De gevulde, duidelijk gemarkeerde familie-demo staat op **http://127.0.0.1:4173/spelen?demo=1**. Deze simulatie blijft in de browser en gebruikt geen spel-API, microfoon, YouTube, OpenAI of LiveKit. De PDF-links in de demo zijn herkenbare voorbeelden.

Een `.env.local` is voor lokaal spelen niet nodig. Gebruik [.env.example](.env.example) als namenlijst voor latere aansluiting. Zet `PORT` om een andere poort te gebruiken en pas dan ook een eventueel ingesteld `APP_URL` aan. Bewaar secrets uitsluitend in genegeerde omgevingsbestanden of de gekozen GitHub environment; plaats ze niet in de chat of broncode.

## Wat is omgezet

- Next.js App Router met aparte clientgrenzen voor Canvas/audio en de bestaande interface; `/`, `/regie`, `/uitzending`, `/spelen`, `/login` en oude ingangen.
- Node-serverroutes voor regie, gezin, kinderen, boekjes, server-PDF, bingo, chat, draaiboek, personages, presentatie en belstatus.
- Duurzame lokale SQLite/private objectopslag; PostgreSQL-adapter en een Supabase-migratie met RLS en gesloten browsertoegang. Game-/familiewijzigingen, codes en claims blijven servergestuurd en transactioneel.
- Supabase servergeverifieerde OTP/Google-aanmelding en private regierollen, gereed om met de echte projectgegevens aan te sluiten. Browserheaders en zelfgekozen metadata verlenen geen beheerrechten.
- Gepinde toolchain, pnpm-lockfile, CI, configuratiecontrole en afzonderlijke offline-, database- en browsercontroles.

Lokale data staat standaard onder `.data/` en blijft bij herstart bewaard. Verwijder deze map niet als daarin te bewaren shows/boekjes staan. Persoonlijke afstreepmarkeringen blijven in browseropslag; ze beslissen geen bingo-uitkomst.

## Controles en build

```sh
pnpm check:config
pnpm lint
pnpm test
pnpm build
pnpm typecheck
pnpm exec playwright install chromium
pnpm test:browser
```

`pnpm build` maakt ook het native standalonepakket inclusief assets. Start dit met `pnpm start:standalone`. `pnpm test:browser` test dat pakket op poort 4175. Gebruik `BROWSER_BASE_URL=http://127.0.0.1:4173 pnpm test:browser` voor een al draaiende ontwikkelserver. De PostgreSQL-integratietest gebruikt alleen een lokale, afzonderlijke testdatabase via `MILO_TEST_DATABASE_URL`; zonder deze variabele wordt die specifieke controle expliciet overgeslagen. Zie [het verificatierapport](docs/LOKALE-VERIFICATIE.md).

## Aansluiten en uitrollen

De concrete inventaris staat in [Projectgegevens, accounts en secrets](docs/PROJECTGEGEVENS-EN-SECRETS.md). Het [runbook](docs/RUNBOOK.md) beschrijft de lokale bediening, Supabase-inrichting, echte acceptatie en het DG-releasepad. [DATABASE-MIGRATIE.md](docs/DATABASE-MIGRATIE.md) beschrijft transacties, ID-behoud en import/herstel.

Staging draait op [milo-staging.dgwebservices.nl](https://milo-staging.dgwebservices.nl); de openbare [familiedemo](https://milo-staging.dgwebservices.nl/spelen?demo=1) is direct te openen. De native releaseprocedure, databasebackup met echte herstelproef, beperkte runtime-login en publieke nacontrole zijn ingericht. Zie [het actuele resultaat en bewijs](docs/STAGING-RESULTAAT.md), [de volgende deployment uitvoeren](docs/STAGING-DEPLOY.md) en [de hostinrichting](docs/STAGING-HOST.md).

Echte OTP/Google, bewuste regietoekenning, mailgateway, provider-/modeltoegang, stemmen, LiveKit/WebRTC, YouTube/OBS en de belrepetitie blijven afzonderlijke acceptatiestappen. De gesigneerde DG-bestelmailadapter is gebouwd; de eigen Milo-gateway/worker, afzender, signing secret en het reconciliatiecontract moeten nog worden ingericht. Benodigde gegevens en bestaande configuratie staan in [de inventaris](docs/PROJECTGEGEVENS-EN-SECRETS.md). Productie is geautoriseerd; de echte bestemming wordt gevalideerd via [de productieprocedure](docs/PRODUCTIE-DEPLOY.md).

De oorspronkelijke overdrachtsdocumenten staan onder `docs/overdracht/`, de oorspronkelijke README onder `docs/overdracht/README-bron.md`. Het Cloudflare-buildpad is historische bron; de standaardbuild is nu Next.js. `.openai/hosting.json` hoort bij de oude Site en wordt niet gebruikt voor DG-releases.
