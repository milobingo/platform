# v70 · Historische showtijden inventariseren

`scripts/audit-show-times.mjs` leest uitsluitend JSON van stdin en schrijft een inventarisatie/voorstel naar stdout. Het maakt geen DB-verbinding, leest geen credentials en heeft geen applymodus. Identieke invoer levert identieke fingerprints en uitvoer op. De applicatie blijft ongecontroleerde zonevrije showtijden blokkeren.

## Beperkte export

Gebruik een gecontroleerd read-only kanaal voor het juiste project. Exporteer uitsluitend opaque show-ID, revisie, letterlijke tijd/zone en aantallen boekjes/orders. Geen titels, namen, e-mailadressen, boekcodes of complete speldocumenten. Bijvoorbeeld voor de bestaande PostgreSQL-opslag:

```sql
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'shows', COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'revision', revision,
    'date', document::jsonb ->> 'date',
    'timeZone', document::jsonb ->> 'timeZone',
    'bookCount', CASE WHEN jsonb_typeof(document::jsonb -> 'books') = 'array'
      THEN jsonb_array_length(document::jsonb -> 'books') ELSE 0 END,
    'orderCount', CASE WHEN jsonb_typeof(document::jsonb -> 'orders') = 'array'
      THEN jsonb_array_length(document::jsonb -> 'orders') ELSE 0 END
  ) ORDER BY id), '[]'::jsonb)
) FROM public.bingo_games;
ROLLBACK;
```

Gebruik onversierde JSON-output van de client. De tool accepteert maximaal 2 MiB en duizend shows. Een grotere export moet bewust worden opgesplitst; geen stil afgekapt `LIMIT` presenteren als volledige inventarisatie. Niet-conforme of ontbrekende datumwaarden vragen afzonderlijke beoordeling. Onbekende invoervelden worden geweigerd.

```sh
node scripts/audit-show-times.mjs < gecontroleerde-export.json > inventaris.json
```

Per show bevat de uitvoer de letterlijke `before`-waarde, revisie, aantallen en SHA-256 van de geordende beperkte bronvelden. Een expliciet tijdstip met offset krijgt `already_explicit`; een zonevrije tijd krijgt `review_required`. Het bestaan van een Nederlandse applicatie, serverzone of eerder opgeslagen zoneveld geldt niet als bewijs van de oorspronkelijke intentie.

## Alleen een voorstel na menselijke beoordeling

Neem de oorspronkelijke export en voeg na controle een `reviews`-array toe. Iedere review moet exact dezelfde show-ID en fingerprint binden aan `intendedZone: "Europe/Amsterdam"` en een niet-persoonlijke referentie naar de vastgelegde beoordeling. Voorbeeld:

```json
{
  "schemaVersion": 1,
  "shows": [{
    "id": "show-winter-01", "revision": 7,
    "date": "2026-11-18T13:30", "timeZone": null,
    "bookCount": 12, "orderCount": 4
  }],
  "reviews": [{
    "id": "show-winter-01",
    "fingerprint": "VUL_DE_64_TEKENS_UIT_DE_INVENTARIS_IN",
    "intendedZone": "Europe/Amsterdam",
    "evidenceReference": "review-ticket-42"
  }]
}
```

Een passende review levert uitsluitend een `proposal` op: in dit wintervoorbeeld `2026-11-18T12:30:00.000Z` met `Europe/Amsterdam`. De oorspronkelijke tekst blijft in `before`. Een zomerwaarde `2026-07-18T13:30` wordt na afzonderlijke passende review `2026-07-18T11:30:00.000Z`. Een veranderde bron/revisie/aantal blokkeert de oude reviewfingerprint.

De lokale tijden `2026-03-29T02:30` en `2026-10-25T02:30` blijven ook met een review geblokkeerd: de eerste bestaat niet en de tweede is dubbelzinnig. Een ongeldige kalenderdatum blijft eveneens geblokkeerd. Deze uitzonderingen vereisen een afzonderlijk bewezen expliciet tijdstip; de tool kiest geen offset.

## Verdere verwerking

