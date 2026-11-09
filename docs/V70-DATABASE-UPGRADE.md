# v70 · Beoordeelde upgrade van 18 naar 23 tabellen

De additieve staging-upgrade is op **9 november 2026 werkelijk geslaagd** in [workflow 42627576733](https://github.com/milobingo/platform/actions/runs/42627576733), voor bron `f32a854b408ed750001f2f768fc0f454f102c4f9` na [geslaagde eigen CI 42625788676](https://github.com/milobingo/platform/actions/runs/42625788676). De [voorafgaande read-only inventarisatie](../verification/v70/staging-inventory.json) bevestigde de exacte 18-tabellenbasis en een bereikbare lege onafhankelijke scratch. De volledige versleutelde bronbackup is vóór enige nieuwe bron-DDL werkelijk hersteld en op data/security en vijf extensies vergeleken. Daarna zijn de vijf nieuwe tabellen atomair aangebracht en alle 23 tabellen plus de bestaande beperkte runtime-login gecontroleerd. Zie het [upgraderesultaat](../verification/v70/staging-upgrade.json) en [herstel-/runtimebewijs](../verification/v70/staging-restore.json). Productie is niet gewijzigd.

De afzonderlijke [native stagingdeployment 42627937885](https://github.com/milobingo/platform/actions/runs/42627937885) is daarna in alle drie jobs geslaagd voor dezelfde bron, als release `42627937885-1`. De publieke nacontrole bevestigt de exacte release/configuratie, [93 bronidentieke modules/assets](../verification/v70/staging-public-assets.json) en de anonieme toegangsgrenzen. De [19 stagingbrowsertests](../verification/staging-v70/f32a854b408ed750001f2f768fc0f454f102c4f9/42627937885-1/release-acceptance.json) slagen met echte staging-HTML/CSS/Canvas, gesimuleerde regie-/familie-API en geblokkeerde of gesimuleerde providers. Echte accounts, mailbezorging, betaling en liveaudio zijn daarmee niet geaccepteerd; zie de praktische poorten in het [stagingresultaat](STAGING-RESULTAAT.md).

De handmatige workflow `.github/workflows/staging-v70-upgrade.yml` behoudt `inventory_only:true` als veilige standaard. Toepassen vraagt de exacte release en beide beoordeelde manifestdigests. Het oorspronkelijke sjabloon onder `infra/staging/` blijft als referentie bewaard.

De oorspronkelijke SQL blijft bytegelijk. De nieuwe migratie voegt uitsluitend `studio_mail_records`, `studio_mail_subscriptions`, `studio_mail_suppressions`, `studio_mail_unsubscribe` en `bingo_payment_receipts` toe. Alle vijf hebben RLS en uitsluitend het beoordeelde backendprivilegecontract. Gebruikersaanvragen voeren geen DDL uit; een ontbrekende mailmigratie geeft een beheerste 503.

| Bronbestand | SHA-256 |
|---|---|
| `20261104115830_milo_friends_server_schema.sql` | `8451a8aaf928dd7d58114d71741d4a76acb917c26c9d5e205d0436d5e306cc16` |
| `20261109122605_studio_mail_v70.sql` | `a67dc3b97288f7fa68d1a3a48eb71e8dfeaf65e7e209eb7f083924ace392366d` |
| Manifest van de oorspronkelijke 18 tabellen | `9d3373fbcd81337fbf0c80f95e4a566b4692c0022b2a815b444835e39e0a5f92` |
| Volledig v70-manifest van 23 tabellen | `183e6712a781c64992bffe5c195931995350ffdfb2f1e6eb098fb2d61c937c4b` |

Deze waarden gelden voor de hier beoordeelde bron. Laat ze vóór uitvoering opnieuw onafhankelijk vergelijken met de exacte, groen geteste release; neem niet blind een tijdens de apply berekende digest over als toestemming.

Het werkelijke herstelbewijs is gebonden aan backup `milo-lfsdgxcpdyghidzkzzvn-20261109T134136676Z-edc7f203-0897-45c1-9d60-1a80f43592ea`, dezelfde release-SHA en projectref. Het bewijst gelijke brondata en security, vijf extensies en de afzonderlijk versleutelde extensie-/eventtrigger-/schema-ACL-metadata. Dump en sidecar zijn met gelijke bestandshashes buiten de host veiliggesteld en vanuit escrow gecontroleerd ontsleuteld; er is geen plaintext naar schijf geschreven. Dit bewijs vervangt het historische bootstrapbewijs van 5 november niet en herschrijft diens migratiehistorie niet.

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
7. Verifieer daarna de **bestaande** beperkte runtime-login tegen het volledige 23-tabellenmanifest. De nieuwe backendgrants worden via haar bestaande `milo_backend`-lidmaatschap geërfd; maak geen tweede login en reset geen wachtwoord. Een eerste bootstrap voor een nog ontbrekende login blijft een afzonderlijk pad. Daarbij moeten alle historische bestandsnamen, checksums en projectrefs exact kloppen, maar alleen het nieuwste migratierecord moet het actuele backup-ID en de actuele release-SHA dragen. Oudere records behouden hun oorspronkelijke provenance. Activeer de exacte app-release pas na deze controles. Bewaar het backup-/restorebewijs en upgrade-resultaat bij de release. Een fout na commit blokkeert appactivatie en vraagt onderzoek; geen automatische tweede SQL-poging.

## Terugval en lokaal bewijs

Een app-rollback draait deze SQL niet terug. De migratie is additief; verwijder de vijf tabellen of ontvangstclaims niet automatisch. Stop bij onverklaarde historie/rechten, behoud de werkende vorige app-release en het versleutelde herstelbewijs, en beoordeel herstel in de afzonderlijke scratchomgeving voordat een bronrestore wordt overwogen. Een reeds geaccepteerde mail kan niet met een database-rollback worden ingetrokken; onzekere aanbiedingen moeten afzonderlijk worden gereconcilieerd.

`tests/check-deploy-database.mjs` heeft 10 tests met een echte lokale PostgreSQL-run: encrypted pg_dump→pg_restore vóór upgrade-DDL, oorspronkelijke18 in de herstelkopie, behouden speldocumenten na23, weigering van een lege nieuwe tabel, ongeldige backup, rollback van de complete upgrade bij een RLS-postconditiefout, en idempotentie. `tests/check-v70-schema-upgrade.mjs` controleert dezelfde additive lokale SQLite-migratie, behoud van bestaande gegevens en de unieke ontvangstclaim. Geen Supabase-projectcredential of echte provider is gebruikt voor deze tests.

De latere opslagcorrectie uit [PR3](https://github.com/milobingo/platform/pull/3) is afzonderlijk uitgerold als `cb84f03d7c7484a4c7a3eed97e9dcab8e8fece83` / `42635245053-1`, zonder nieuwe DDL, rolwijziging of bronrestore. De bestaande upgrade-/inventarisbewijzen hierboven blijven bij hun oorspronkelijke bron horen. Het [actuele stagingresultaat](STAGING-RESULTAAT.md) koppelt de nieuwe app aan haar eigen CI-, browser- en capaciteitsbewijs.
