# Milo productie met beschermde hostconfiguratie

De productieprocedure is voorbereid voor dezelfde scheiding als staging:
GitHub start een beoordeelde release, de doel-VPS bewaart infrastructuurgeheimen
en de Milo-regie beheert OpenAI, LiveKit en Resend. Er is geen lange lijst met
GitHub-runtimevariabelen of blijvende GitHub-secrets nodig.

**Er is nog geen bevestigd Milo-productiedomein of Supabase-productieproject.**
Daarom is deze pagina geen bewijs van een ingerichte of actieve productieomgeving.
Een renderer maakt alleen beoordeelbare bestanden; zij installeert niets. Het
incomplete [voorbeeldprofiel](../infra/production/profile.example.json) kan geen
productiedeployment activeren. De actuele feitelijke status staat in
[PROJECTPROFIEL.json](../PROJECTPROFIEL.json) en [STAGING-RESULTAAT.md](STAGING-RESULTAAT.md).

## Eerst de echte bestemming bevestigen

Leg het openbare productieprofiel vast volgens
[production-profile.mjs](../scripts/deploy/production-profile.mjs). Het profiel
bevat geen secretwaarden. Bevestig ten minste:

- de eigen site-ID, canonieke HTTPS-origin, DNS en doelhost;
- afzonderlijke runnernaam, runner-, build- en appaccounts, werkelijke UID/GID,
  paden en beheergroep voor de gedeelde buildlock;
- een werkelijk vrije loopbackpoort, eigen systemd-service en uitsluitend het
  eigen Caddy-hostfragment;
- een afzonderlijk Supabase-productieproject met private bucket, beperkte
  runtime-login, publieke CA, Auth-configuratie en oorspronkelijke masterkey
  indien bestaande productiedata wordt overgenomen;
- veilige configuratie-IDs, waaronder de openbare profielversie.

Gebruik geen stagingproject, stagingcredentials of de Milo-stagingaccounts voor
productie. Maak evenmin een nieuw Supabase-project wanneer al een geschikt eigen
productieproject kan worden gekoppeld. Op `dg-nxttrack-01` zijn Milo staging
`4173`, Dartflow staging `4174` en Dartflow productie `4175` bestaande routes;
behoud hun services, accounts, configuratie en data. Controleer alle werkelijke
listeners voordat een nieuwe poort wordt gekozen.

## Renderen voor review

De nieuwe route gebruikt
[protected-production-render.mjs](../scripts/deploy/protected-production-render.mjs)
en [de protected workflowtemplate](../infra/protected/deploy-production.yml.template).
De eerdere omvangrijke GitHub-secretworkflow is geen aanbevolen productieroute.

```sh
node scripts/deploy/protected-production-render.mjs \
  --profile='<bevestigd-openbaar-productieprofiel.json>' \
  --accounts='<gecontroleerde-productie-uid-gid-paren.json>' \
  --config-ids='<bestaande-goedgekeurde-configuratie-IDs.json>' \
  --output='<nieuwe-lokale-reviewmap>'
```

Alle vier argumenten zijn verplicht. Het accountsbestand bevat precies de drie
bevestigde productienamen met positieve, afzonderlijke UID/GID-paren; de
configuratie-ID-array bevat ook de profielversie. Deze bestanden bevatten alleen
openbare metadata. De renderer levert vaste doelgebonden entry/helper/gate,
extractor, lockhouder, beperkte sudoers, rootpolicy, unit, Caddyfragment en
workflow plus codepinnen en installatiebestemmingen in het manifest.

De geïnstalleerde broker krijgt geen runtimekeuze voor site, service, shell,
poort, repository of omgeving. Hij hergebruikt een eigen vastgepinde native
productiehelper voor veilig verzegelen en gekoppelde app/configuratierollback.
De runner krijgt alleen de beschermde brokeringang, geen rechtstreekse
sudo-bevoegdheid voor die interne legacydependency.
Beoordeel de gerenderde bytes en de echte hostinventaris voordat iets wordt
geïnstalleerd. De bestaande staging- en Dartflow-bestanden blijven intact.

## Runtime en beheer op de host

```text
/etc/dg-sites/<bevestigde-productiesite>/
  protected-deploy.json                         root:root 0600
  configs/<config_id>/runtime.json              root:root 0600
  staging-acceptance/<volledige-app-SHA>.json    root:root 0600
```

Private configuratiedirectories zijn root-only `0700`. De runtimebundel bevat de
eigen publieke Supabase-/appwaarden, CA, beperkte databaseverbinding,
Storage-secretkey en stabiele `VLAMPIE_SETTINGS_KEY`. De broker voegt identiteit,
loopbackpoort en de vaste `MAIL_ENVIRONMENT=production` toe. Een gebruikt
configuratie-ID is onveranderbaar; bewaar de actieve en benodigde vorige bundels.

Providerkeys zijn geen vereiste envwaarden voor de infrastructuurbuild of het
openen van de beheeromgeving. OpenAI, LiveKit en Resend worden via versleutelde
regie-instellingen ingesteld. Resend begint met verzending uit; een bevoegde
regisseur kan bewust een ontvangerlijst of productieverzending kiezen. De
nieuwe bundel bevat geen `MAIL_MODE`, `MAIL_ALLOWED_RECIPIENTS` of
`SEND_EMAIL_HOOK_SECRET` als verplichte gatewayroute. Zie
[REGIE-SLEUTELS.md](REGIE-SLEUTELS.md).

