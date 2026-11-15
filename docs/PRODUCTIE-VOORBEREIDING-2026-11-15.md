# Milo-productie: gecontroleerde voorbereiding op 15 november 2026

De door de beheerder ingevoerde Storage-serversleutel is op de doel-VPS opnieuw
gecontroleerd tegen het vaste productieproject. De controle slaagde. De sleutel
bleef uitsluitend in het bestaande rootbestand; er is geen credentialwaarde naar
de dev-VPS, GitHub of dit verslag overgebracht.

Dit document beschrijft de concrete volgende inrichting. Het is geen bewijs dat
productie al draait. De [read-only inventaris](../verification/production-bootstrap/read-only-inventory-2026-11-15.json)
bevat de daadwerkelijk gecontroleerde toestand en de expliciete resterende gates.
De algemene [productieprocedure](PRODUCTIE-DEPLOY.md) blijft leidend.

## Doel en eigen hostindeling

Het [voorgestelde openbare profiel](../infra/production/profile.proposed.json)
is volledig ingevuld, maar staat bewust niet op het actieve standaardpad
`infra/production/profile.json`. Er zijn nog geen productieaccounts, werkelijke
UID/GID-paren, service, runtimebundel of productieworkflow geïnstalleerd.

| Onderdeel | Voorgestelde waarde |
| --- | --- |
| Origin | `https://milo.dgwebservices.nl` |
| Doelhost | `dg-nxttrack-01` |
| Site/service | `milobingo-production` / `milobingo-production.service` |
| Eigen runner | `dg-nxttrack-01-milobingo-production` |
| Runneraccount | `run-mil-prd` |
| Buildaccount | `build-mil-prd` |
| Appaccount | `app-mil-prd` |
| Loopbackpoort | `4178`, vrij en niet in Caddy/DG-siteconfiguratie gevonden bij controle |
| Supabase | `msupvdycmtbycaonqgan` / `milobingo-production` / `eu-west-1` |
| Private bucket | `milo-private`, zoals de bestaande schema-initialisatie |
| Beperkte runtime-login | `milobingo_production_runtime` |
| Eerste configuratie-ID | `production-2026-11-15-v1` |
| Mail | Beheerinstellingen beginnen met verzending uit |

Poorten `4176` en `4177` zijn inmiddels door Rondio bezet; de inventaris van
11 november mag niet worden gebruikt om een poort te kiezen. De host bevat ook
SocialHero op `4180` en `4181`. Controleer de volledige listeners en
configuratie opnieuw vlak vóór installatie van het eigen fragment op `4178`.

Maak afzonderlijke primaire groepen en accounts voor runner, build en app. Alleen
het runneraccount krijgt het benodigde lidmaatschap van de bestaande groep
`dg-build` voor het gedeelde buildslot. Geef build en app geen extra groepen,
algemene sudo-rechten of toegang tot het Caddy-beheerendpoint. Houd de bestaande
netwerkregels en identiteiten van de andere projecten intact; een eventuele
aanvullende Caddy-beheerblokkade moet uitsluitend de drie nieuwe Milo-UID's raken.
Leg de werkelijk toegewezen UID/GID-paren vast voordat de bestaande renderer wordt
aangeroepen. Verzin geen UID's op basis van deze inventaris.

De eigen doelpaden zijn `/srv/sites/milobingo-production`,
`/var/lib/dg-build/milobingo-production`,
`/etc/dg-sites/milobingo-production`,
`/etc/dg-sites/milobingo-production.runtime.d`,
`/var/backups/milobingo-production` en uitsluitend het nieuwe
`/etc/caddy/sites/milobingo-production.caddy`-fragment. Registreer een aparte
runner met een eenmalig kortlevend registratietoken; geen blijvend GitHub-secret.

## Database en beschermde credentials

Het productieproject is gezond en bevat nog geen Milo-tabellen, Milo-rollen,
gebruikers, buckets of Storage-objecten. De gekoppelde SQL-beheerrol kan de
afzonderlijke initialisatie uitvoeren. De ingevoerde `sb_secret_` is voor de
server-side Storage-API; het is geen PostgreSQL-login of databasewachtwoord.

Het is niet noodzakelijk een bestaand `postgres`-wachtwoord op te vragen of te
roteren. Een beoordeelde bootstrap kan een eigen login aanmaken en de nieuwe
credential rechtstreeks voor de doel-VPS versleutelen:

1. Maak een eigen tijdelijke OpenPGP-sleutel op de doel-VPS in een root-only
   `0700`-map. Gebruik een RSA-encryptiesleutel die door `pgcrypto` wordt
   ondersteund. Alleen de publieke sleutel en fingerprint verlaten de host.
