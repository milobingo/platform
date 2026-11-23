# Milo productie met beschermde hostconfiguratie

Actuele operationele stand: de
[applicatie-uitrol van 23 november](PRODUCTIE-RELEASE-2026-11-23.md) is geslaagd.
De [eigen LiveKit-productieverbinding](LIVEKIT-PRODUCTIE.md) is daarna ingericht
en technisch beproefd. De hieronder gedateerde inrichtingsnotities blijven
behouden als overdracht; zij zijn geen actuele blokkade voor de draaiende site.

De productieprocedure is voorbereid voor dezelfde scheiding als staging:
GitHub start een beoordeelde release, de doel-VPS bewaart infrastructuurgeheimen
en de Milo-regie beheert OpenAI, LiveKit en Resend. Er is geen lange lijst met
GitHub-runtimevariabelen of blijvende GitHub-secrets nodig.

**Stand 15 november 2026: productie is nog niet vrijgegeven.** De eigen
hostaccounts, beschermde deploybroker, appunit en afzonderlijke runner zijn
voorbereid. Het productie-Caddyfragment staat buiten de live import; de app is
niet gestart. De afzonderlijke runner is online en de eigen service actief.
Een volledige versleutelde backup met echte restore, de twee ongewijzigde
schema-initialisaties en de beperkte runtime-login zijn uitgevoerd. De echte
PostgreSQL-controles met `verify-full` slaagden; alle 23 tabellen hebben RLS en
de database-audit heeft geen openstaande migraties of blockers. De eigen
root-only runtimebundel is opgeslagen en door de werkelijk geïnstalleerde
broker gevalideerd. De gebruiker heeft de vijf praktijktests van de bestaande
stagingrelease bevestigd; die verklaring is aan precies die release gebonden
vastgelegd. De nieuwe controlebron moet nog CI doorlopen en publieke
productieactivatie ontbreekt. Het
[operationele resultaat](PRODUCTIE-RESULTAAT-2026-11-15.md) legt
de uitgevoerde handelingen en resterende blokkades vast; de
[voorbereiding](PRODUCTIE-VOORBEREIDING-2026-11-15.md) beschrijft de eigen
hostindeling en credentialoverdracht.

Het productiedomein **`https://milo.dgwebservices.nl`** en het afzonderlijke
Supabase-project **`msupvdycmtbycaonqgan`** (`milobingo-production`, `eu-west-1`)
zijn bevestigd. Het project is via het bestaande gekoppelde account
**Duindorpdoet** beschikbaar; er is geen extra accountkoppeling of nieuw project
nodig. De read-only [productie-inventaris](../verification/provider-management/production-inventory.json)
legt de controle van 11 november 2026 vast.

De bestemming gebruikt `128.140.93.95` op `dg-nxttrack-01` en de eigen
loopbackpoort `4178`. Het project bevat nu de 23 beheerde Milo-tabellen en de
private bucket `milo-private`; er zijn nog geen Auth-gebruikers of
Storage-objecten. Beheer- en app-login zijn afzonderlijk ingericht.
Google-login staat uit; e-mailregistratie staat aan met bevestiging vereist.
Private SMTP- en redirectinstellingen zijn via de beschikbare connector niet
te inspecteren of te wijzigen en zijn nog niet geaccepteerd.

Een renderer maakt alleen beoordeelbare bestanden; zij installeert niets. Het
incomplete [voorbeeldprofiel](../infra/production/profile.example.json) kan geen
productiedeployment activeren. Het concrete openbare
[productieprofiel](../infra/production/profile.json) en de
[productieworkflow](../.github/workflows/deploy-production.yml) staan nu klaar
in de bron. Hun aanwezigheid bewijst geen geslaagde productie-uitrol. Commit
deze controlebron en controleer haar CI; behoud voor deze promotie de al
geaccepteerde appcommit en huidige stagingrelease. Doorloop daarna de
onderstaande vrijgave. Het operationele resultaat is leidend voor de
werkelijk uitgevoerde productievoorbereiding.

## Het bevestigde doel verder inrichten