Migratie-/backup-/restorecredentials staan in een apart beschermd beheerpad en
komen niet bij runner, build of app. Schemawijzigingen vereisen een afzonderlijke
backup en werkelijke herstelproef. De gewone broker voert geen automatische
migratie of databaserestore uit.

## Productie vereist echte stagingacceptatie

De [productiegate](../scripts/deploy/protected-production-root-gate.mjs) controleert
zelfstandig eigen main-afstamming, nieuwste exacte geslaagde CI, de lopende eigen
handmatige productieworkflow en de momenteel gezonde stagingrelease. Staging
moet de kandidaat-SHA én consistente run-/configuratie-identiteit tonen; de
bijbehorende stagingworkflow met `release-gate`, `deploy` en `verify-public` moet
volledig zijn geslaagd.

Daarnaast leest de geïnstalleerde gate een root-only acceptatierecord op het
vaste pad `staging-acceptance/<sha>.json`. Dit record is aan die exacte app-SHA,
stagingrun/poging en release-ID gebonden, is na de betreffende uitrol waargenomen
en bevat vijf daadwerkelijk geslaagde controles met veilige bewijsverwijzingen:

| Controle-ID | Werkelijk te bewijzen |
| --- | --- |
| `familyAuth` | Echte gezinsaanmelding en terugkeer. |
| `regieAuthorization` | Echte regietoegang en afwijzing zonder die rol. |
| `ordersAndPdf` | Echte bestel-/boekjes-/PDF-flow. |
| `mailGateway` | Werkelijke gekozen mailroute, ontvangst en veilige verwerking van verzendstatus. |
| `showAudioAndLiveCall` | Echte showaudio en belketen, inclusief benodigde uitzendcontrole. |

Ontbrekende, onvolledige, oude, pending of anders gebonden acceptatie blokkeert
promotie. Een gezonde demo, opgeslagen key of gesimuleerde browsertest maakt zo'n
controle niet geslaagd. Het record staat op de beschermde host en hoeft geen
GitHub-variabele `DG_STAGING_ACCEPTANCE_JSON` te worden.

GitHub-runmetadata identificeert de controlworkflow-SHA; die kan verschillen van
de gekozen applicatie-SHA. De gate controleert beide main-bronnen afzonderlijk
en koppelt staging aan de echte health-/runidentiteit. Zij behandelt de
workflow-SHA niet als bewijs van het SHA-inputveld.

## Een normale productierelease na volledige inrichting

Commit de beoordeelde openbare profiel-/workflowbron, wacht op geslaagde CI van
de exacte applicatie-SHA en accepteer diezelfde bron werkelijk op staging.
Installeer/verifieer het root-only acceptatierecord. Start dan de gerenderde
`deploy-production.yml` handmatig op `main` met `release_sha` en `config_id`.

Het GitHub-environment `production` vereist geen blijvende runtime- of
providersecrets. Hoogstens blijven dezelfde vier publieke kopieën optioneel:
`APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_STORAGE_BUCKET`.
De workflow gebruikt alleen het standaard kortlevende `github.token`. Er is geen
PAT, eigen SSH-secret of handmatig onderhouden wrapperhashvariabele nodig.

De dedicated runner checkt geen appcode uit. De rootbroker controleert de gates
opnieuw, bouwt de exacte bron als het afzonderlijke buildaccount en laat de
verzegelde kandidaat vóór activatie als appaccount de read-only backendcontrole
uitvoeren. De gedeelde buildlock, eigen sitelock en onafhankelijke lockhouder
beschermen builds, audit en appjobs. Gewone fouten worden niet herhaald;
alleen echte lockbezetting met exitcode `75` krijgt begrensde retries.

Verifieer na de uitrol loopback én publieke HTTPS, exacte bron/run/configuratie,
anonieme grenzen en de echte gebruikersflow. Bewaar installatiehashes,
CI-/staging-/productieruns, configuratie-ID en de afzonderlijke acceptatiebewijzen.
Voer bij hostwijzigingen ook de nacontrole van Milo staging en beide bestaande
Dartflow-sites uit.

Een approllback koppelt de oude app aan haar oorspronkelijke beschermde
configuratie. Zij draait database, Auth, Storage, versleutelde providerinstellingen
of mailhistorie niet terug. Gebruik alleen compatibele releases en bewaar de
benodigde bundels/masterkey. Een oudere app zonder Resendbeheer is na ingebruikname
van die route geen geschikte bewuste terugrolkeuze.

De oude inrichting is gearchiveerd in
[PRODUCTIE-DEPLOY-LEGACY-2026-11-10.md](PRODUCTIE-DEPLOY-LEGACY-2026-11-10.md).
Het gemeenschappelijke beveiligingscontract staat in
[infra/protected/README.md](../infra/protected/README.md) en
[BESCHERMDE-CONFIGURATIE.md](BESCHERMDE-CONFIGURATIE.md).
