# Tijdelijke volledige hersteltest voor Milo staging

Status op 5 november 2026: alleen deze procedure is voorbereid. Er is hiervoor geen image opgehaald, container gestart, tunnel gemaakt, PostgreSQL-client geïnstalleerd of database gewijzigd. De bronmajor en extensie-inventaris moeten eerst uit de geverifieerde stagingverbinding komen.

De applicatie blijft een native Node/systemd-deployment. Alleen de afzonderlijke hersteltestdatabase draait tijdelijk in een container op de werkmachine. `pg_dump` en `pg_restore` draaien native op `dg-nxttrack-01`. De stagingdatabase wordt pas gemigreerd nadat de versleutelde volledige dump succesvol is teruggezet en de bestaande inhouds- en beveiligingsvergelijkingen slagen.

## Vastgestelde mogelijkheden

- Host: Ubuntu **24.04 noble amd64**, circa **138,9 GiB** vrij; `curl`, `gpg` en `apt-get` aanwezig. Geen PostgreSQL-tools, Docker of Podman aangetroffen.
- Werkmachine: rootless Docker **29.6.2**, circa **21 GiB** vrij. Gecachte officiële Supabase-image `public.ecr.aws/supabase/postgres:17.11.0.002`, circa 1,7 GB, immutable digest `sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53`. Er zijn tevens oudere 17.6- en 15.8-images gecachet; kies pas na inventarisatie.
- De hostpoort **127.0.0.1:55433** was vrij bij de controle. Iedere uitvoering controleert de poort opnieuw. Een bestaande listener wordt nooit vervangen of beëindigd.
- De tijdelijke beheerderssleutel is geldig tot **5 november 2026 17:48 UTC**. De rootregistratie weigert forwarding; de tunnel gebruikt uitsluitend de tijdelijke normale registratie bij **`dgadmin`**. Hostopruiming verwijdert beide registraties. Een volgende uitvoering moet vooraf passende, begrensde scratch-/tunneltoegang regelen. Een oude `RESTORE_TEST_DATABASE_URL` is geen blijvende voorziening.

## Eerst versie en extensies vaststellen

Gebruik uitsluitend de geverifieerde bronverbinding voor deze read-only inventaris, zonder verbindings-URL of wachtwoord af te drukken:

```sql
SELECT version(), current_setting('server_version_num') AS server_version_num,
       pg_database_size(current_database()) AS source_bytes;
SELECT e.extname, e.extversion, n.nspname AS schema,
       a.default_version AS available_default_version
FROM pg_extension e
JOIN pg_namespace n ON n.oid=e.extnamespace
LEFT JOIN pg_available_extensions a ON a.name=e.extname
ORDER BY e.extname;
SELECT name, setting FROM pg_settings
WHERE name IN ('shared_preload_libraries', 'session_preload_libraries',
               'cron.database_name', 'cron.launch_active_jobs')
ORDER BY name;
```

De clientmajor én scratchmajor moeten gelijk zijn aan de bronmajor. De gecachte 17.11-image is daarom alleen een kandidaat bij bronmajor 17. Controleer bovendien of iedere bronextensie met de vereiste versie en functies in de gekozen image beschikbaar is. `CREATE EXTENSION` uit een dump kan de doel-defaultversie kiezen; een andere extensieversie kan de strikte inhouds-/beveiligingsvergelijking laten mislukken. Alleen dezelfde PostgreSQL-major bewijst deze compatibiliteit niet. Laat incompatibiliteit de migratie blokkeren; verwijder geen dumpobjecten of privileges om een groene test te verkrijgen.

Een eerste kandidatencontrole gebruikt de image-identiteit en publieke broncode; na expliciet starten van de lege scratchcluster kan `pg_available_extension_versions` daar de werkelijke beschikbare versies bevestigen. Pas de benodigde preloads toe vóór de restore. `pg_cron` vereist bij gebruik zijn preload en de nieuwe scratchdatabasenaam als `cron.database_name`; houd taakuitvoering uitgeschakeld. Start geen Auth-, Storage-, Realtime-, Edge- of andere Supabase-services voor deze proef.

## Native clients voorbereiden

