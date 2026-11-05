# Database en privéopslag

De lokale Node-runtime bewaart spelgegevens duurzaam in SQLite en bestanden in een privédirectory. Hiervoor zijn geen accounts of API-sleutels nodig. Start de app vanuit de projectroot; de runtime leest de bestaande `drizzle/*.sql`-migraties vanuit die directory. Productie kan dezelfde stores gebruiken met PostgreSQL en Supabase Storage.

## Lokaal

| Variabele | Standaard | Betekenis |
| --- | --- | --- |
| `SQLITE_PATH` | `.data/milobingo.sqlite` | SQLite-bestand, met WAL en migratiehistorie inclusief checksums |
| `OBJECT_STORAGE_PATH` | `.data/objects` | Privébestanden, inclusief PDF's, audiocache en versleutelde instellingen |
| `DATABASE_URL` | leeg | Alleen instellen om PostgreSQL te gebruiken |
| `SUPABASE_STORAGE_BUCKET` | leeg | Alleen instellen om Supabase Storage te gebruiken |

De SQLite-bestanden krijgen bestandsmodus `0600`, nieuwe privédirectories `0700`. Objectnamen worden naar hashes vertaald; ze kunnen niet buiten de opslagdirectory schrijven. Objectinhoud en metadata staan samen in één atomair vervangen en naar schijf gesynchroniseerd bestand. Een klein SQLite-lockbestand (`.object-locks.sqlite`) beschermt gelijktijdige wijzigingen vanuit meerdere lokale processen; het besturingssysteem geeft dit slot ook na een gecrasht proces vrij. Bewaar deze bestanden op een persistent lokaal volume, niet op een tijdelijke hostingfilesystem of een gedeelde netwerkfilesystem. Maak consistente back-ups van SQLite via de SQLite-back-upvoorziening of terwijl de app is gestopt; kopieer een actieve database niet zonder zijn WAL.

De adapter in `server/node-storage.js` biedt `createStorageEnvironment(config)` en retourneert `{ DB, SETTINGS, close }`. `DB` ondersteunt het bestaande `prepare().bind().first()/all()/run()`-contract en `batch()`. `SETTINGS` ondersteunt `get`, `head`, `put`, `delete`, metadata en etagvoorwaarden. De infrastructuurtabel `app_user_roles` bevat uitsluitend de serverbeheerde rollen `regie` en `player`.

## PostgreSQL en Supabase

De migratie `supabase/migrations/20261104115830_milo_friends_server_schema.sql` is gemaakt met `supabase migration new` van CLI **3.0.0**. Het schema volgt `db/schema.ts` en de bestaande Drizzle-migraties. Documenten blijven tekst; timestamps gebruiken `BIGINT`, zodat epochmilliseconden niet overlopen.

Een leeg testproject kan lokaal met de Supabase CLI worden ingericht:

```bash
npx --yes supabase@3.0.0 start
npx --yes supabase@3.0.0 db reset
npx --yes supabase@3.0.0 db advisors --type security --fail-on error
```

