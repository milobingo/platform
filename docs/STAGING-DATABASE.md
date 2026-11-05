# Stagingdatabase: controle, backup en eerste migratie

De bevestigde stagingconfiguratie wijst naar Supabase-project **`lfsdgxcpdyghidzkzzvn`** en privébucket **`milo-staging`**. Deze gegevens komen uit de GitHub-environmentconfiguratie. De twee verbonden Supabase-connectors hebben geen toegang tot dit project. Het gecontroleerde pad gebruikt daarom de GitHub-stagingrunner en diens bestaande secrets. Deze procedure voert zelf geen projectcreatie uit.

`scripts/deploy/database.mjs` controleert standaard uitsluitend met leesbewerkingen. De optionele `--apply` is een afzonderlijke, expliciete handeling met een beoordeelde migratiehash, versleutelde backup en werkelijke hersteltest. De tool is geen algemene upgrade- of resetvoorziening.

## Scheid runtime- en migratiebevoegdheid

| Naam | Gebruik en plaats |
| --- | --- |
| `DATABASE_URL` | Applicatieruntime: een afzonderlijke login met de groep `milo_backend`, zonder superuser-, rolbeheer-, databasebeheer- of RLS-bypassrechten. |
| `MIGRATION_DATABASE_URL` | Nieuwe **deployment-only secret** in GitHub environment `staging`: geautoriseerde beheerverbinding voor inventarisatie, backup en migraties. Nooit aan de Next-runtime of browser doorgeven. |
| `SUPABASE_URL` | Stagingvariabele: `https://lfsdgxcpdyghidzkzzvn.supabase.co`. |
| `SUPABASE_DB_CA_BASE64` | Publieke GitHub-environmentvariabele: de geldige Supabase-database-CA als één regel base64 van PEM. Alleen server-/deployconfiguratie; geen browsersleutel. |
| `SUPABASE_SECRET_KEY` | Bestaande serversecret voor de privébucket. |
| `SUPABASE_STORAGE_BUCKET` | Stagingvariabele: `milo-staging`. |

De CLI gebruikt intern de naam `DATABASE_URL`. De deploymentjob moet **uitsluitend voor de databasecontrole/-migratiestap** `MIGRATION_DATABASE_URL` naar die procesvariabele mappen. De daaropvolgende appactivatie gebruikt de eigen beperkte `DATABASE_URL`. Een eerste diagnostische readonly-audit mag de bestaande `DATABASE_URL` gebruiken om zijn werkelijke rechten te inventariseren; dat maakt een beheerverbinding niet geschikt als app-runtimeverbinding.

De migratie maakt de groep `milo_backend` zonder login. De afzonderlijke gecontroleerde bootstrap hieronder maakt daarna uitsluitend de ontbrekende login `milo_staging_runtime`. Deze login kan gezins-/spelgegevens beheren en `app_user_roles` lezen, maar geen regierol toekennen en geen tabellen beheren. De eerste geverifieerde regiegebruiker blijft een afzonderlijke beheerhandeling. Zie ook [DATABASE-MIGRATIE.md](DATABASE-MIGRATIE.md).

## Readonly-preflight

Gebruik Node en de dependencies uit het lockfile. De audit heeft geen `pg_dump`, `pg_restore`, Docker, backupkey of scratchdatabase nodig:

```bash
node scripts/deploy/database.mjs --expected-project-ref=lfsdgxcpdyghidzkzzvn
```

De job levert `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` en `SUPABASE_STORAGE_BUCKET` via de procesomgeving. Zet geen verbindingswaarden in CLI-argumenten, shelltrace, workflowuitvoer of een artifact. De tool laadt bewust geen `.env`-bestand automatisch.

Als de databaseketen niet onder de standaard Node-truststore valt, levert de job ook `SUPABASE_DB_CA_BASE64`. De gedeelde helper `server/node-postgres-tls.js` valideert het publieke X509-CA-certificaat, behoudt `rejectUnauthorized: true`, verwijdert TLS-overrides en weigert query-overrides van de verbindingsautoriteit. De databasehost blijft via zijn certificaat gecontroleerd. Een `SELF_SIGNED_CERT_IN_CHAIN`-fout wordt opgelost door de juiste CA aan te leveren; zet certificaatcontrole niet uit.