Het volledige openbare productieprofiel is vastgelegd volgens
[production-profile.mjs](../scripts/deploy/production-profile.mjs). Het profiel
bevat geen secretwaarden. De concrete site, identities, paden en UID/GID-paren
staan in de voorbereiding. De ontbrekende onderdelen zijn:

- de gewenste globale Storage-limiet van ten minste 100 MiB;
- de productie-Auth-inrichting, geslaagde CI van de nieuwe controlebron en
  gecontroleerde productieactivatie.

De oorspronkelijke schema-initialisatie heeft de private bucket `milo-private`
aangemaakt met `file_size_limit=null`: de globale projectlimiet is dan leidend.
De private-bucketcontrole slaagt, maar dat bewijst geen capaciteit van 100 MiB.
Een eerdere expliciete aanmaakpoging met `104857600` bytes is afgewezen omdat de
globale limiet lager staat. De gevraagde verhoging naar minimaal `104857600`
bytes staat nog open in het Supabase-dashboard van het productieproject; de
gebruiker antwoordde hiervoor “Straks”.
Hiervoor is geen extra GitHub-variable of secret nodig.

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

De bundel `production-2026-11-15-v1` is inmiddels atomair zonder overschrijven
opgeslagen in
`/etc/dg-sites/milobingo-production/configs/production-2026-11-15-v1/runtime.json`.
De geïnstalleerde, vastgepinde broker heeft zijn eigen policy, native dependency
en deze bundel werkelijk herlezen en geaccepteerd. De acht infrastructuurvelden
bevatten geen OpenAI-, LiveKit- of Resendkeys en geen `MAIL_MODE`; die sleutels
en het mailbeleid blijven in de versleutelde regie-instellingen. De runtime-login
is ook onafhankelijk opnieuw met echte `verify-full`-authenticatie, alle 23
tabellen en de verboden
bevoegdheden gecontroleerd. Een gevalideerde bundel start of publiceert de app
niet.

De bestaande Supabase-koppeling heeft SQL-beheerrechten voor de afzonderlijk
beoordeelde schema- en rolbootstrap. De huidige connector kan geen private
server-API-key of bestaande databasewachtwoorden ophalen of beheren. Richt de
beperkte appverbinding en server-side Storage-credential via een beschermd kanaal
in op de doelhost; zet ze niet in GitHub. Richt ook Google OAuth, Auth-redirects
en de eigen SMTP-route in en test die met echte accounts. De openbare
projectgegevens hoeven daarvoor niet opnieuw te worden aangeleverd.

Providerkeys zijn geen vereiste envwaarden voor de infrastructuurbuild of het
openen van de beheeromgeving. OpenAI, LiveKit en Resend worden via versleutelde
regie-instellingen ingesteld. Resend begint met verzending uit; een bevoegde
regisseur kan bewust een ontvangerlijst of productieverzending kiezen. De
nieuwe bundel bevat geen `MAIL_MODE`, `MAIL_ALLOWED_RECIPIENTS` of
`SEND_EMAIL_HOOK_SECRET` als verplichte gatewayroute. Zie
[REGIE-SLEUTELS.md](REGIE-SLEUTELS.md).

### Productieaanmelding afmaken

Deze dashboardactie staat nog open. Gebruik het eigen productieproject
`msupvdycmtbycaonqgan`:

1. Zet in **Supabase → Authentication → Sign In / Providers → Google** de
   bedoelde Google-provider aan met de eigen client-ID en clientsecret.
2. Zet bij **Authentication → URL Configuration** de Site URL op
   `https://milo.dgwebservices.nl` en voeg als redirect toe
   `https://milo.dgwebservices.nl/auth/callback**`. De `**` laat ook de gebruikte
   `next`-query op deze callback toe.
3. Voeg in **Google Cloud → APIs & Services → Credentials → de OAuth-client →
   Authorized redirect URIs** exact
   `https://msupvdycmtbycaonqgan.supabase.co/auth/v1/callback` toe.
4. Test daarna een echte productieaanmelding en terugkeer. Koppel pas na die
   eerste aanmelding expliciet de regierol aan de bevestigde juiste identiteit.
   Er zijn nu nul productie-Auth-gebruikers; er is nog geen identiteit om
   veilig regietoegang aan toe te kennen.