Dit voorstel autoriseert geen automatische herschrijving. Een eventuele apply moet apart worden beoordeeld, de exacte bronfingerprint/revisie opnieuw controleren, de bestaande backup-/werkelijke-herstelprocedure volgen, en een uitdraai voor en na bewaren. Boekingen, orderhistorie, PDF-cacheversies en noodzakelijke operationele communicatie moeten worden meegenomen. De expliciete appverplaatsingsroute kan bij een geschikte conceptshow worden gebruikt met preview, revisie en bevestiging; verschuif een geboekte show niet via een gewone SQL-update.

## Vastgestelde staginginventarisatie op 9 november 2026

De [read-only inventarisatierun 42627389903](https://github.com/milobingo/platform/actions/runs/42627389903) is geslaagd voor bron `f32a854b408ed750001f2f768fc0f454f102c4f9`. Het [bewijs van 13:40:13 UTC](../verification/v70/staging-inventory.json) bevat `shows: 0`, `zoneFree: 0`, `reviewRequired: 0`, `proposed: 0` en `blocked: 0`. De daadwerkelijke stagingbron bevatte op dat peilmoment dus geen historische shows die een tijdsbeoordeling of dataconversie vroegen. Er zijn geen voorstellen, menselijke intentiebeoordelingen of datumherschrijvingen uitgevoerd; `sourceWrites`, `databaseWrites` en `automaticApply` zijn alle `false`.

Dit lege resultaat geldt uitsluitend voor deze stagingdatabase en dit peilmoment. Bij een latere import of een andere omgeving blijft aantoonbare oorspronkelijke tijdsintentie vereist; de tool mag ontbrekende gegevens niet op basis van serverzone of Nederlandse herkomst invullen.

De afzonderlijke [schema-upgrade 42627576733](https://github.com/milobingo/platform/actions/runs/42627576733) is inmiddels geslaagd voor dezelfde bron. Het [herstelbewijs](../verification/v70/staging-restore.json) bevestigt de volledige werkelijke restore vóór de toevoeging van de vijf tabellen, gelijke brondata/security, vijf extensies en verificatie van de bestaande beperkte runtime-login tegen alle 23 tabellen. De additieve schemawijziging heeft geen showtijden geconverteerd; er waren op het inventarisatiepeilmoment geen shows.

Ook de daaropvolgende [native stagingdeployment 42627937885](https://github.com/milobingo/platform/actions/runs/42627937885) is in alle drie jobs geslaagd voor dezelfde bron, als release `42627937885-1`. De publieke nacontrole bevestigt de exacte release/configuratie en [93 bronidentieke modules/assets](../verification/v70/staging-public-assets.json). De [19 releasegebonden stagingbrowsertests](../verification/staging-v70/f32a854b408ed750001f2f768fc0f454f102c4f9/42627937885-1/release-acceptance.json) slagen met echte staging-HTML/CSS/Canvas, gesimuleerde regie-/familie-API en geblokkeerde of gesimuleerde providers. Dat is geen echte account-, mail-, betaal- of liveaudiorepetitie en vervangt geen intentiebeoordeling bij een latere import. De resterende praktische poorten staan in het [stagingresultaat](STAGING-RESULTAAT.md).

De pure regressies in `tests/check-show-time-audit.mjs` bewijzen winter/zomer, letterlijke before/proposal, stale fingerprints, zomertijduitval en weigering van persoonsgegevensvelden. De voorbeelden in dit document bevatten alleen fictieve show-ID's en aantallen.

De latere opslagcorrectie uit [PR3](https://github.com/milobingo/platform/pull/3) is afzonderlijk uitgerold als `cb84f03d7c7484a4c7a3eed97e9dcab8e8fece83` / `42635245053-1`, zonder nieuwe DDL, rolwijziging of bronrestore. De bestaande upgrade-/inventarisbewijzen hierboven blijven bij hun oorspronkelijke bron horen. Het [actuele stagingresultaat](STAGING-RESULTAAT.md) koppelt de nieuwe app aan haar eigen CI-, browser- en capaciteitsbewijs.
