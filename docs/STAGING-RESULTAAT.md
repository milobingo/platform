# Milo staging: resultaat 5 november 2026

Staging is bereikbaar op **https://milo-staging.dgwebservices.nl**. Open de [familiedemo](https://milo-staging.dgwebservices.nl/spelen?demo=1) om zonder account te kijken. De bron staat op `main` van [milobingo/platform](https://github.com/milobingo/platform).

## Actieve release en deployment

| Onderdeel | Gecontroleerd resultaat |
| --- | --- |
| Actieve appbron | `985ed0d8aeac3ef7f7b2960d0a03a047e8a1d161` |
| Release / configuratie | `42076441650-1` / `staging-2026-11-05-v1` |
| Exacte bron-CI | [42075300318: geslaagd](https://github.com/milobingo/platform/actions/runs/42075300318) |
| Laatste deployment | [42076441650: alle drie jobs geslaagd](https://github.com/milobingo/platform/actions/runs/42076441650) |
| Vorige bevestigde release | [42075923621: geslaagd](https://github.com/milobingo/platform/actions/runs/42075923621), dezelfde appbron met eigen release/env |
| Host / service | `dg-nxttrack-01`, `milobingo-staging.service`, actief en ingeschakeld voor boot |
| Werkelijke procesidentiteit | `app-mil-stg`, UID `996`, GID `987`; native Node `24.18.0` |
| Appbinding | Alleen `127.0.0.1:4173`, publiek via Caddy met geldig HTTPS |
| Appboom | Root-owned standalone-output; private runtime-env buiten de appboom, root-only `0600` |

De [hostinventaris](../verification/staging-release.json) bevat de exacte werkmap, release-inventarisdigest, entry/helper/toolchaindigests en effectieve procesidentiteit. De [publieke nacontrole na intrekking van SSH](../verification/staging-public.json) bevestigt de volledige SHA, release-ID en configuratieversie. Een nieuwe documentatiecommit op `main` wijzigt deze expliciet gekozen appbron niet automatisch.

## Database, opslag en herstel

- [Databaseworkflow 42073060158](https://github.com/milobingo/platform/actions/runs/42073060158) heeft na een werkelijke versleutelde backup en volledige scratchrestore het schema gecommitteerd: **18 beheerde tabellen, geen openstaande migraties**. De migratieprocedure kwam uit bron `10a9c351fb9c7e501ff9996291518bedb8ed7c8d`; de latere appcorrectie veranderde het schema niet. Zie [applybewijs](../verification/staging-database-apply.json).
- Het [herstelbewijs](../verification/staging-restore-proof.json) bevestigt overeenkomende gegevenschecksums en beveiligingsmetadata, inclusief eigenaars, grants, RLS, schema-ACLs en eventtriggers. De versleutelde dump en metadata staan onder `/var/backups/milobingo-staging`; de [kopie buiten de staginghost](../verification/staging-backup-escrow.json) heeft dezelfde hashes. De encryptiesleutel is afzonderlijk als private escrow bewaard; waarden staan niet in Git.
- App en migraties gebruiken afzonderlijke accounts via de geverifieerde directe IPv6-databaseverbinding met certificaat- en hostnaamcontrole. De eerste pooler-nacontrole van runtimeprovisioning stopte met `28P01`; dezelfde nieuwe login is onafhankelijk rechtstreeks geverifieerd, voordat het appsecret is gepubliceerd. Het wachtwoord en de rechten zijn daarbij behouden. Zie [runtimebewijs](../verification/staging-runtime-verification.json).
- De [backendacceptatie op de actieve appbron](../verification/staging-backend-acceptance.json) bevestigt werkelijk invoegen/lezen/wijzigen/verwijderen en rollback van een unieke testrij, drie geweigerde privilegeproeven, private Storage-upload/read, geweigerde anonieme toegang en bevestigde verwijdering van het testobject.
- De [handmatige appherstelproef](../verification/staging-recovery.json) heeft de eerdere bevestigde app met zijn eigen env geactiveerd, de exacte health gecontroleerd en daarna de nieuwste app/env hersteld. Automatische rollback bij een geforceerde fout is lokaal getest; op de host is geen fout geïnjecteerd. Appherstel draait de database en providerinstellingen niet terug.

De PostgreSQL-backup bevat database-inhoud en Storage-metadata. Het herstelpad voor echte private objectbytes en volledige clusterrolconfiguratie blijft afzonderlijk te beheren volgens [de databaseprocedure](STAGING-DATABASE.md).

## Browser, autorisatie en opruiming

De [acht stagingbrowsertests](../verification/staging-browser-tests.json) slagen zonder skips, op vijf breedtes van 320 tot 1280 pixels. Ze controleren onder meer de vijf familietabs, vaste speler, 75 ballen, accountvenster, layout, normale aanmeldroute en afwijzing van vervalste identiteit en lokale regie-aanmelding. Er zijn aparte [mobiele](../verification/screenshots/staging-family-320.png) en [desktop](../verification/screenshots/staging-family-1280.png) screenshots.

De publieke nacontrole bevestigt anonieme sessie `200` met `configured=true` en `localAvailable=false`, vervalste identiteit `401`, afwijkende Origin `403` en lokale aanmelding `403` zonder cookie. De proxycorrectie behoudt de controles op de vaste host, protocol, interne poort, Origin en Sec-Fetch.

[Scratch, relay, tunnel, private scratchcredentials en hersteltestsecret zijn verwijderd](../verification/staging-scratch-cleanup.json). De [tijdelijke beheertoegang is om 17:41 UTC ingetrokken](../verification/staging-access-cleanup.json), inclusief beide sleutelregistraties, lokale sleutelbestanden en extra bootstrapkopieën. Nieuwe logins met die sleutel zijn voor `root` en `dgadmin` geweigerd; staging bleef bereikbaar.

## Volgende release en benodigde gegevens

Een volgende apprelease loopt via **[Actions: Deploy Milo staging](https://github.com/milobingo/platform/actions/workflows/deploy-staging.yml)** met een volledige main-SHA met geslaagde CI en `apply_database: false` wanneer het schema gelijk blijft. De [procedure](STAGING-DEPLOY.md) beschrijft de stappen, databasegate en rollback. Gewone appreleases gebruiken de beperkte runnerbevoegdheid.

Bestaande stagingaccounts en secrets zijn beschikbaar. Voor verdere acceptatie zijn nog nodig: echte Supabase-testaccounts en beheerder-UUID, bevestigde Site URL/redirects en OTP-/Google-flow, het DG-mailgateway/outboxcontract, provider-/modeltoegang en de LiveKit-/YouTube-/OBS-audiorepetitie. Ook de keuze over oude data en eventuele productiegegevens staat in de volledige [inventaris van accounts, gegevens, variabelen en secrets](PROJECTGEGEVENS-EN-SECRETS.md). Deze menselijke en provideracceptatie is nog niet uitgevoerd.