Dit configureert geen Supabase Auth SMTP. De SMTP-/mailroute is nog niet
werkelijk op productie getest en vereist een eigen controle. De
gebruikersverklaring over staging bewijst die productie-instellingen niet.

### Eenmalig de Supabase-serversleutel invoeren

De doelgebonden invoerhelper staat in
[intake-production-supabase-key.py](../infra/bootstrap/intake-production-supabase-key.py).
Een beheerder installeert de beoordeelde bytes als
`/usr/local/sbin/milo-productie-supabase`, eigendom `root:root`, modus `0755`.
Dit is een handmatige beheeropdracht; de GitHub-runner krijgt hiervoor geen
sudo-bevoegdheid.

Op 11 november 2026 is deze helper op `dg-nxttrack-01` geïnstalleerd en is de
verborgen invoer in een echte serverterminal gecontroleerd met ongeldige
testinvoer. De productiekey was toen nog niet ingevoerd. De installatie,
codehash en controles staan in
[production-key-intake.json](../verification/provider-management/production-key-intake.json).

1. Open het productieproject `milobingo-production`, ref `msupvdycmtbycaonqgan`,
   in Supabase: **Settings → API Keys → Publishable and secret API keys**.
   Kopieer een secret key met prefix `sb_secret_`. Een eigen key voor Milo
   maakt latere onafhankelijke intrekking mogelijk.
2. Open een vertrouwde interactieve beheerterminal op `dg-nxttrack-01`,
   bijvoorbeeld de serverconsole van het VPS-beheerportaal, en voer uit:

   ```sh
   sudo /usr/local/sbin/milo-productie-supabase
   ```

3. Plak de sleutel uitsluitend bij de verborgen invoerprompt en druk op Enter.
   Tijdens het plakken verschijnen geen tekens. Plaats de sleutel niet achter
   de opdracht, in de chat of in GitHub.
4. Wacht op **Supabase-sleutel gecontroleerd en beschermd opgeslagen.** De helper
   controleert de sleutel met een alleen-lezen Storage-aanvraag aan precies het
   productieproject. Een ongeldige sleutel wordt niet opgeslagen.

De tijdelijke invoerbestemming is
`/root/milo-production-bootstrap/supabase-storage-key.json` (`root:root 0600`
in een `0700`-map). Dit invoerbestand is geen runtimebundel. De invoeropdracht
overschrijft geen andere bestaande sleutel en start geen service of deployment.
Bij de uitgevoerde productie-inrichting is de waarde rechtstreeks op de doelhost
overgenomen in de eigen beschermde runtimebundel. Geen geheime waarde
hoeft daarvoor via GitHub of de dev-VPS te lopen.

De helper beheert geen databasewachtwoord of encryptiemasterkey. Die worden
afzonderlijk voor productie aangemaakt. De schema-, bucket-, host- en
Auth-inrichting en de productieacceptatie hieronder blijven noodzakelijk.

Migratie-/backup-/restorecredentials staan in een apart beschermd beheerpad en
komen niet bij runner, build of app. Schemawijzigingen vereisen een afzonderlijke
backup en werkelijke herstelproef. De gewone broker voert geen automatische
migratie of databaserestore uit.

De geslaagde productiebackup, versleutelde extensiemetadata en herstelbewijs
zijn ook beschermd buiten de doel-VPS gekopieerd; alle hashes zijn tegen het
werkelijke bewijs gecontroleerd. De backup-encryptiesleutel heeft de doel-VPS
niet verlaten. Afzonderlijk sleutelherstel buiten die host is nog niet
bevestigd en moet door beheer worden georganiseerd; alleen de versleutelde
kopie bewijst geen herstelmogelijkheid na verlies van de host én sleutel.
De tijdelijke herstelcontainers, het interne testnetwerk, relays en
herstelcredentials zijn opgeruimd. Backup, masterkeys en runtimebundel zijn
behouden. De nacontrole bevestigt alle zeven bestaande apps gezond en hun
services, Caddyfragmenten, listeners en release-identiteiten ongewijzigd.