De actuele Supabase-dashboardbron noemt als hosted download [prod-ca-2021.crt](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt). De URL komt uit [de officiële dashboardconfiguratie](https://github.com/supabase/supabase/blob/6d08d66b7d784220ec149fd77e0ba940c6067464/apps/studio/hooks/custom-content/custom-content.json), sleutel `ssl:certificate_url`. `prod` verwijst hier naar het gehoste Supabase-dashboard, ook wanneer onze appomgeving staging heet. Gecontroleerd op 5 november 2026: **Supabase Root 2021 CA**, geldig tot 26 april 2031, SHA256-certificaatfingerprint `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`. Download en controleer de CA opnieuw bij rotatie; een geslaagde geverifieerde projectverbinding moet aantonen dat dit certificaat bij de daadwerkelijke keten hoort.

Gebruik bijvoorbeeld een gecontroleerd gedownload PEM-bestand en `base64 -w0` om de publieke environmentvariabele te vullen. Een CA bevat geen private key. De variabele gaat uitsluitend naar de serverconfiguratie, de databasegate en de backuplaag; er is geen `NEXT_PUBLIC_*`-variant nodig.

De preflight:

1. Vergelijkt de expliciet bevestigde projectref met de HTTPS-API-origin en de directe databasehost, of de projectgebonden sessiepoolergebruiker. Een ander project, transactiepools op poort 6543 en ongeverifieerde TLS zijn geblokkeerd.
2. Controleert de werkelijke pg-client-TLSSocket: versleuteld, geautoriseerd en met een peercertificaat dat bij de bevestigde databasehost hoort. `connection.tls` en `tlsAuthorized` beschrijven dit geverifieerde clienttransport. `backendTls` rapporteert afzonderlijk de PostgreSQL-status achter de pooler; die interne verbinding kan `false` zijn terwijl de client geverifieerde TLS gebruikt. De audit rapporteert ook PostgreSQL-versie, extensienamen/-versies, `databaseSizeBytes` en de rechten van de huidige databasegebruiker. Er worden geen wachtwoorden of volledige verbindingsstrings gerapporteerd.
3. Inventariseert de 18 applicatietabellen, kolommen, primaire sleutels, indexen, constraints, RLS, policies, grants en de beperkte backendgroep.
4. Vergelijkt de gecommitte migratiebestanden met de checksumhistorie en de opgeslagen schemafingerprint. Nieuwe browsergrants, gewijzigde kolommen/policies/indexen en gewijzigde historische SQL geven een blokkade.
5. Leest de bevestigde Storagebucket via de API. Die moet privé zijn, `application/json` toelaten en geen kleinere limiet dan 100 MiB hebben; een onbeperkte bucketlimiet is toegestaan.

De JSON-uitvoer bevat onder meer `ok`, `projectRef`, `connection`, `applicationTables`, `managed`, `historyReadable`, `migrations`, `pending`, `migrationManifestDigest`, `schemaDigest`, `storage` en `blockers`. Een bekende databasefoutcode kan worden gemeld; onbewerkte driver-/toolberichten blijven uit de logs. `ok: false` geeft exitcode 1. Ook een lege appdatabase geeft eerst een pending-migratie en exitcode 1: een audit past nooit automatisch SQL toe.

De historie staat in **`milo_deploy.migrations`**, buiten het blootgestelde `public`-schema en zonder browserrechten. Een beperkte runtimegebruiker kan die privéhistorie niet lezen; de audit meldt dan `history_not_readable` en geen verzonnen lege historie. Gebruik voor de releasegate de migratieverbinding.

## Vereisten voor bewuste toepassing

De extra vereisten zijn nu afzonderlijke nog te provisionen deploymentconfiguratie. Bestaande runtimegeheimen zijn geen vervanging:

| Naam / voorziening | Vereiste |
| --- | --- |
| `BACKUP_ENCRYPTION_KEY` | Nieuwe afzonderlijke **deployment-only secret** van 32 bytes als 64 hextekens. Bewaar hem veilig buiten de backupbestanden. Niet de settings-encryptiesleutel hergebruiken. |
| `RESTORE_TEST_DATABASE_URL` | Nieuwe **deployment-only secret** voor een afzonderlijke lege lokale database. Host uitsluitend loopback; databasenaam `milo_restore_test_*`; dezelfde PostgreSQL-major als de bron. |
| `DATABASE_BACKUP_DIRECTORY` | Bevestigde absolute backuplocatie buiten checkout en releases, met directorymodus `0700`. Bestanden worden `0600`. Regel persistentie, capaciteit, bewaarbeleid en een externe veilige kopie. |
| `RELEASE_SHA` | De volledige 40-tekens broncommit waarvoor de vereiste CI groen is. Het workflow controleert de CI-/checkoutkoppeling afzonderlijk. |
| `pg_dump`, `pg_restore` | Native clienttools op het pad, beide van dezelfde major als de bron. De tool installeert deze niet. |
| Herstelserver | Voorzien van de extensiebinaries die het Supabase-dump vereist. Een kale PostgreSQL-installatie ondersteunt niet automatisch alle Supabase-extensies. |
| Bevoegd beheeraccount | Schema-/rolbeheer en volledige backupleestoegang. De beperkte app-login is hiervoor ongeschikt. |

Er is geen Dockerafhankelijkheid in het productiepad. Als de runner nog geen geschikte Node-/PostgreSQL-tools, backuplocatie, herstelserver of bevoegdheden heeft, moeten die eerst via het bevestigde hostbeheer worden ingericht. Het ontbreken daarvan is een echte releaseblokkade. De tool bevat geen vlag om backup/herstel over te slaan, ook niet bij nul bestaande app-tabellen: er kunnen Auth-, Storage- of andere projectgegevens zijn.

## Eerste toepassing

Lees de audit en beoordeel de exacte checksum van elk SQL-bestand. Neem **`migrationManifestDigest`** uit de audit over als expliciete review-input; gebruik niet alleen een losse bestandsnaam of branchnaam. De bestaande migratie `20261104115830_milo_friends_server_schema.sql` blijft onveranderd.

```bash
node scripts/deploy/database.mjs \
  --expected-project-ref=lfsdgxcpdyghidzkzzvn \
  --apply \
  --reviewed-manifest-sha256='<vooraf-beoordeelde-migrationManifestDigest>'
```

Deze opdracht:

1. Controleert configuratie, reviewhash, rechten en het bestaande schema. Als er al applicatietabellen zijn zonder bewezen bijpassende historie, stopt hij. Gedeeltelijke schema's en onbekende upgrades worden niet geadopteerd of gereset.
2. Verkrijgt een PostgreSQL-advisory lock op de migratieverbinding en herhaalt de preflight. Een tweede deployment kan zo niet tegelijk dezelfde bootstrap uitvoeren.
3. Meet `pg_database_size` en de werkelijk beschikbare bytes van het backupfilesystem. Minder dan tweemaal die databaseomvang plus 512 MiB reserve blokkeert de dump. Maakt daarna een volledige databasebackup met `pg_dump` vanuit een geëxporteerde consistente snapshot. Een aangeleverde gevalideerde CA wordt tijdelijk als PEM met rechten `0600` beschikbaar gemaakt voor `PGSSLROOTCERT`; `pg_dump` gebruikt `verify-full`. Het tijdelijke bestand wordt na afloop verwijderd. Alleen versleutelde dumpbytes gaan naar schijf, via AES-256-GCM met een willekeurige nonce. Credentials worden via een afgebakende subprocessomgeving doorgegeven, niet via procesargumenten. Toolstderr wordt niet in Actions afgedrukt.
4. Authenticeert het volledige versleutelde bestand en herstelt het met `pg_restore --single-transaction --exit-on-error` in de afzonderlijke lege lokale hersteltestdatabase. Dump en restore behouden eigenaarschap en ACLs; de tool gebruikt geen `--no-owner` of `--no-privileges`. Ontbrekende bronrolnamen worden op de scratchserver uitsluitend zonder login aangemaakt; wachtwoorden en verhoogde clusterrolattributen worden niet gekopieerd. Bestaande scratchtabellen blokkeren de procedure; hij maakt de scratchdatabase niet leeg.
5. Vergelijkt tabeltotalen, aantallen rijen per tabel en inhoudschecksums van de bron-snapshot met de herstelde database. Vergelijkt daarnaast tabel-/schema-eigenaarschap, tabel-/schemagrants, default privileges, RLS en policies via een eigen beveiligingsfingerprint. Een verschil blokkeert de migratie. Alleen bij gelijkheid wordt een apart bewijsbestand geschreven met de versleutelde bestands-SHA256, release-SHA, projectref en `restoreVerified: true`.
6. Past uitsluitend bij nul bestaande app-tabellen de gecommitte migratie toe, samen met de private checksumhistorie, in één transactie. Een ontbrekende RLS-policy, verkeerde grant of ander onjuist eindcontract draait die transactie volledig terug.
7. Controleert daarna afzonderlijk de **bevestigde** bucket `milo-staging`. Ontbreekt die, dan wordt hij privé met JSON-toegang en een limiet van 100 MiB aangemaakt. Een bestaande ongeschikte bucket wordt niet stilzwijgend aangepast.
8. Herhaalt de volledige audit. Pas na `ok: true` mag het workflow appactivatie toestaan.

De onveranderde bronmigratie kan daarnaast bucket `milo-private` aanmaken als het Storage-schema bestaat. Dat is een historisch migratie-effect; de app blijft de expliciet ingestelde `milo-staging` gebruiken. De tool herschrijft de oude SQL of hash niet en wisselt de runtimebucket niet om. Verwijder de extra bucket later alleen via een afzonderlijk beoordeelde wijziging, na controle dat hij geen objecten bevat of door een bestaande app wordt gebruikt.

Een herhaling zonder pending SQL en met een ontbrekende bevestigde bucket kan uitsluitend die Storagevoorwaarde repareren, met dezelfde expliciete backup-/reviewvereisten. Een reeds volledig gecontroleerde omgeving rapporteert `changed: false` en past niets opnieuw toe.

## Afzonderlijke database- en runtimebootstrap

De handmatige workflow **`staging-database-apply.yml`** voert uitsluitend de databasebootstrap uit. Hij vereist de eigen geslaagde main-CI voor de exacte opgegeven broncommit, de stagingomgeving en de bevestigde runner. De migratieverbinding komt uitsluitend uit `MIGRATION_DATABASE_URL`. De migratiehash wordt uit die gecontroleerde bron bepaald. Versleutelde backup en werkelijke volledige hersteltest blijven verplicht; deze workflow bouwt of activeert geen app.

Gebruik daarna voor dezelfde broncommit de handmatige workflow **`staging-runtime.yml`**, met de exacte `backup_id` uit het geslaagde herstelbewijs. Hij voert `scripts/deploy/provision-runtime.mjs` uit. De tool:

1. Controleert het bestaande private bewijsbestand en de versleutelde dump onder `/var/backups/milobingo-staging`: normale runnerbestanden met rechten `0600`, geen symlinks of extra hardlinks, overeenkomende bestands-SHA256, projectref, broncommit, rij-/securitychecksums en `restoreVerified: true`. Het bewijs moet maximaal één uur oud zijn. Een ontbrekend of ongeschikt bewijs opent geen databaseverbinding.
2. Reserveert exclusief `runtime-output.json` met rechten `0600`; een bestaande overdracht wordt nooit overschreven. Vereist daarna de volledige beheerde historie en alle 18 gecontroleerde tabellen, zonder pending migraties of Storageblokkades. Onder hetzelfde advisory lock als de migratie volgt opnieuw de volledige audit en controle dat de migratiehistorie precies naar deze backup en broncommit verwijst.
3. Maakt uitsluitend de ontbrekende vaste login `milo_staging_runtime`, met `LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. Het enige lidmaatschap is `milo_backend`, zonder mogelijkheid om met `SET ROLE` naar die groep te wisselen. Een bestaand account wordt geweigerd; er is geen wachtwoordresetpad. Ongewenste geërfde `CREATE`-rechten op `public` of schrijfrechten op `app_user_roles` draaien de roltransactie terug.
4. Genereert een willekeurig wachtwoord in procesgeheugen en schrijft uitsluitend de afgeleide SCRAM-SHA-256-verifier in de SQL-opdracht. De afgeleide URL wordt vóór de roltransactie alleen als `{ "DATABASE_URL": "…" }` naar het gereserveerde private bestand geschreven en gefsynct, zodat een fout na commit geen herstelbare login achterlaat waarvan het wachtwoord verloren is. Een fout vóór de commitpoging verwijdert dit bestand weer.
5. Na commit moet een nieuwe verbinding met het nieuwe wachtwoord werkelijk authenticeren, de TLS-peer verifiëren, de beperkte rol-/lidmaatschapscontrole doorstaan en alle 18 tabellen kunnen lezen met `LIMIT 0`. Logs bevatten alleen veilige metadata. Een fout na rolcommit of tijdens een onzekere commitbevestiging meldt `partial_runtime_provision`; de private overdracht blijft voor beheerherstel bestaan, deployment stopt en het account wordt niet automatisch verwijderd of opnieuw ingesteld. Aanwezigheid van het bestand bewijst geen geslaagde verificatie en geeft geen toestemming om de URL als appsecret te publiceren.

De bevoegde rootbootstrap bewaart **eerst** de bestaande beheerverbinding onder environmentsecret `MIGRATION_DATABASE_URL`. Pas na een geslaagde provisioningworkflow én een onafhankelijke controle van de nieuwe login consumeert hij de runtimeoverdracht via een afgebakende secret-writeprocedure, zet de nieuwe URL als environmentsecret `DATABASE_URL` en verwijdert de overdracht onmiddellijk. Waarden gaan via stdin of versleutelde GitHub-secretpayloads; nooit via chat, logs, artifacts, Git of commandoregelargumenten. Het gewone workflowtoken heeft alleen `contents: read` en `actions: read` en kan deze secrets niet bijwerken. Gebruik daarvoor de bevoegde beheerroute; geef een buildproces geen extra GitHub-rechten. Controleer vervolgens met een nieuwe workflowrun onafhankelijk de beperkte runtime-login voordat de app wordt geactiveerd.

Een script of geslaagde fixture is geen bewijs dat deze twee handmatige stappen op staging zijn uitgevoerd. Bewaar de concrete runlinks, backupidentiteit en controle-uitkomsten bij de deploymentregistratie.

## Bewijs, herstel en beperkingen

Bewaar het versleutelde `.dump.aesgcm`-bestand, het `.proof.json`-bestand en hun veilige opslaglocatie. Het bewijsbestand bevat geen gezinsinhoud of credentials. De backuplaag gebruikt dezelfde consistente snapshot voor dump en rijchecksums. Een backup van vóór de migratie wordt niet ongeldig doordat gewone accountgegevens daarna veranderen, maar het blijft het herstelpunt van dat tijdstip.

De lokale hersteltestdatabase bevat na succes **echte herstelde gegevens**. Laat de beheerder deze afgesproken tijdelijke database en eventuele alleen voor de proef aangemaakte rollen meteen gecontroleerd verwijderen. De tool dropt of reset geen database. Bewaar de scratchserver en zijn opslag niet als een onbeheerde extra kopie. Richt voor een volgende run een nieuwe lege hersteltestdatabase in.

Een PostgreSQL-dump bevat eigenaarschap en database-ACLs, maar geen Storage-objectbytes en geen clusterbrede loginwachtwoorden, rolattributen of rollidmaatschappen. Bewaar eventuele objectbackups en het toegangs-/providerherstelpad daarom afzonderlijk. De hersteltest bewijst het database-eigenaarschap en de genoemde ACL/RLS-metadata; hij beweert niet dat de volledige clusterrolconfiguratie is gekloond. De huidige migratie verandert geen bestaande objectinhoud; ook dat maakt een databasedump geen volledige Supabase-projectbackup.

Een geschikte herstelserver moet de vereiste extensies en migratierechten ondersteunen. Een succesvolle kleine lokale fixture bewijst niet dat een volledige echte Supabase-dump met alle projectextensies al herstelbaar is. De echte snapshot moet de werkelijke scratchhersteltest tijdens `--apply` doorstaan.

Controleer vóór uitvoering daarnaast vrije bytes/inodes van het **werkelijke PostgreSQL-datavolume** en ruimte voor herstel, WAL, de actieve app en de nieuwe build. Een loopback-database kan in een ander filesystem draaien; de Node-tool kan dat niet betrouwbaar afleiden uit een TCP-verbinding. Hij rapporteert daarom uitsluitend de gemeten backupcapaciteit en het werkelijke herstelresultaat, geen verzonnen vrije ruimte van de herstelserver.

Bij mislukte backup of hersteltest wordt geen bronmigratie uitgevoerd en wordt geen geslaagd bewijsbestand uitgegeven. Bij een SQL-fout wordt de migratietransactie teruggedraaid. Als de database al gecommit is en een latere Storage- of nacontrole faalt, meldt de tool **`partial_database_apply`**. Stop dan appactivatie, bewaar backup/historie en onderzoek de nog actieve app. Een applicatierollback draait de database en bucketconfiguratie niet terug. De tool past geen automatische databaserestore op de bron toe.

Een groene databasegate bewijst geen OTP-mail, Google-login, regietoekenning, AI, LiveKit of browseracceptatie. Die controles blijven afzonderlijk onderdeel van stagingacceptatie.

## Tests

```bash
node --test tests/check-deploy-database.mjs
MILO_TEST_DATABASE_URL='<aparte-lokale-testdatabase>' node --test tests/check-deploy-database.mjs
```

De integratietests gebruiken alleen loopback en een databasenaam met `test`, maken eigen tijdelijke databases en verwijderen die daarna. Ze testen op echte PostgreSQL-tabellen: unmanaged weigering, onveranderde migratie, atomaire rollback, checksumhistorie, beperkte bucketkeuze en detectie van schema-/rechten-/historiedrift. De werkelijke `pg_dump`-/`pg_restore`-test draait wanneer passende native clienttools beschikbaar zijn; anders meldt die test expliciet een skip. Voor de lokale testomgeving kan uitsluitend de testcode een reeds aanwezige PostgreSQL-testcontainer gebruiken via `MILO_TEST_POSTGRES_CONTAINER`; de deploymenttool zelf kent die variabele niet.

Tijdens implementatie zijn alle **acht databasetests** geslaagd met PostgreSQL **17.11**, inclusief de werkelijke dump, streamingversleuteling, afzonderlijke restore, gegevenschecksums, behoud van een afzonderlijke tabeleigenaar plus readonly-grant/RLS-policy, het capaciteitsslot en een echte TLS-handshake met aparte pooler/backendstatus. De vier tests in `tests/check-provision-runtime.mjs` controleren bewijsblokkades, private overdracht en echte SCRAM-authenticatie met PostgreSQL; ze bewijzen ook dat de nieuwe login geen app-rollen kan toekennen, DDL kan uitvoeren of migratiehistorie kan lezen. Een remote migratie of runtimeprovisioning op het stagingproject is hiermee nog niet bewezen.

Primaire bronnen: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage API-sleutels](https://supabase.com/docs/guides/api/api-keys), [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html), [Supabase CLI v3](https://supabase.com/changelog/supabase-cli-v3).
