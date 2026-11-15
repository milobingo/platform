# Milo-productie: voorbereiding op 15 november 2026

De productiehost en de beschermde beheerroute zijn ingericht, maar de
productie-app is nog niet vrijgegeven. De appservice is uitgeschakeld en niet
actief; het eigen Caddyfragment staat buiten de live import. Het
[operationele resultaat](PRODUCTIE-RESULTAAT-2026-11-15.md) bevat de actuele
blokkades en de vervolgstappen. De algemene
[productieprocedure](PRODUCTIE-DEPLOY.md) blijft leidend.

De [eerdere read-only inventaris](../verification/production-bootstrap/read-only-inventory-2026-11-15.json)
beschrijft de toestand vóór deze handelingen. Zij is geen actuele bevestiging
van de inmiddels aangemaakte accounts en beheerlogin.

## Vaste bestemming en eigen accounts

Het [openbare productieprofiel](../infra/production/profile.json) is gelijk aan
het beoordeelde [voorstel](../infra/production/profile.proposed.json). Beide
bevatten uitsluitend openbare metadata.

| Onderdeel | Bevestigde waarde |
| --- | --- |
| Origin | `https://milo.dgwebservices.nl` |
| Doelhost | `dg-nxttrack-01` |
| Site/service | `milobingo-production` / `milobingo-production.service` |
| Loopbackpoort | `4178` |
| Runner | `dg-nxttrack-01-milobingo-production`, GitHub-runner-ID `22` |
| Runneraccount | `run-mil-prd`, UID `963`, primaire GID `957` |
| Buildaccount | `build-mil-prd`, UID `962`, primaire GID `956` |
| Appaccount | `app-mil-prd`, UID `961`, primaire GID `955` |
| Supabase | `msupvdycmtbycaonqgan` / `milobingo-production` / `eu-west-1` |
| Private bucket | `milo-private`, aangemaakt door de oorspronkelijke migratie |
| Runtime-login | `milobingo_production_runtime`, aangemaakt en werkelijk getest |
| Eerste configuratie-ID | `production-2026-11-15-v1` |
| Mail | Regie-instellingen beginnen met verzending uit |

De accounts hebben afzonderlijke primaire groepen en `nologin`. Alleen de
runner is lid van de bestaande groep `dg-build`. Build en app krijgen geen
algemene sudo-rechten of toegang tot beheergeheimen. De eigen vaste
Caddy-beheerblokkade bevat zes UID-ownerregels voor deze drie accounts naar
poort `2019`, op IPv4- en IPv6-loopback. De blokkadeservice is ingeschakeld en
actief. De appunit heeft een eigen drop-in met `Requires` en `After` naar die
service; ook een zelfstandige appstart vereist daardoor de blokkade.

Het eigen sitepad is `/srv/sites/milobingo-production`; bouwen gebeurt onder
`/var/lib/dg-build/milobingo-production`. Configuratie, externe runtimebestanden
en backups hebben eigen paden onder respectievelijk `/etc/dg-sites` en
`/var/backups/milobingo-production`. De bestaande Milo-staging-, Dartflow-,
Rondio- en SocialHero-bestemmingen blijven buiten deze installatie. Poorten
`4176` en `4177` horen bij Rondio; `4180` en `4181` bij SocialHero. Controleer
listeners opnieuw vóór een latere activatie.

## Geïnstalleerde hostvoorbereiding

De [hosthelper](../infra/production/prepare-host.py) heeft uitsluitend het eigen
beoordeelde pakket geïnstalleerd. De renderer leverde dertien bestanden,
waaronder twee publieke repositorybestanden. Op de host zijn de beschermde
broker, vastgepinde dependency, extractor, lockhouder, rootpolicy, beperkte
sudoers, deployprofiel en appunit geïnstalleerd. De hosthelper voegde de eigen
runnerunit, Caddy-isolatiehelper/-unit en appunit-drop-in toe.