2. Laat de gekoppelde SQL-beheerrol binnen één gecontroleerde transactie een
   willekeurig wachtwoord genereren met `extensions.gen_random_bytes`, een
   uitsluitend voor Milo bedoelde rol aanmaken en de overdracht versleutelen met
   `extensions.pgp_pub_encrypt`. Bind projectref, rolnaam en een eenmalige nonce
   in het versleutelde document. Geef alleen ciphertext terug.
3. Bewaar de volledige ciphertext duurzaam voordat de transactie als afgerond
   wordt beschouwd. Een fout na commit mag geen automatische wachtwoordreset of
   tweede rolcreatie starten. Ontsleutel uitsluitend op de doel-VPS en schrijf
   de eigen root-only credential atomair met modus `0600`.
4. Verifieer de nieuwe login met echte PostgreSQL-authenticatie, correcte CA en
   `verify-full`, en controleer de daadwerkelijke bevoegdheden. Geen plaintext
   wachtwoord, verbindingsstring of privésleutel passeert de dev-VPS of GitHub.

`gpg 2.4.4` en PostgreSQL-clients `17.11` zijn beschikbaar op de doelhost;
`pgcrypto 1.3` en de genoemde functies zijn in dit project geverifieerd. Deze
route is hier alleen voorbereid en nog niet uitgevoerd. De
[PostgreSQL-documentatie over PGP](https://www.postgresql.org/docs/17/pgcrypto.html#PGCRYPTO-PGP-ENC-FUNCS)
beschrijft de publieke-sleutelfuncties en compatibiliteit.

Een login met alleen `USAGE` en `CREATE` op `public` kan de eigen objecten
beheren, maar vervangt geen volledige databasebackup met Auth, Storage, RLS en
beveiligingsmetadata. De bestaande schemaprocedure vereist een versleutelde
volledige backup plus een echte afzonderlijke restore en vergelijking. Een
beperkte `public`-dump mag daarvoor niet als volledig bewijs worden geregistreerd.
Het bestaande migratie-/runtimepad heeft ook rolbeheer en volledige
backupleestoegang nodig. Gebruik daarvoor een afzonderlijke, beoordeelde
beheerlogin buiten runner, build en app. Ken de app alleen de bestaande
`milo_backend`-rechten toe; geen DDL, roltoekenning, bypass-RLS of beheergeheimen.

Voer daarna de twee gecommitte schema-initialisaties in hun bestaande volgorde
uit, controleer alle 23 tabellen, de checksumhistorie, RLS en grants, en leg de
beperkte runtime-login en private bucket vast. Maak een nieuwe onafhankelijke
productie-`VLAMPIE_SETTINGS_KEY`; behoud die daarna stabiel. Neem de bestaande
Storage-key uitsluitend intern op de doelhost over in de eigen beschermde
runtimebundel.

De security-advisor meldt twee bestaande EXECUTE-grants op
`public.rls_auto_enable()`. De functie retourneert `event_trigger`, gebruikt
`search_path=pg_catalog` en hoort bij `ensure_rls`. Er is geen exploit aangetoond.
Een afzonderlijk beoordeelde hardening is het intrekken van `EXECUTE` voor
`PUBLIC`, `anon` en `authenticated`, met behoud van de eigenaar en eventtrigger.
Controleer de advisor daarna opnieuw; verander geen historische migratiebytes om
dit bestaande object stilzwijgend te herdefiniëren.

## Auth en vrijgave blijven afzonderlijk te verifiëren

Google-login staat in dit productieproject uit. E-mailaanmelding staat aan met
verplichte bevestiging; private SMTP- en redirectconfiguratie zijn via de huidige
koppeling niet inspecteerbaar. Controleer de bedoelde Google-OAuth-app,
productiecallback, site-URL, toegestane redirects en eigen SMTP-afzender voordat
echte aanmeldingen worden geaccepteerd. De Resend-showmailinstellingen in de regie
configureren Supabase Auth SMTP niet automatisch.

De vijf echte stagingacceptaties voor gezinslogin, regierollen, bestellen/PDF,
werkelijke mailontvangst en showaudio/bellen blijven verplicht. Bestaande
gesimuleerde browsertests en een geldige opgeslagen key bewijzen deze controles
niet. Vul geen `passed`-record in zonder werkelijk bewijs en wijzig de productie-
of CI-gates niet om ontbrekende externe controles te omzeilen.

Milo staging stond bij deze controle op `f1550dd028ef668f09ed6e45a7c6b9d88c4dc5ee`,
release `43026808427-1`, configuratie `staging-2026-11-11-v2`. Beide Dartflow-sites
stonden inmiddels op `b7648e62a5cd03f73e0590327ff93b4da963bc3a`; stagingrelease
`43533172175-1` en productierelease `43533760901-1`. Bewaar de nieuwe baseline,
vergelijk alle bestaande hostfragmenten na een hostwijziging en controleer de
services en health van de overige sites opnieuw.
