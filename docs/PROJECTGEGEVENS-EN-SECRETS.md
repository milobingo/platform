# Projectgegevens, accounts en beschermde configuratie

Milo gebruikt een beperkt GitHub-model: **geen blijvende GitHub-runtime- of
providersecrets**. Databasegegevens en de masterkey staan beschermd op de doel-VPS;
OpenAI, LiveKit en Resend worden vanuit de regie beheerd. De overgangsprocedure
en de nog uit te voeren hostmigratie staan in
[BESCHERMDE-CONFIGURATIE.md](BESCHERMDE-CONFIGURATIE.md).

Dit document is een configuratiecontract. De actuele release, geïnstalleerde
broker en daadwerkelijk behaalde acceptatie staan in [PROJECTPROFIEL.json](../PROJECTPROFIEL.json)
en [STAGING-RESULTAAT.md](STAGING-RESULTAAT.md). Aanwezige code of een ingevulde key
bewijst geen uitgerolde versie, echte aanmelding, mailbezorging of uitzending.

## GitHub: wat nog nodig is

Repository: [milobingo/platform](https://github.com/milobingo/platform), branch
`main`. Gebruik afzonderlijke environments `staging` en `production` met
een eigen runnerroute. Een release wordt handmatig gestart met de exacte groene
commit-SHA en een bestaand beschermd hostconfiguratie-ID.

De nieuwe stagingworkflow leest **nul GitHub-runtimevariabelen en nul blijvende
GitHub-secrets**. Het standaard kortlevende `GITHUB_TOKEN` heeft uitsluitend
`contents: read` en `actions: read` en hoeft niet zelf te worden aangemaakt.

Desgewenst mogen deze vier publieke variabelen in GitHub staan voor herkenbaarheid:

| Optionele Variable | Betekenis |
| --- | --- |
| `APP_URL` | Publieke HTTPS-origin van deze omgeving. |
| `SUPABASE_URL` | Publieke URL van het eigen Supabase-project. |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key van hetzelfde project; geen regiebevoegdheid. |
| `SUPABASE_STORAGE_BUCKET` | Naam van de private applicatiebucket. |

Deze optionele kopieën vullen de hostbundel niet automatisch en bepalen de
actieve runtime niet. De beoordeelde root-only bundel op de doel-VPS is leidend.
Ook wrapperhashes, poort en acceptatiebewijs hoeven geen GitHub-variabelen te zijn:
zij horen in de gecontroleerde hostpolicy en het releasebewijs.

Het bestaande environment `production` bevat al vier publieke aliassen en nul
secrets. Ze mogen blijven staan; hernoemen is niet nodig:

| Bestaande productievariable | Koppeling bij het maken van de beschermde hostbundel |
| --- | --- |
| `MILO_APP_ORIGIN` | `APP_URL` = `https://milo.dgwebservices.nl`, canoniek zonder afsluitende slash. |
| `MILO_DATA_MODE` | Bootstrapkeuze `supabase`, geen native runtime-envveld. |
| `NEXT_PUBLIC_SUPABASE_URL` | `SUPABASE_URL` = `https://msupvdycmtbycaonqgan.supabase.co`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_PUBLISHABLE_KEY`; intern gelijk bevonden aan een actieve key van dat project. |

Deze aliassen worden niet tijdens de native build gelezen en vullen de private
hostconfiguratie niet automatisch. Er zijn geen aanvullende openbare
projectgegevens of GitHub-secrets gevraagd voor deze route.

## Waar de gegevens worden bewaard

| Gegevens | Plaats en beheer |
| --- | --- |
| App-origin, Supabase-URL/publishable key/bucket en publieke database-CA | Eigen onveranderbare hostbundel per omgeving/configuratie-ID. |
| `DATABASE_URL` | Dezelfde beschermde runtimebundel; uitsluitend de beperkte app-login op het eigen project, met geverifieerde TLS. |
| `SUPABASE_SECRET_KEY` | Beschermde hostruntime voor private Storage; nooit in browser of build. |
| `VLAMPIE_SETTINGS_KEY` | Beschermde hostruntime; behoud exact de bestaande 64-hextekens masterkey bij bestaande data. |
| OpenAI-key | Versleutelde regie-instelling bij **Instellingen → AI & stemmen**. Bestaande hostfallback kan tijdelijk behouden blijven. |
| LiveKit-URL/key/secret | Versleutelde regie-instelling bij **Instellingen → E-mail & bellen**. Bestaande hostfallback kan tijdelijk behouden blijven. |
| Resend-key, afzender, antwoordadres en verzendmodus/ontvangers | Versleutelde regie-instelling bij **E-mail & bellen** of **E-mail & nieuwsbrieven → Instellingen**. Geen `RESEND_API_KEY` in GitHub nodig. |
| `MIGRATION_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY` | Afzonderlijke root-only beheerbundel; niet aan normale deploy, build of app doorgeven. |
| Tijdelijke hersteltestverbinding | Alleen in de afzonderlijke beheer-/herstelprocedure; na gebruik gecontroleerd opruimen. |
| Google OAuth en SMTP voor inlogmail | In Supabase Auth en zo nodig de eigen Google Cloud-providerconfiguratie. |
| Release-SHA/run/configuratieversie, poort en `MAIL_ENVIRONMENT` | Vastgelegd of afgeleid door de beoordeelde hostbroker; geen handmatige appinstelling. |

De app heeft geen verplichte `NEXT_PUBLIC_*`-buildconfiguratie. De bron wordt
zonder database-/providercredentials op de doelhost gebouwd. Runtimegeheimen
komen alleen bij de app en de afzonderlijke audit als appaccount terecht.

## Bestaande staging en de gedeelde VPS

| Onderdeel | Bevestigde bestemming |
| --- | --- |
| Host | `dg-nxttrack-01`. |
| Milo staging | [milo-staging.dgwebservices.nl](https://milo-staging.dgwebservices.nl), site `milobingo-staging`, loopback `127.0.0.1:4173`. |
| Milo-identiteiten | Runner `run-mil-stg`, build `build-mil-stg`, app `app-mil-stg`; bestaande eigen accounts behouden. |
| Milo-bestanden | `/srv/sites/milobingo-staging`, bestaande releases, `current`, `shared` en beschermde runtimebestanden behouden. |
| Supabase staging | Bestaand project `lfsdgxcpdyghidzkzzvn`, URL `https://lfsdgxcpdyghidzkzzvn.supabase.co`, private bucket `milo-staging`. Niet opnieuw aanmaken. |
| Andere sites | Dartflow staging op `127.0.0.1:4174` en productie op `127.0.0.1:4175` blijven intact. Alle native builds gebruiken de bestaande hostbrede lock. |

Controleer de werkelijke services, listeners, identiteiten en publieke health
vóór en na hostwijzigingen. Milo productie krijgt eigen accounts, configuratie
en een aantoonbaar vrije poort. De bestaande drie poorten worden daarvoor niet
overgenomen.

## Bevestigd productiedoel en resterende inrichting

De read-only [productie-inventaris](../verification/provider-management/production-inventory.json)
van 11 november 2026 bevestigt:

- `https://milo.dgwebservices.nl` wijst naar `128.140.93.95` op `dg-nxttrack-01`.
  Een productiehostfragment is nog niet waargenomen; HTTPS faalt bij de
  TLS-handshake. Er is nog geen productiepoort gereserveerd of actief
  productieprofiel of productieworkflow geïnstalleerd.
- Supabase `milobingo-production`, ref `msupvdycmtbycaonqgan`, is gezond in
  `eu-west-1` en gekoppeld via **Duindorpdoet**. Geen nieuw project of extra
  accountkoppeling nodig.
- Het project is leeg: geen publieke tabellen, Milo-databaserollen, buckets of
  gebruikers. De bestaande connector heeft SQL-beheerrechten voor de
  afzonderlijk beoordeelde schema- en rolbootstrap.
- Google-login staat uit. E-mailregistratie vereist bevestiging. SMTP en
  toegestane redirects moeten nog afzonderlijk worden gecontroleerd en ingericht.

De huidige Supabase-connector kan geen private serverkeys of bestaande
databasewachtwoorden ophalen of beheren. De beperkte app-login,
server-side Storage-credential en eigen stabiele productie-masterkey moeten via
een beschermd kanaal op de doelhost worden ingericht. Providerkeys voor OpenAI,
LiveKit en Resend kunnen daarna via de regie worden opgeslagen.

## Nog in te richten of functioneel te controleren

| Dienst | Nodig |
| --- | --- |
| Supabase | Bestaand stagingproject behouden. Productieproject en gekoppelde beheertoegang zijn bevestigd; schema, beperkte runtime-login, private bucket, beschermde servercredential en Auth-configuratie moeten nog worden ingericht. |
| Regie | De echte Supabase user-UUID van bevoegde beheerders; roltoekenning via de private `app_user_roles`-tabel, geen invulbaar e-mailadres of gebruikersmetadata. |
| OpenAI | Een eigen bruikbaar project/key met toegang tot de gebruikte functies; invoeren via de regie. |
| LiveKit Cloud | Eigen Cloud-project met project-URL, API-key en API-secret; invoeren via de regie. |
| Resend | Account met bruikbare key, geverifieerd afzenderdomein/DNS, afzender en eventueel antwoordadres; invoeren via de regie. Domeincontrole vereist daarvoor geschikte keyrechten. |
| Supabase Auth / Google | Eigen Auth-provider-/SMTPinstellingen en juiste callback-origin; afzonderlijk testen met echte accounts. |
| Productiehost | Origin en DNS zijn bevestigd. Nog nodig: eigen beoordeeld hostprofiel/accounts/poort, Caddy/TLS, service, broker en beschermde runtimebundel; de bestaande drie sites behouden. |
| Uitzending | YouTube-uitzending/video-ID, OBS-computer en testapparaten voor beeld, uitzendmix en een echt belmoment. |

De beheerpagina's kunnen openen voordat providerkeys zijn ingevuld. De betrokken
functie blijft dan duidelijk ongeconfigureerd. Zie [REGIE-SLEUTELS.md](REGIE-SLEUTELS.md)
voor opslaan, testen, uitschakelen en de scheiding tussen showmail en inlogmail.

## Behoud en bewijs

Een approllback draait database, Auth, Storage, providerinstellingen of
mailhistorie niet terug. Bewaar actieve en benodigde vorige bundels met hun
stabiele masterkey en kies alleen een app die de huidige instellingen en het
huidige schema begrijpt. Migraties vereisen een afzonderlijk backup-/herstelpad.

Historische schema-, mail-, capaciteits- en acceptatieresultaten zijn geen
automatische vrijgave van deze nieuwe route. Raadpleeg het releasegebonden
bewijs. De voorgaande uitgebreide GitHub-configuratie is bewaard in
[het legacydocument](PROJECTGEGEVENS-EN-SECRETS-LEGACY-2026-11-10.md).