De SHA-256 van het definitief geïnstalleerde render-manifest v2 is
`96cc0fbb4749ee29dd7606657099c20cb839f33db9361fa073068a5972cc77ee`.
De geïnstalleerde roothelper heeft SHA-256
`25e788c97f3c0314f7e28b2760538d126b0a0004850e5bd611b367d72233c330`.
Het Caddyfragment staat als
`/etc/dg-sites/milobingo-production/site.caddy.prepared`, buiten
`/etc/caddy/sites/`. Een Caddyreload van een ander project publiceert Milo
hierdoor niet voortijdig. Deze hostinstallatie heeft geen runtimebundel of
stagingacceptatierecord geschreven en geen productie-app gestart. De
runtimebundel is daarna afzonderlijk via de beschermde rootroute opgeslagen.

De aparte GitHub-runner is geregistreerd als ID `22`, met distributieversie
`2.338.2`, in `/home/run-mil-prd/actions-runner`. De eigen service gebruikt
`bin/runsvc.sh`. Registratie gebruikte een eenmalig token via beschermde
procesinvoer; er is geen blijvend GitHub-secret toegevoegd. GitHub bevestigt de
runner online en systemd bevestigt de eigen service actief. Dit is geen bewijs
van een geslaagde deployment. De concrete procedure staat in
[HOST-PREPARE.md](../infra/production/HOST-PREPARE.md).

## Database en beschermde credentials

De Storage-serversleutel is opnieuw tegen precies het productieproject
gecontroleerd. Een afzonderlijke administratieve database-login is via de
gekoppelde SQL-beheerroute aangemaakt. Het wachtwoord werd in de database
gegenereerd en aan de publieke OpenPGP-sleutel van de doelhost gebonden.
Alleen de versleutelde overdracht verliet het project. Ontsleuteling en opslag
vonden uitsluitend op de doel-VPS plaats; wachtwoord en privésleutel zijn niet
via de dev-VPS of GitHub gegaan.

