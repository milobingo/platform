# Beschermde configuratie en beperkte GitHub-inrichting

Milo krijgt dezelfde scheiding als Dartflow: GitHub bewaart broncode en start de
release; de doel-VPS bewaart de infrastructuurgeheimen; bevoegde regisseurs beheren
OpenAI, LiveKit en Resend in de app.

**Migratiestatus bij voorbereiding op 11 november 2026:** de nieuwe route en
beheerfuncties zijn in de bron voorbereid. Hostinstallatie, de eenmalige
beheercredentialoverdracht en het verwijderen van de oude acht GitHub-secrets
moeten na geslaagde CI nog worden uitgevoerd en vastgelegd. Dit document claimt
die stappen niet als voltooid. De actuele uitvoering en release-identiteit staan
uitsluitend in [PROJECTPROFIEL.json](../PROJECTPROFIEL.json) en
[STAGING-RESULTAAT.md](STAGING-RESULTAAT.md).

## Drie plaatsen met ieder een eigen taak

| Plaats | Wat er hoort |
| --- | --- |
| GitHub | Repository, eigen CI, environment, runnerselectie en handmatige release-SHA/configuratie-ID. Geen blijvende runtime- of providersecrets. |
| Beschermde doelhost | Database-/Storagecredentials, publieke runtimeconfiguratie, stabiele encryptiemasterkey, vaste deploypolicy en afzonderlijke beheer-/herstelmaterialen. |
| Milo-regie | Versleutelde OpenAI-/LiveKit-/Resendcredentials, afzender, antwoordadres en toegestane verzendmodus. Alleen echte regierollen kunnen wijzigen. |

De nieuwe gewone stagingworkflow gebruikt nul `vars.*`- en nul `secrets.*`-waarden.
Het standaard kortlevende `GITHUB_TOKEN` dient uitsluitend voor bron- en CI-lezing.
Vier publieke GitHub-variabelen zijn optioneel voor herkenbaarheid: `APP_URL`,
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_STORAGE_BUCKET`. De workflow
leest die kopieën niet als runtime; zij worden niet automatisch naar de host
gekopieerd. Er is geen eigen PAT of SSH-secret nodig voor normale deployments.

## Stagingbundel op de doelhost

```text
/etc/dg-sites/milobingo-staging/
  protected-deploy.json                    root:root 0600
  configs/                                root:root 0700
    staging-2026-11-11-v2/                 root:root 0700
      runtime.json                        root:root 0600
  admin/                                  root:root 0700
    github-transfer-2026-11-11.json        root:root 0600