`db reset` wist de lokale Supabase-testdatabase. Gebruik dit alleen voor een lege of vervangbare lokale database. De app zelf past PostgreSQL-migraties bewust niet bij het opstarten toe. Laat de migraties vóór het starten uitvoeren door de databasebeheerder of de latere deploymentworkflow. Voor een lege gewone PostgreSQL-database kan dat met:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261104115830_milo_friends_server_schema.sql
```

Supabase CLI v3 voert databasecommando's standaard lokaal uit. Een toekomstige deployment naar een gekoppeld Supabase-project gebruikt expliciet `--remote`; onbemande hosted wijzigingen vereisen bovendien `--yes`. Controleer vóór die deployment het geselecteerde project en `supabase db push --help`. Er is in deze bouwronde geen hosted project gekoppeld, gewijzigd of gevuld.

Stel voor PostgreSQL `DATABASE_URL` uitsluitend op de server in. Gebruik de directe verbinding of de pooler in sessiemodus, met TLS volgens de verbindingsgegevens van het project. De PostgreSQL-adapter gebruikt transacties en advisory locks; een pooler in transactiemodus is niet de ondersteunde standaard. De migratie maakt de groep `milo_backend` zonder login aan. Die groep krijgt uitsluitend de benodigde tabelrechten en eigen RLS-policies. Voor `app_user_roles` krijgt de backend alleen leesrecht; de app kan zichzelf dus geen regierol geven. Maak voor de runtime een afzonderlijke database-login aan en geef die de groep `milo_backend`. Gebruik de schema-eigenaar alleen voor migraties en accountbeheer.

Een beheerder kan de runtime-login bijvoorbeeld in een interactieve `psql`-sessie inrichten. `\password` vraagt de secret af zonder die in de SQL of shellhistorie te plaatsen:

```sql
CREATE ROLE milo_runtime LOGIN;
GRANT milo_backend TO milo_runtime;
\password milo_runtime
```

Gebruik daarna de verbinding van `milo_runtime` in `DATABASE_URL`. De PostgreSQL-pool heeft maximaal tien verbindingen per applicatieproces en begrensde verbindings-, statement-, lock- en transactie-time-outs. Stem het totale aantal processen later af op de projectlimieten.

Alle **18 applicatietabellen** hebben RLS ingeschakeld. Toegang van `PUBLIC`, `anon` en `authenticated` is ingetrokken; er zijn geen browserpolicies die gezinsdocumenten, codes, sessies of roltoekenningen blootstellen. Het `service_role` krijgt expliciete tabelrechten als die Supabase-rol bestaat. De browser gebruikt de eigen applicatie-API. Die controleert de door Supabase geverifieerde gebruiker en de serverbeheerde rol. Voeg een regierol pas toe na het aanmaken en verifiëren van het bedoelde Auth-account, via een beheerverbinding:

```sql
INSERT INTO public.app_user_roles (user_id,role)
VALUES ('<geverifieerde-supabase-auth-user-id>','regie')
ON CONFLICT (user_id) DO UPDATE SET role=excluded.role;
```

Gebruik hiervoor geen e-mailadres of gebruikersmetadata als bewijs van bevoegdheid. Deze rolwijziging hoort niet bij een browseraanvraag.

## Supabase Storage

Remote objectopslag wordt pas ingeschakeld als `SUPABASE_STORAGE_BUCKET` is ingevuld. Voor die combinatie zijn deze serverinstellingen nodig:

| Variabele | Plaats |
| --- | --- |
| `DATABASE_URL` | Serversecret; noodzakelijk voor gedeelde atomaire objectwijzigingen |
| `SUPABASE_URL` | Project-URL, ook gebruikt door de Auth-integratie |
| `SUPABASE_SECRET_KEY` | Serversecret; gebruik een actuele `sb_secret_...`-sleutel |
| `SUPABASE_STORAGE_BUCKET` | `milo-private` voor de meegeleverde migratie |

De migratie maakt bucket `milo-private` alleen aan als het Supabase Storage-schema aanwezig is en zet die bucket op privé. Er worden geen browserpolicies voor deze bucket aangemaakt. De app uploadt opaque JSON-enveloppen onder `milo-envelopes/`; originele inhoud en metadata worden aan de serverkant hersteld. De bestaande versleuteling van de instellingen blijft actief. De bucket is geen openbare assetbibliotheek. Stel nooit `SUPABASE_SECRET_KEY` als `NEXT_PUBLIC_...` in en neem de sleutel niet op in broncode of browserconfiguratie.

Nieuwe secret keys worden volgens de actuele documentatie via de `apikey`-header gebruikt, niet als JWT in `Authorization: Bearer`. Een PostgreSQL-advisory lock beschermt het lezen, vergelijken en vervangen van een object over meerdere applicatieprocessen heen. Dit werkt voor schrijvers die deze adapter gebruiken; externe wijzigingen rechtstreeks in de bucket vallen buiten het etagprotocol van de app. De daadwerkelijke hosted upload/download moet later nog eenmaal met de echte projectconfiguratie worden gecontroleerd.

## Atoom gedrag en verificatie

Elke `batch()` is één transactie. Als een `UPDATE ... RETURNING` geen rij oplevert, wordt de hele transactie teruggedraaid, inclusief eerdere updates. De store krijgt lege resultaten en kan met een nieuwe revisie opnieuw proberen. Dit bewaart de koppeling tussen spel, gezin en wereldwijd unieke boekjescodes. PostgreSQL-batches gebruiken `SERIALIZABLE`; een serialisatieconflict of deadlock geeft hetzelfde retry-signaal. De adapter vertaalt expliciet de gebruikte SQLite-JSON-operaties naar PostgreSQL-JSONB-functies, inclusief chatgeschiedenis, cursors, deelnemers en boekjes.

Voer de lokale adapterchecks uit met:

```bash
node --test tests/check-node-storage.mjs
```

De PostgreSQL-integratiecheck wordt alleen ingeschakeld met `MILO_TEST_DATABASE_URL`. Die URL moet naar een lokale host en een databasenaam met `test` wijzen. De check gebruikt een willekeurig eigen schema en verwijdert dat daarna; voer hem uit met een aparte testdatabase en een account dat schema's mag beheren:

```bash
MILO_TEST_DATABASE_URL='<lokale-testdatabase-url>' node --test tests/check-node-storage.mjs
```

De checks dekken herstartpersistentie, private bestandsrechten, etag-CAS, PostgreSQL-JSON-vertaling, rollenopslag, RLS, concurrerende spel/gezinswijzigingen, codebotsingen, rollback bij een latere CAS-misser, chatcursoren en gelijktijdige berichten van hetzelfde account. Een echte beperkte database-login kan spelgegevens wijzigen en regierollen lezen, maar geen rollen toekennen of tabellen verwijderen. Een aparte browserrol kan ook na een extra tabelgrant geen gezins- of rolgegevens lezen of regierechten toevoegen. Dezelfde contracten zijn tijdens de bouw uitgevoerd tegen Node SQLite en een echte lokale PostgreSQL **17.11**. Remote Supabase-objectopslag is contractueel getest met de echte PostgreSQL-advisory locks en een gesimuleerde Storage-HTTP-server; een hosted project is nog niet beschikbaar.

## Bestaande data later overzetten

De lokale SQLite- en PostgreSQL-schema's zijn geschikt voor dezelfde documenten, maar er is nog geen bulkimport van de lokale SQLite-inhoud naar een project uitgevoerd. Leg eerst vast welke lokale testgegevens moeten worden meegenomen. Exporteer bij stilgezette writes alle tabellen, importeer in één gecontroleerde transactie en controleer daarna rijtotalen, JSON-documenten, spelrevisies en de unieke code-index. Kopieer privéobjecten met hun envelopes en metadata; behoud bij versleutelde instellingen dezelfde `VLAMPIE_SETTINGS_KEY`. Bewaar een database- én objectback-up vóór de omschakeling. Dit is een afzonderlijke stap zodra de projectgegevens en het gewenste databeleid bekend zijn.

Bronnen, gecontroleerd op 4 november 2026: [Supabase CLI v3](https://supabase.com/changelog/supabase-cli-v3), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [API keys](https://supabase.com/docs/guides/api/api-keys).