## Productie vereist echte stagingacceptatie

De [productiegate](../scripts/deploy/protected-production-root-gate.mjs) controleert
zelfstandig eigen main-afstamming, nieuwste exacte geslaagde CI, de lopende eigen
handmatige productieworkflow en de momenteel gezonde stagingrelease. Staging
moet de kandidaat-SHA én consistente run-/configuratie-identiteit tonen; de
bijbehorende stagingworkflow met `release-gate`, `deploy` en `verify-public` moet
volledig zijn geslaagd.

Daarnaast leest de geïnstalleerde gate een root-only acceptatierecord op het
vaste pad `staging-acceptance/<sha>.json`. Dit record is aan die exacte app-SHA,
stagingrun/poging en release-ID gebonden, is na de betreffende uitrol vastgelegd
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

Voor de huidige promotie antwoordde de gebruiker “Ja alles is getest” op de
vijf praktijktests van appcommit
`17fa1d32cc0c77cfeec544316f215a635c70705b`, stagingrelease `43754522473-1` en
configuratie `staging-2026-11-11-v2`. Deze gebruikersverklaring is in het
root-only acceptatierecord vastgelegd. Codex heeft Google-/mail-/LiveKit-/OBS-
apparatuur of providers niet zelf gerepeteerd. De verklaring wordt niet
stilzwijgend aan een nieuwe appcommit of andere stagingrun gekoppeld.

## Een normale productierelease na volledige inrichting

Commit de beoordeelde openbare profiel-/workflowbron en wacht op haar geslaagde
CI. Voor deze promotie blijft `release_sha` de al geaccepteerde
`17fa1d32cc0c77cfeec544316f215a635c70705b`; de huidige stagingrelease en het
bijbehorende root-only acceptatierecord blijven behouden. Een nieuwe
staging-uitrol van de controlecommit is hiervoor niet nodig.

De publieke verificatie haalt de controlecode en het productieprofiel uit
`github.sha` onder `production-control`. Zij haalt afzonderlijk de gekozen
appcommit op onder `application-source` en voert de controle daar uit, zodat
assetvergelijkingen tegen de werkelijk geaccepteerde appbron gebeuren. De
beschermde deployjob zelf checkt geen code uit. De rootgate en broker controleren
main-afstamming, exacte app-CI, actuele stagingidentiteit en het daaraan gebonden
acceptatierecord ongewijzigd. Start daarna de gerenderde
`deploy-production.yml` handmatig op `main` met deze `release_sha` en
`config_id=production-2026-11-15-v1`.

Een latere wijziging van de appcommit vereist wel eigen geslaagde CI, een
staging-uitrol en een nieuwe aan die release gebonden praktijkacceptatie.

Het GitHub-environment `production` bevat al de volgende vier publieke
variabelen en nul secrets. De publishable key is intern exact vergeleken met
een actieve key van het bevestigde project; de waarde staat niet in het bewijs.

| Bestaande GitHub-variable | Betekenis in de beschermde hostconfiguratie |
| --- | --- |
| `MILO_APP_ORIGIN` | Alias voor `APP_URL`: canoniek `https://milo.dgwebservices.nl`, zonder afsluitende slash. |
| `MILO_DATA_MODE` | Gevalideerde bootstrapkeuze `supabase`; geen native runtime-envveld. |
| `NEXT_PUBLIC_SUPABASE_URL` | Alias voor `SUPABASE_URL`: `https://msupvdycmtbycaonqgan.supabase.co`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Alias voor `SUPABASE_PUBLISHABLE_KEY`; actieve projectkey bevestigd. |

Deze publieke kopieën vullen de hostbundel niet automatisch en vereisen geen
hernoeming in GitHub. De beoordeelde hostbundel is leidend; de private bucketnaam
wordt daar afzonderlijk vastgelegd. Er zijn geen blijvende GitHub-runtime- of
providersecrets nodig. De workflow gebruikt alleen het standaard kortlevende
`github.token`; er is geen PAT, eigen SSH-secret of wrapperhashvariabele nodig.

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
