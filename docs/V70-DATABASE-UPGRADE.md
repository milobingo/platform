# v70 · Beoordeelde upgrade van 18 naar 23 tabellen

De upgradecode is lokaal beproefd op een geïsoleerde PostgreSQL17-fixture en SQLite. Er is hiermee geen staging- of productieschema gewijzigd. De workflow in `infra/staging/staging-database-upgrade-v70.yml.template` is een inactief sjabloon; die wordt niet automatisch uitgevoerd.

De oorspronkelijke SQL blijft bytegelijk. De nieuwe migratie voegt uitsluitend `studio_mail_records`, `studio_mail_subscriptions`, `studio_mail_suppressions`, `studio_mail_unsubscribe` en `bingo_payment_receipts` toe. Alle vijf hebben RLS en uitsluitend het beoordeelde backendprivilegecontract. Gebruikersaanvragen voeren geen DDL uit; een ontbrekende mailmigratie geeft een beheerste 503.

| Bronbestand | SHA-256 |
|---|---|
| `20261104115830_milo_friends_server_schema.sql` | `8451a8aaf928dd7d58114d71741d4a76acb917c26c9d5e205d0436d5e306cc16` |
| `20261109122605_studio_mail_v70.sql` | `a67dc3b97288f7fa68d1a3a48eb71e8dfeaf65e7e209eb7f083924ace392366d` |
| Manifest van de oorspronkelijke 18 tabellen | `9d3373fbcd81337fbf0c80f95e4a566b4692c0022b2a815b444835e39e0a5f92` |
| Volledig v70-manifest van 23 tabellen | `183e6712a781c64992bffe5c195931995350ffdfb2f1e6eb098fb2d61c937c4b` |

Deze waarden gelden voor de hier beoordeelde bron. Laat ze vóór uitvoering opnieuw onafhankelijk vergelijken met de exacte, groen geteste release; neem niet blind een tijdens de apply berekende digest over als toestemming.

## Uitvoering door de bestaande deployprocedure

1. Selecteer de exacte main-SHA met geslaagde eigen CI. Beoordeel beide migraties en beide manifestdigests. Gebruik het staging-sjabloon uitsluitend op de bestaande toegewezen runner en met de bestaande staging-concurrencygroep.
2. Houd migratiecredentials buiten installatie-/buildstappen. Alleen de afzonderlijke DB-stap ontvangt de bestaande `MIGRATION_DATABASE_URL` als `DATABASE_URL`, projectref, private Storage-configuratie en CA, backupkey, beschermde backupdirectory en onafhankelijke `RESTORE_TEST_DATABASE_URL`. De runtimeverbinding blijft de beperkte app-login. Geen secretwaarden in argumenten, artifacts of logs.
3. Voer de afzonderlijke CLI uit met de vooraf beoordeelde digests:

   ```sh
   node scripts/deploy/upgrade-v70.mjs \
     --expected-project-ref=lfsdgxcpdyghidzkzzvn \
     --apply-reviewed-v70 \
     --reviewed-baseline-manifest-sha256=9d3373fbcd81337fbf0c80f95e4a566b4692c0022b2a815b444835e39e0a5f92 \
     --reviewed-manifest-sha256=183e6712a781c64992bffe5c195931995350ffdfb2f1e6eb098fb2d61c937c4b
   ```

4. De upgrade neemt dezelfde DB-advisorylock als bootstrap. Zij accepteert alleen de aantoonbare beheerde 18-tabellenbasis met bekende historie, originele checksum, juist rechtencontract, TLS en private Storage. Een reeds bestaande nieuwe tabel of index wordt geweigerd, ook als die leeg is. Gewone `applyDatabase` neemt deze upgrade niet over.
5. Vóór enige bron-DDL wordt de bestaande volledige versleutelde backup werkelijk hersteld in de afzonderlijke scratchdatabase. De bestaande bewijscontrole omvat data, beveiligingsmetadata en extensiemetadata. Projectref en release-SHA moeten overeenkomen. Daarna wordt de 18-tabellenbasis onder dezelfde lock opnieuw gecontroleerd.
6. Eén transactie voert de nieuwe SQL, schema-/RLS-/rechtencontrole en migratiehistorie uit. Bij een mislukte postconditie rolt de hele toevoeging terug. Daarna moet de volledige 23-tabellenaudit slagen. Een reeds volledig geverifieerde upgrade verandert niets.
7. Werk pas daarna de beperkte runtime-login en haar toegestane tabellen bij via de bestaande beoordeelde procedure, verifieer de daadwerkelijke runtime-rechten en activeer de exacte app-release. Bewaar het backup-/restorebewijs en upgrade-resultaat bij de release. Een fout na commit blokkeert appactivatie en vraagt onderzoek; geen automatische tweede SQL-poging.

## Terugval en lokaal bewijs

Een app-rollback draait deze SQL niet terug. De migratie is additief; verwijder de vijf tabellen of ontvangstclaims niet automatisch. Stop bij onverklaarde historie/rechten, behoud de werkende vorige app-release en het versleutelde herstelbewijs, en beoordeel herstel in de afzonderlijke scratchomgeving voordat een bronrestore wordt overwogen. Een reeds geaccepteerde mail kan niet met een database-rollback worden ingetrokken; onzekere aanbiedingen moeten afzonderlijk worden gereconcilieerd.

`tests/check-deploy-database.mjs` heeft 10 tests met een echte lokale PostgreSQL-run: encrypted pg_dump→pg_restore vóór upgrade-DDL, oorspronkelijke18 in de herstelkopie, behouden speldocumenten na23, weigering van een lege nieuwe tabel, ongeldige backup, rollback van de complete upgrade bij een RLS-postconditiefout, en idempotentie. `tests/check-v70-schema-upgrade.mjs` controleert dezelfde additive lokale SQLite-migratie, behoud van bestaande gegevens en de unieke ontvangstclaim. Geen Supabase-projectcredential of echte provider is gebruikt voor deze tests.