De echte directe PostgreSQL-authenticatie naar
`db.msupvdycmtbycaonqgan.supabase.co:5432/postgres` met `verify-full` slaagde.
De publieke CA is via HTTPS uit de Supabase-certificaatbron verkregen en voor
het werkelijke productiecertificaat gecontroleerd. De SHA-256 van het publieke
CA-bestand is
`700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.
Er is geen stagingcredential of onbewezen staging-CA overgenomen.

Een onafhankelijke backup-encryptiesleutel en stabiele productie-
`VLAMPIE_SETTINGS_KEY` zijn op de doelhost gegenereerd en root-only opgeslagen.
Bewaar de masterkey blijvend; een latere approllback of herinstallatie mag die
niet vervangen. De beperkte runtime-login is inmiddels aangemaakt en met echte
productie-TLS getest. De root-only runtimebundel is opgeslagen en door de
geïnstalleerde broker gevalideerd. De administratieve login en
herstelcredentials blijven buiten runner, build en app.

De [databasehelper](../infra/production/bootstrap-database.mjs) accepteert alleen
`audit`, `backup` en `apply` op de vaste root-doelhost. Zij leest de zes
beoordeelde databasevelden uit
`/root/milo-production-bootstrap/database-environment.json`. De afzonderlijke
backupkey en lokale herstelverbinding komen uit eigen root-only bestanden.
Vóór backup/apply controleert zij alle vaste backupdirectories op eigenaar,
symlinks en schrijfrechten. De manifestpin blijft
`183e6712a781c64992bffe5c195931995350ffdfb2f1e6eb098fb2d61c937c4b` voor de twee
ongewijzigde bestaande migraties en alle 23 applicatietabellen.

De eerste volledige backup-/restorepoging bereikte de strikte
beveiligingsvergelijking, maar werd daar afgewezen: twee Storage-ACLs waren op
de herstelserver met een andere grantor teruggekomen. Er is voor die poging
geen geslaagd herstelbewijs en geen applicatieschema toegepast. Na een gerichte
correctie reconstrueert uitsluitend de tijdelijke herstelserver ook de
oorspronkelijke grantors. De controle is niet versoepeld en de bron-ACLs zijn
niet gewijzigd.

Op 15 november om circa 20:20 UTC slaagde vervolgens een nieuwe volledige
versleutelde backup met echte afzonderlijke restore. Data- en
beveiligingsdigests kwamen overeen; daarna zijn beide ongewijzigde migraties
gecommit. De nacontrole rapporteert alle 23 applicatietabellen met RLS aan,
leesbare checksumhistorie en `pending=[]`, `blockers=[]`. Het bewijs heeft
backup-ID
`milo-msupvdycmtbycaonqgan-20261115T202021639Z-ce203ef6-2386-4889-9a02-112438c3869f`
en versleutelde bestands-SHA-256
`93af14f9490e5ac2dfc7b725501bee0a3fb19203629d60965ef754c10f7510b7`.
Backup en herstelbewijs staan root-only onder
`/var/backups/milobingo-production`.

De versleutelde dump, versleutelde extensiemetadata en het herstelbewijs zijn
ook gekopieerd naar een beschermde map buiten de doel-VPS, onder
`/home/codex/.codex/backups/milobingo-production/<backup-ID>`.
Alle drie hashes komen overeen met het werkelijke bewijs. De backupkey is niet
meegekopieerd en heeft de doel-VPS niet verlaten. Een afzonderlijke externe
sleutelbewaring is niet bevestigd; beheer moet sleutelherstel nog apart
organiseren.

Een aanmaakpoging voor de private bucket met `104857600` bytes werd afzonderlijk
afgewezen: de globale Storage-projectlimiet staat lager dan het bestaande
100 MiB-contract. Supabase retourneerde HTTP 400 met een 413-fout in de payload.
Het productieproject heeft een Pro-abonnement, maar die limiet wijzigt daardoor
niet vanzelf. De beschikbare connector kan deze projectconfiguratie niet
bijwerken. De gevraagde verhoging naar minimaal `104857600` bytes staat nog open;
de gebruiker antwoordde hiervoor “Straks”.
De oorspronkelijke migratie heeft inmiddels wel de private bucket
`milo-private` aangemaakt met `file_size_limit=null`. Daardoor geldt de huidige
globale projectlimiet. De geslaagde bucket-audit bevestigt privacy en
bruikbaarheid, maar geen effectieve bestandslimiet van 100 MiB.

De [runtimehelper](../infra/production/provision-runtime.mjs) heeft daarna
`milobingo_production_runtime` aangemaakt met uitsluitend de beoordeelde
`milo_backend`-rechten. Echte geverifieerde productie-TLS en toegang tot alle 23
tabellen slaagden. De volledige credentialoverdracht is atomair en zonder
overschrijven geschreven en gefsynct vóór COMMIT. Een lokale parser kon de
twee JSON-uitvoerregels niet als één document lezen; dat was geen mislukte
provisioning en is geen reden om de rol opnieuw te maken of het wachtwoord te
resetten. De afzonderlijke nacontrole is inmiddels werkelijk geslaagd: opnieuw
`verify-full`, de juiste beperkte login, toegang tot alle 23 tabellen en de
verboden bevoegdheden gecontroleerd.

De bundel is daarna atomair zonder overschrijven opgeslagen op
`/etc/dg-sites/milobingo-production/configs/production-2026-11-15-v1/runtime.json`,
root-only binnen een private configuratiedirectory. De daadwerkelijk
geïnstalleerde, vastgepinde broker heeft `read_policy`, `load_legacy` en
`read_bundle` met deze bundel uitgevoerd; alle controles slaagden. De acht
toegestane infrastructuurvelden zijn `APP_URL`, `DATABASE_URL`,
`SUPABASE_DB_CA_BASE64`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
`SUPABASE_STORAGE_BUCKET`, `SUPABASE_URL` en `VLAMPIE_SETTINGS_KEY`. De broker
leidt `MAIL_ENVIRONMENT=production` af. OpenAI-, LiveKit- en Resendkeys en
`MAIL_MODE` staan niet in de runtime-env; hun beheer blijft in de versleutelde
Milo-regie-instellingen.
Dit heeft geen app gestart of Caddyroute gepubliceerd. De twee eigen tijdelijke
herstelcontainers en hun interne netwerk zijn inmiddels verwijderd, beide
relays zijn afgesloten en de bijbehorende listeners zijn verdwenen. De twee
tijdelijke herstelcredentialbestanden zijn verwijderd. De duurzame backups,
masterkeys en beschermde runtimebundel zijn behouden.

## Auth en vrijgave

Google-login staat uit. E-mailaanmelding vereist bevestiging; private SMTP-,
site-URL- en redirectinstellingen zijn via de beschikbare connector niet te
beheren. Controleer de productie-OAuth-app, callback, redirects en eigen
SMTP-afzender afzonderlijk. De Resend-showmailinstellingen in Milo configureren
Supabase Auth SMTP niet automatisch.

De concrete [dashboardstappen](PRODUCTIE-DEPLOY.md#productieaanmelding-afmaken)
staan nog open: Supabase Google-provider en Site URL, de appredirect
`https://milo.dgwebservices.nl/auth/callback**` en de Google Cloud-callback
`https://msupvdycmtbycaonqgan.supabase.co/auth/v1/callback`. Na de eerste echte
productieaanmelding moet de regierol expliciet aan de bevestigde identiteit
worden gekoppeld. Met nu nul Auth-gebruikers kan dat nog niet veilig gebeuren.
Er is geen geslaagde SMTP-test op productie vastgelegd.

