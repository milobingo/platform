# Milo stagingdeployment met beschermde hostconfiguratie

Deze procedure gebruikt [milobingo/platform](https://github.com/milobingo/platform),
branch `main`, environment `staging` en de bestaande doelhost `dg-nxttrack-01`.
Milo staging blijft bereikbaar via
[https://milo-staging.dgwebservices.nl](https://milo-staging.dgwebservices.nl),
met site `milobingo-staging` en interne poort `127.0.0.1:4173`.

De nieuwe route is in de bron voorbereid. De eenmalige hostmigratie en opschoning
van GitHub moeten afzonderlijk na CI worden uitgevoerd; de huidige stand staat
in [BESCHERMDE-CONFIGURATIE.md](BESCHERMDE-CONFIGURATIE.md). De actieve release en
werkelijk behaalde uitrol-/acceptatiebewijzen staan in
[PROJECTPROFIEL.json](../PROJECTPROFIEL.json) en [STAGING-RESULTAAT.md](STAGING-RESULTAAT.md).

## Gewone release

1. Push de wijziging naar `main` en wacht op geslaagde eigen `CI` voor precies de
   volledige 40-tekens commit-SHA.
2. Start [Deploy Milo staging](https://github.com/milobingo/platform/actions/workflows/deploy-staging.yml)
   handmatig op `main`, met `release_sha` en het bestaande goedgekeurde `config_id`.
   Voor de eerste beschermde bundel is `staging-2026-11-11-v2` voorbereid. Gebruik
   dat ID pas nadat de hostinstallatie en bundel werkelijk zijn gecontroleerd.
3. Wacht op **release-gate**, **deploy** en **verify-public**. Alle drie moeten slagen.
4. Controleer `/api/health`: `revision` moet de gekozen app-SHA zijn, `releaseId`
   de workflowrun met pogingnummer en `configVersion` het opgegeven configuratie-ID.
   Voer daarna de relevante gebruikersacceptatie uit.

```sh
gh workflow run deploy-staging.yml --repo milobingo/platform --ref main \
  -f release_sha='<volledige-groene-main-SHA>' \
  -f config_id='<bestaand-goedgekeurd-hostconfiguratie-ID>'
```

Een push alleen activeert geen release. De workflow-SHA is de bron van de
controlworkflow; de gekozen applicatie-SHA kan een andere toegestane main-commit
zijn. Bind bewijs aan beide identiteiten en aan de echte runtimehealth. Een
geslaagde dispatch betekent alleen dat GitHub de aanvraag heeft aangenomen.

Er is geen `apply_database`-optie in deze gewone route. Een schemawijziging,
rolwijziging, backup of restore is een afzonderlijke beheerhandeling met de eigen
beoordeling en werkelijk herstelbewijs. De retired GitHub-beheerworkflows zijn
bewaard onder `infra/legacy/github/`; zij zijn geen dagelijkse deployinstructie.

## GitHub en hostgrenzen

De workflow heeft geen blijvende runtimevariabelen of secrets uit GitHub nodig.
Zij gebruikt uitsluitend de release/configuratie-inputs en het standaard
kortlevende `GITHUB_TOKEN` met `contents: read` en `actions: read`.
Vier publieke GitHub-variabelen mogen optioneel als herkenningsgegevens blijven
staan: `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_STORAGE_BUCKET`. De beschermde hostbundel blijft leidend.

De dedicated runner is `dg-nxttrack-01-nxttrack-staging`, account `run-mil-stg`,
met labels `[self-hosted, Linux, X64, dg-nxttrack-01, milobingo, staging]`.
De self-hosted deployjob checkt geen appcode uit en krijgt geen database-,
provider-, encryptie-, migratie- of backupsecret. Hij roept uitsluitend aan:

```text
/usr/local/bin/dg-milo-deploy deploy <FULL_SHA> <RUN_ID>-<ATTEMPT> <CONFIG_ID>
stdin: {"githubToken":"<tijdelijk workflowtoken>"}
```

De vaste root-owned broker verifieert opnieuw repository, main-afstamming,
nieuwste geslaagde eigen CI met `verify`-job en de werkelijke lopende handmatige
workflowpoging. GitHub publiceert dispatchinputs niet via runmetadata; het
runbewijs is daarom geen cryptografische koppeling aan het SHA-inputveld.
Kandidaat-SHA en CI worden afzonderlijk bewezen.

De broker downloadt uitsluitend het exacte GitHub-bronarchief. Extractie,
versiecontroles, `pnpm install --frozen-lockfile` en build lopen als
`build-mil-stg` met schone omgeving, vaste toolchain en begrensde systemd-units.
Er komt geen runtimecredential in broncheckout, build of browserbundle.
Alleen gecontroleerde standalone-output wordt verzegeld.

## Configuratie en controle vóór activering

De root-only policy kiest de vaste service, accounts, paden, poort en codepinnen.
De onveranderbare bundel staat onder:

```text
/etc/dg-sites/milobingo-staging/configs/<CONFIG_ID>/runtime.json
```

Runtimegegevens, de bestaande stabiele `VLAMPIE_SETTINGS_KEY` en eventuele
compatibele OpenAI-/LiveKit-fallbacks blijven buiten GitHub. Beheer-/backupgegevens
staan apart en gaan niet naar de app. De broker genereert release-identiteit en
forceert `MAIL_ENVIRONMENT=staging`; de versleutelde regie-instelling bepaalt de
mailmodus en ontvangerlijst. Zie [REGIE-SLEUTELS.md](REGIE-SLEUTELS.md).

Vóór `current` wordt gewisseld draait de kandidaat-audit
`.next/standalone/.milo/runtime-audit.mjs` als `app-mil-stg`. De systemd-manager
leest het beschermde release-envbestand; credentialwaarden staan niet in de
commandoargumenten. De audit controleert beperkte databasebevoegdheden, de
tabellen, private instellingen, beide mailcatalogi en geredigeerde providerstatus.
Geen providerverzoek of database-/objectwijziging is toegestaan. Een mislukte
audit laat de bestaande app en `current` ongemoeid.

## Activatie, gedeelde host en herstel

De bestaande appunit blijft `milobingo-staging.service`, met werkmap
`current/.next/standalone` en het bijbehorende `current/.runtime.env`.
Nieuwe releases voegen `.protected.json` toe; `.release.json` behoudt het v1-contract.
App en configuratie wisselen via één atomische `current`-symlink. Bij een mislukte
activatie herstelt de broker een vooraf gezond bevonden compatibele voorganger
met de oorspronkelijke configuratie. Faalt ook het herstel, dan stopt uitsluitend
de Milo-service.

Bewaar actieve en benodigde vorige releases en bundels. Een bewust herbouwde
oudere main-SHA moet nog steeds eigen groene CI, een geldig configuratie-ID en
compatibiliteit met het huidige schema en de gebruikte beheerinstellingen hebben.
Er is geen nieuw algemeen runnerrollbackcommando toegevoegd. Gericht beheerherstel
volgt het beoordeelde contract; een approllback draait geen data, Auth, Storage,
providerinstellingen of mailhistorie terug.

Na bewezen beschermde activatie wordt de oude rechtstreekse runnerbevoegdheid
uit `/etc/sudoers.d/milobingo-staging-deploy` ingetrokken en negatief getest.
De legacyhelper blijft uitsluitend als root-owned, vastgepinde interne library
behouden; alleen de nieuwe beschermde broker krijgt normale runnerbevoegdheid.
Ook de tijdelijke adminoverdrachtshelper verliest haar tijdelijke sudo-route.

Milo deelt de globale `/run/lock/dg-build.lock` met Dartflow. Een eigen sitelock
en onafhankelijke lockhouder voorkomen voortijdige vrijgave terwijl een build,
audit of appjob nog loopt. Alleen exitcode `75` krijgt de begrensde retries van
de workflow; gewone activatiefouten worden niet opnieuw aangeboden. De
systemd-/descriptor- en afbreekgrens moet werkelijk op de doelhost worden getest.

Dartflow staging (`127.0.0.1:4174`) en productie (`127.0.0.1:4175`) behouden hun
accounts, services, configuraties en Caddy-routes. Controleer beide naast Milo
vóór en na de hostmigratie. Een nieuwe Milo-productiepoort wordt afzonderlijk op
werkelijke beschikbaarheid gecontroleerd.

## Acceptatie en documentatie

Leg bron-/workflow-SHA, CI-/deployrun, config-ID, bron-/code-/runtimehashes,
service-identiteit, loopbackbinding en publieke nacontrole vast. Controleer na
uitrol de echte regietoegang en de nieuwe beheerpagina's. Betaalde providerproeven,
een bewuste proefmail, echte OTP-/Google-aanmelding en een uitzend-/belrepetitie
hebben hun eigen bewijs nodig; health en gesimuleerde browserfixtures vervangen
die niet. Indien OBS niet beschikbaar is, blijven mixercontrole en korte echte
proefopname expliciet open.

Het technische contract staat in [infra/protected/README.md](../infra/protected/README.md).
De eerdere uitgebreide GitHub-route en historische resultaten staan in
[STAGING-DEPLOY-LEGACY-2026-11-10.md](STAGING-DEPLOY-LEGACY-2026-11-10.md). Oude
mail-off- en capaciteitsmetingen worden niet als actuele uitkomst van de nieuwe
release overgenomen.