```

Het genoemde configuratie-ID is de beoogde eerste bundel van deze migratie, geen
bewijs dat zij al is geïnstalleerd. Een bestaand ID wordt niet overschreven.
Wijzigingen krijgen een nieuw goedgekeurd ID; actieve en benodigde vorige bundels
blijven voor herstel beschikbaar.

`runtime.json` is een begrensd JSON-object met stringwaarden. Het bevat:

- `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_STORAGE_BUCKET`;
- `SUPABASE_DB_CA_BASE64`, `DATABASE_URL`, `SUPABASE_SECRET_KEY`;
- exact de bestaande `VLAMPIE_SETTINGS_KEY`;
- eventueel bestaande OpenAI-/LiveKit-fallbackwaarden en modelkeuzes, om de
  overgang zonder stille credentialwijziging te kunnen uitvoeren.

De runtime-login is beperkt tot de beoordeelde appbevoegdheid. De database gebruikt
het eigen Supabase-project, geldige CA en `sslmode=verify-full`. De Supabase-secretkey
blijft voor private Storage op de server. De masterkey is historisch zo genoemd
en beschermt ook Milo, private instellingen en mailpayloads. Genereer bij een
bestaande dataset geen vervangende masterkey.

De bundel accepteert geen afgeleide releasevelden, `NODE_OPTIONS`, GitHub-/SSH-
credentials, migratie-/backupgegevens of `RESEND_API_KEY`. Ook `MAIL_MODE` en
`MAIL_ALLOWED_RECIPIENTS` horen niet in deze nieuwe bundel: de regie bewaart de
verzendkeuze versleuteld. De broker forceert `MAIL_ENVIRONMENT=staging`; vrije
verzending is daar niet mogelijk. Productie krijgt dezelfde scheiding met een
eigen vaste productiegrens en een afzonderlijk backendproject.

De afzonderlijke `admin`-overdracht bevat alleen `MIGRATION_DATABASE_URL` en
`BACKUP_ENCRYPTION_KEY`. Deze worden nooit aan de gewone deploybuild of app
meegegeven. Een tijdelijke restoretestverbinding hoort uitsluitend bij de
gecontroleerde beheerprocedure. Een appdeployment migreert of herstelt geen database.

## Eenmalige migratie: pas uitvoeren na CI

1. Leg de volledige bron-SHA en geslaagde eigen main-CI vast. Inventariseer
   uitsluitend metadata: bestaande entry/helperhashes, UID/GID, services, actieve
   release, poorten en publieke health van Milo en beide Dartflow-omgevingen.
2. Render de nieuwe stagingbroker met
   [render-deployer.py](../infra/protected/render-deployer.py), de werkelijke drie
   accountidentiteiten en het goedgekeurde configuratie-ID. Beoordeel manifest,
   codepinnen en de digestgebonden sudoersregel. Installeer uitsluitend de nieuwe
   vaste bestanden. Behoud de bestaande legacyentry/helper, appunit, Caddy-route,
   releases en private runtimebestanden.
3. Seed `runtime.json` intern uit het bestaande beschermde actieve envbestand.
   Log geen inhoud en gebruik geen shell-`source`. Bewaar database-, Storage-,
   encryptie- en eventuele providerfallbackwaarden exact. Laat root-only metadata
   en gelijkheid onafhankelijk controleren; het nieuwe configuratie-ID en de
   vaste omgevingsgrens zijn de bedoelde wijzigingen.
4. Installeer tijdelijk de beoordeelde vaste
   [adminoverdrachthelper](../infra/bootstrap/move-admin-secrets.py), met uitsluitend
   de eigen digestgebonden sudo-regel. Start de eenmalige workflow
   **Move existing Milo admin settings to protected VPS storage** voor de gekozen
   groene SHA. Zij geeft alleen de twee al bestaande beheercredentials via stdin
   door. Geen secretwaarde verschijnt in argumenten, documentatie of uitvoer.
5. Verifieer de volledige private overdracht onafhankelijk als beheerder:
   vaste twee namen, juiste project-/TLSgrens, bruikbaar backupsleutelformaat,
   exclusief gewoon bestand, één hardlink en `0600` onder root-only directories.
   Een fout of onzekere overdracht blokkeert het verwijderen van GitHub-secrets.
   Een bestaande afwijkende overdracht wordt niet overschreven.
6. Trek de tijdelijke overdrachtsbevoegdheid in en retireer de eenmalige workflow.
   Voer de gewone protected stagingdeployment uit met dezelfde groene SHA en het
   nieuwe configuratie-ID. Verifieer werkelijke systemd-/lock-/buildgrenzen,
   appaccountaudit, activatie, publiek resultaat en de bestaande Dartflow-sites.
7. Archiveer na de geslaagde beschermde uitrol de oude
   `/etc/sudoers.d/milobingo-staging-deploy` buiten de actieve sudoers-includes
   en trek rechtstreekse runneractivatie via de legacyhelper in. Toets dat die
   oude sudo-route is geweigerd. De root-owned helper blijft als vastgepinde
   interne library voor verzegelen en herstel behouden. Verwijder daarna de oude
   stagingsecrets: `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `VLAMPIE_SETTINGS_KEY`,
   `OPENAI_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
   `MIGRATION_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`. Controleer daarna de feitelijke
   resterende environmentnamen zonder waarden te lezen of te tonen.
8. Ruim overbodige GitHub-runtimevariabelen op; behoud desgewenst alleen de vier
   publieke kopieën. Leg hashes, configuratie-ID, workflowruns, negatieve
   rechtenproeven en het eindresultaat vast. De oude workflows onder
   `infra/legacy/github/` zijn historisch; activeer ze niet opnieuw als gewone route.

De vaste broker is `/usr/local/bin/dg-milo-deploy`; zijn stdin accepteert alleen
het tijdelijke GitHub-token. De root-owned gate verifieert CI zelfstandig en
haalt het exacte bronarchief op. Het GitHub-bearertoken gaat alleen naar
`api.github.com`. Voor private archives mag uitsluitend de door die API uitgegeven,
begrensde ondertekende query naar het vaste exacte `codeload.github.com`-bronpad
worden gevolgd. De volledige redirect-URL en tokens worden niet gelogd.
De runner checkt geen appcode uit en leest geen
hostgeheimen. Bronextractie, installatiescripts en build draaien als
`build-mil-stg` met een schone omgeving.

De verzegelde kandidaat wordt vóór activatie gelezen door de eigen runtimeaudit
als `app-mil-stg`. PID1 leest daarvoor het private release-envbestand via
`EnvironmentFile`; database-, Storage-, mailcatalogus- en geredigeerde
providercontroles mogen geen data of instellingen schrijven en geen provider
benaderen. Daarna wisselt `current` app en configuratie atomair. Zie het volledige
contract in [infra/protected/README.md](../infra/protected/README.md).

## Bestaande sites, herstel en acceptatie

Milo staging blijft op `127.0.0.1:4173`. Dartflow staging en productie blijven op
respectievelijk `127.0.0.1:4174` en `127.0.0.1:4175`, met hun eigen accounts,
services, bron, configuratie en Caddy-routes. Verander die voor deze migratie niet.
De nieuwe broker gebruikt dezelfde hostbrede `/run/lock/dg-build.lock` en een eigen
sitelock. Alleen een echt lockconflict met exitcode `75` mag begrensd opnieuw
worden geprobeerd.

De bestaande layout met private per-release envbestanden blijft behouden. Nieuwe
releases voegen `.protected.json` toe met bundel-/runtime-/brokerhashes en CI-bewijs.
Een gewijzigde of ingetrokken benodigde bundel blokkeert activatie. Een gezonde,
compatibele legacyvoorganger kan met de oorspronkelijke configuratie worden
hersteld. Dat betekent niet dat een willekeurige oude app alle nieuwe instellingen
begrijpt. Na gebruik van de Resendbeheerroute moet ook een bewuste terugrolrelease
die route ondersteunen; gebruik anders een compatibele correctie vooruit.

Automatische healthrollback bewijst geen databaseherstel, accountaanmelding,
mailbezorging, OpenAI-/LiveKit-toegang, OBS- of hardwareacceptatie. Die controles
blijven releasegebonden. Oude mail-off-, capaciteit- en acceptatieresultaten staan
in de legacydocumenten en worden niet tot actuele resultaten van deze migratie
verklaard. Nieuwe bewijslinks worden na werkelijke uitvoering toegevoegd aan het
projectprofiel en stagingresultaat.