De gezonde stagingbron is
`17fa1d32cc0c77cfeec544316f215a635c70705b`, release `43754522473-1`, configuratie
`staging-2026-11-11-v2`; de exacte CI-run is `43753495523`. De nieuwe
productieprofiel-/workflowbron en bootstrapcorrecties horen eerst in een nieuwe
controlecommit met eigen geslaagde CI. De geaccepteerde appbron en de huidige
stagingrelease blijven behouden; een nieuwe staging-uitrol is hiervoor niet
nodig.

De gebruiker antwoordde “Ja alles is getest” op de vijf huidige
stagingpraktijktests: gezinslogin, regierollen, bestellen/PDF, echte
mailontvangst en showaudio/bellen. De gebruikersverklaring
is als root-only acceptatierecord vastgelegd voor uitsluitend bovenstaande
app-SHA, stagingrun/release en configuratie. Codex heeft de provider- en
hardwareketen niet zelf gerepeteerd. De verklaring geldt niet automatisch voor
een andere appcommit of stagingrun. De productiegate is niet aangepast of
overgeslagen.

De definitieve productieworkflow haalt controlecode en productieprofiel op uit
de main-controlecommit (`production-control`) en de geaccepteerde appbron apart
uit `release_sha` (`application-source`). De publieke verifier draait vanuit de
appbron voor de juiste assetvergelijking. Daarom hoeft appcommit `17fa1d3` geen
later toegevoegd productieprofiel te bevatten. De nieuwe controlecommit moet
wel zijn eigen CI afronden vóór dispatch.

De nacontrole op 15 november om 20:24 UTC bevestigt dat alle zeven bestaande
apps HTTP 200 en `status=ok` geven. Service-identiteiten en PIDs,
Caddyfragmenten en hoofdconfiguratie, listeners, health-/release-identiteiten
zijn gelijk aan de vooraf vastgelegde baseline. De volledige lokale
checkrunner slaagde met 124 van 124 checkscripts. Dit vervangt de nog vereiste
CI van de nieuwe controlecommit niet. De praktijkacceptatie berust op de
expliciete gebruikersverklaring over de bestaande stagingrelease.