De voorbereide installer volgt de [officiële PGDG-handleiding voor Ubuntu](https://www.postgresql.org/download/linux/ubuntu/). Hij controleert host, Ubuntuversie, architectuur en de officiële primaire sleutelvingerafdruk `B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8`. Hij weigert afwijkende bestaande PGDG-configuratie en vraagt alleen `postgresql-client-MAJOR` aan, zonder server of ongebonden metapackage.

```bash
# Vervang 17 uitsluitend door de daadwerkelijk bevestigde bronmajor.
bash scripts/deploy/install-postgres-client.sh --source-major=17
# Na controle van de bronmajor, als bevoegde hostbeheerder:
bash scripts/deploy/install-postgres-client.sh --source-major=17 --install
```

Controleer daarna dat `pg_dump --version` en `pg_restore --version` op het workflowpad dezelfde major tonen. De databaseprocedure controleert dit opnieuw. Los verschillende majors op via een expliciet clientpad; vervang geen tools van andere DG-projecten.

De Supabase-imagebinaries rechtstreeks op Ubuntu uitpakken is geen aanbevolen alternatief: de 17.11-image gebruikt Alpine en een absolute Nix-store met bijbehorende libraries en extensies. Alleen een PostgreSQL-binary kopiëren levert geen bewezen native runtime op. De tijdelijke scratchcontainer voorkomt die extra installatiecomplexiteit.

## Per uitvoering een nieuwe scratchcluster

Onderstaande opdrachten zijn een **nog niet uitgevoerde** beheerdersrecipe. Vul een unieke, gecontroleerde release-ID, een vrije private werkmachinepoort uit `543xx`, een passend image-digest en de beoordeelde preloadlijst in. Gebruik nooit een bestaande projectcontainer of database. Meet vóór de start de vrije bytes én inodes op het Docker-datafilesystem met `docker info --format '{{.DockerRootDir}}'`, `df -B1` en `df -i`. Reserveer daar ten minste tweemaal de brondatabaseomvang plus 1 GiB; de bestaande deploycontrole op de hostbackuplocatie vervangt deze afzonderlijke workercontrole niet.

Maak op de werkmachine een private tijdelijke map (0700) met een nieuw willekeurig scratchwachtwoord in een env-bestand (0600). Dat bestand bevat uitsluitend `POSTGRES_USER=restore_admin`, `POSTGRES_DB=postgres` en de tijdelijke `POSTGRES_PASSWORD`; geen Supabase-, migratie-, applicatie- of cloudcredentials. Het wachtwoord komt niet in opdrachtargumenten, logs of deze documentatie. Gebruik bijvoorbeeld een private credentialinvoer of een lokale generator die rechtstreeks naar dat bestand schrijft.

```bash
# Voorbeeldnamen; alle waarden vooraf controleren. Geen opdracht hiervan is uitgevoerd.
release_id=RUN_ID_ATTEMPT
scratch_name="milo-restore-$release_id"
scratch_network="milo-restore-$release_id"
scratch_db="milo_restore_test_${release_id//-/_}"
scratch_port=54387
scratch_env=/PRIVATE_TEMP_DIRECTORY/scratch.env
scratch_image=public.ecr.aws/supabase/postgres@sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53
scratch_preloads=REVIEWED_SOURCE_COMPATIBLE_PRELOAD_LIST

# Eerst: bronmajor 17 bevestigd, image/extensies beoordeeld, namen en poort vrij,
# vrije bytes/inodes voldoende. Bij een afwijkende bronmajor deze image niet gebruiken.
docker network create --internal "$scratch_network"
docker run --detach --rm --pull=never \
  --name "$scratch_name" --network "$scratch_network" \
  --publish "127.0.0.1:$scratch_port:5432" \
  --user postgres --cap-drop ALL --security-opt no-new-privileges \
  --cpus 2 --memory 2g --pids-limit 256 \
  --tmpfs /docker-entrypoint-initdb.d:ro \
  --env-file "$scratch_env" \
  "$scratch_image" postgres -D /var/lib/postgresql/data \
  -c "shared_preload_libraries=$scratch_preloads" \
  -c "cron.database_name=$scratch_db" -c cron.launch_active_jobs=off

# Wacht op gereedheid; gebruik de interne lokale socket voor deze beheerdersactie.
docker exec --user postgres "$scratch_name" pg_isready -U restore_admin -d postgres
docker exec --user postgres "$scratch_name" createdb \
  -U restore_admin --template=template0 "$scratch_db"
```

Het lege mount op `/docker-entrypoint-initdb.d` voorkomt automatisch uitvoeren van de Supabase-initmigraties. De expliciete `-D /var/lib/postgresql/data` gebruikt de nieuwe clusterconfiguratie, in plaats van de meegeleverde serviceconfiguratie onder `/etc/postgresql`. `--user postgres` gebruikt de in de image aanwezige eigenaar van deze directories; een rootless UID-mapping kan zijn eigen writable containerlaag aanmaken. De naamloze containerlaag wordt bij stoppen verwijderd; er is geen hostdirectory of Docker-socket gemount. De interne Docker-network voorkomt externe provider-/jobverbindingen uit de gerestaureerde database; verifieer de private gepubliceerde poort en netwerkisolatie vóór het ontvangen van dumpdata. Er wordt geen image opgehaald dankzij `--pull=never`.

Gebruik expliciet [TEMPLATE template0](https://www.postgresql.org/docs/17/manage-ag-templatedbs.html) voor iedere nieuwe `milo_restore_test_*`-database. De vooraf gevulde `postgres`-database van een gewone Supabase-start voldoet niet aan de leegtecontrole. Installeer vooraf geen extensietabellen of views in de scratchdatabase: de huidige restorecontrole eist nul niet-systeemrelaties. Benodigde extensiebinaries/preloads horen bij de cluster/image; het dumpbestand maakt de databaseobjecten aan. Controleer vooraf dat de scratchlogin echt superuser is, de database de juiste major heeft en de bestaande leegtequery nul oplevert.

## Tijdelijke loopbacktunnel en workflowsecret

Start de tunnel vanaf de werkmachine naar de host, uitsluitend zolang deze restore-uitvoering loopt. Controleer eerst opnieuw dat hostpoort 55433 én de gekozen werkmachinepoort exclusief voor deze uitvoering beschikbaar zijn. Gebruik geen `-g`, wildcardbind of `GatewayPorts`-verruiming. Als de key of tunnel niet beschikbaar is, wordt niet gemigreerd.

```bash
ssh -i /home/codex/.ssh/milobingo_staging_ed25519 \
  -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 -N \
  -R "127.0.0.1:55433:127.0.0.1:$scratch_port" dgadmin@dg-nxttrack-01
```

Bewaar het exacte tunnelproces/PID voor opruiming. Verifieer via de hostverbinding de verwachte nieuwe scratchdatabasenaam, major en lege database voordat een workflow wordt gestart. Een succesvolle bind alleen bewijst geen bereikbare database. `RESTORE_TEST_DATABASE_URL` wijst dan naar `postgresql://restore_admin:...@127.0.0.1:55433/milo_restore_test_...`; plaats de waarde via private stdin in het deployment-only GitHub-stagingsecret, zonder de URL af te drukken. Genereer voor iedere uitvoering een nieuw wachtwoord en een nieuwe database. De tunnel vervangt de publieke Supabase-bronverbinding niet: die blijft TLS met de geverifieerde CA gebruiken.

Laat de bestaande databaseprocedure de volledige versleutelde dump maken en herstellen met `pg_restore --single-transaction --exit-on-error`. Behoud owners en grants; gebruik geen `--no-owner`, `--no-acl`, schemaselectie of Supabase-CLI-filtering als vervanging voor dit volledige bewijs. Het script maakt ontbrekende bronrolnamen in de scratchcluster als NOLOGIN aan; het kopieert geen clusterwachtwoorden of verhoogde rolattributen. Alleen een geslaagde inhouds-, schema-/tabeleigenaar-, ACL-, default-privilege- en RLS-vergelijking geeft toestemming voor de migratietransactie.

## Opruiming en bewijs

Na succes, fout, afgebroken workflow of naderende afloop van de tijdelijke toegang:

1. Stop de exacte scratchcontainer met `docker stop "$scratch_name"`; controleer dat de `--rm`-container en zijn writable data verdwenen zijn. Verwijder uitsluitend het bijbehorende tijdelijke network met `docker network rm "$scratch_network"`.
2. Beëindig en wacht op het exacte SSH-tunnelproces. Controleer dat host `127.0.0.1:55433` en de gekozen werkmachinepoort geen listener van deze uitvoering meer hebben.
3. Verwijder het stagingsecret **`RESTORE_TEST_DATABASE_URL`** wanneer de scratch stopt. Verwijder het private scratch-envbestand en de tijdelijke map. Laat geen verouderde herstelverbinding actief voor een volgende deploy.
4. Bewaar de versleutelde backup en het gekoppelde bewijsbestand in de beschermde hostbackuplocatie volgens de bewaartermijn. Verwijder of vervang de backup-encryptiesleutel niet als onderdeel van scratchopruiming.
5. Noteer release-ID, image-digest, bron/scratchmajor, extensie-inventaris, poorten, succesvolle herstelvergelijking of concrete fout en bevestigde opruiming. Meld een mislukte proef niet als geslaagde migratie.

Dit bewijs betreft de inhoud en de gecontroleerde objectrechten van de databasedump. [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) neemt geen clusterrollen/wachtwoorden mee. De huidige restore naar een vooraf gemaakte andere databasenaam gebruikt geen `--create`; databasebrede ACLs en database-/rolinstellingen vallen daarmee buiten de bestaande schema-/tabelvergelijking. Die begrenzing volgt uit [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html). [Supabase-backups](https://supabase.com/docs/guides/platform/backups) bevatten bovendien geen Storage-objectbytes. Deze proef is dus geen kloon van de volledige Supabase-accountconfiguratie.

Bronnen voor het imagecontract: [officiële Supabase Postgres Dockerfile 17.11.0.002](https://github.com/supabase/postgres/blob/17.11.0.002/Dockerfile-17), [Supabase herstelcompatibiliteit](https://supabase.com/docs/guides/self-hosting/restore-from-platform). De laatste gids beschrijft ook een gefilterde CLI-migratieroute; die vervangt het hier vereiste volledige owner-/ACL-bewijs niet.
