# Milo-productie: operationele overdracht van 15 november 2026

**Productie is nog niet gedeployd.** De eigen hostinrichting en beschermde
beheerroute zijn voorbereid. De appservice is uitgeschakeld en niet actief; er
staat geen Milo-productiefragment in de live Caddyimport. De beschermde
runtimebundel is opgeslagen en werkelijk gevalideerd; er is geen geslaagde
productierun of publieke vrijgaveclaim.

Deze overdracht beschrijft de daadwerkelijk bereikte tussenstand. De algemene
procedure staat in [PRODUCTIE-DEPLOY.md](PRODUCTIE-DEPLOY.md); de concrete
hostindeling en credentialoverdracht in
[PRODUCTIE-VOORBEREIDING-2026-11-15.md](PRODUCTIE-VOORBEREIDING-2026-11-15.md).

## Uitgevoerd

| Onderdeel | Werkelijk resultaat |
| --- | --- |
| Bestemming | `https://milo.dgwebservices.nl`, `dg-nxttrack-01`, eigen poort `4178` |
| Eigen accounts | `run-mil-prd` UID/GID `963/957`; `build-mil-prd` `962/956`; `app-mil-prd` `961/955` |
| Hostinstallatie | Eigen beschermde broker, rootpolicy, beperkte sudoers, vaste helpers en appunit geïnstalleerd |
| Caddy | Fragment voorbereid als `/etc/dg-sites/milobingo-production/site.caddy.prepared`; buiten de live import |
| App | `milobingo-production.service` uitgeschakeld en niet actief |
| Caddy-beheerisolatie | Eigen zes regels voor drie productie-UID's geïnstalleerd; guardservice ingeschakeld en actief; app vereist die guard |
| Runner | Eigen GitHub-runner ID `22`, versie `2.338.2`, online volgens GitHub; eigen systemd-service actief en gebruikt `actions-runner/bin/runsvc.sh` |
| Supabase-beheerlogin | Via beoordeelde versleutelde SQL-overdracht aangemaakt; echte PostgreSQL-authenticatie met `verify-full` geslaagd |
| Credentials | Storagekey gecontroleerd; onafhankelijke backupkey en stabiele productie-masterkey uitsluitend root-only op de doelhost |
| Volledige backup en restore | Nieuwe poging om circa 20:20 UTC geslaagd; data- en beveiligingsdigests gelijk, inclusief oorspronkelijke ACL-grantors |
| Schema | Beide ongewijzigde migraties gecommit; 23 applicatietabellen met RLS, leesbare checksumhistorie, geen pending migraties of auditblockers |
| Private bucket | `milo-private`, door de oorspronkelijke migratie aangemaakt; `file_size_limit=null`, dus de globale projectlimiet geldt |
| Runtime-login | `milobingo_production_runtime` aangemaakt met beperkte `milo_backend`-rechten; echte productie-TLS en toegang tot alle 23 tabellen geslaagd |
| Onafhankelijke runtimecontrole | Opnieuw echte `verify-full`-authenticatie, juiste beperkte login, alle 23 tabellen en verboden bevoegdheden gecontroleerd |
| Runtimebundel | `production-2026-11-15-v1` root-only en atomair zonder overschrijven opgeslagen; door de werkelijk geïnstalleerde broker gevalideerd |
| Externe backupkopie | Versleutelde dump, versleutelde extensiemetadata en herstelbewijs beschermd buiten de doel-VPS opgeslagen; alle hashes geverifieerd |
| Opruimen | Twee eigen tijdelijke herstelcontainers en intern netwerk verwijderd, beide relays/listeners weg en tijdelijke herstelcredentials verwijderd; duurzame backups/masterkeys/runtime behouden |
| Gedeelde host | Zeven bestaande apps HTTP 200 en gezond; service-identiteiten/PIDs, Caddyconfiguratie, listeners en release-/health-identiteiten gelijk aan baseline |
| Stagingpraktijkacceptatie | Gebruiker bevestigde alle vijf tests met “Ja alles is getest”; root-only vastgelegd voor appcommit `17fa1d3`, release `43754522473-1` en configuratie `staging-2026-11-11-v2` |
| Gebruikers en objecten | Nog nul Auth-gebruikers en nul Storage-objecten |

Het definitief geïnstalleerde render-manifest v2 bevat dertien doelgebonden
bestanden. Zijn SHA-256 is
`96cc0fbb4749ee29dd7606657099c20cb839f33db9361fa073068a5972cc77ee`.
De geïnstalleerde roothelper heeft SHA-256
`25e788c97f3c0314f7e28b2760538d126b0a0004850e5bd611b367d72233c330`.
Het openbare profieldigest is
`efee2c3639ed1e59e24b3ec6f6bd741b1341a67416f8abaa07c58ce526a429d0`.
De publieke CA is werkelijk voor de productie-TLS-verbinding gebruikt; zijn
bestands-SHA-256 is
`700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.
Deze hashes zijn openbare bewijsmetadata. Credentialwaarden, database-URL's met
wachtwoorden en privésleutels horen niet in dit verslag of in GitHub.

De geslaagde volledige backup heeft ID
`milo-msupvdycmtbycaonqgan-20261115T202021639Z-ce203ef6-2386-4889-9a02-112438c3869f`
en versleutelde bestands-SHA-256
`93af14f9490e5ac2dfc7b725501bee0a3fb19203629d60965ef754c10f7510b7`.
Dump en werkelijk geslaagd herstelbewijs staan root-only onder
`/var/backups/milobingo-production`. De eerste herstelpoging faalde op twee
Storage-ACL-grantors en is als diagnose behouden. De gerichte correctie
reconstrueert die grantors uitsluitend op de tijdelijke herstelserver. De
bron-ACLs zijn niet gewijzigd en de vergelijking is niet versoepeld; alleen
de nieuwe, werkelijk geslaagde poging is een vrijgavebewijs voor de schemafase.

De gecontroleerde versleutelde kopie buiten de doel-VPS staat onder
`/home/codex/.codex/backups/milobingo-production/` in een beschermde map met
dezelfde backup-ID. De dump, extensiemetadata en het bewijs zijn afzonderlijk
op grootte en SHA-256 gecontroleerd. De backup-encryptiesleutel heeft de
doel-VPS niet verlaten; externe sleutelbewaring is niet bevestigd. Beheer moet
sleutelherstel afzonderlijk organiseren. Deze versleutelde kopie alleen
garandeert geen herstel na verlies van zowel de doelhost als de sleutel.

De runtimebundel staat op
`/etc/dg-sites/milobingo-production/configs/production-2026-11-15-v1/runtime.json`.
De geïnstalleerde vastgepinde broker heeft werkelijk zijn eigen policy,
native dependency en deze bundel geladen en geaccepteerd. De acht velden zijn
uitsluitend de beoordeelde infrastructuurconfiguratie; de broker leidt
`MAIL_ENVIRONMENT=production` af. Er staan geen OpenAI-, LiveKit- of Resendkeys
en geen `MAIL_MODE` in de runtime-env. Deze validatie is geen productieactivatie.

## Nog blokkerend

1. **De globale Supabase Storage-limiet.** De bucketaanmaak met het bestaande
   contract van `104857600` bytes is afgewezen met HTTP 400 en een 413-payload.
   Zet in het productieproject de globale limiet op minimaal `104857600` bytes
   via het Supabase-dashboard. De beschikbare connector kan deze instelling
   niet aanpassen. De inmiddels bestaande private bucket heeft geen eigen
   limiet; zijn geslaagde audit bewijst geen capaciteit van 100 MiB. De gebruiker
   antwoordde op deze dashboardactie “Straks”; de verhoging blijft open.
2. **Auth-inrichting.** Google-login staat uit. Productiecallback, site-URL,
   redirects en eigen Auth SMTP moeten worden geconfigureerd en echt getest;
   de beschikbare connector beheert die private configuratie niet. De
   [dashboardactie](PRODUCTIE-DEPLOY.md#productieaanmelding-afmaken) is aan de
   gebruiker voorgelegd en staat open. Na de eerste echte aanmelding moet de
   regierol expliciet aan de bevestigde identiteit worden gekoppeld; er zijn
   nu nul productie-Auth-gebruikers. Er is geen geslaagde productie-SMTP-test
   vastgelegd.
3. **CI van de nieuwe controlebron.** De nieuwe main-controlecommit met het
   productieprofiel en de workflow moet nog zijn eigen CI afronden. Appcommit
   `17fa1d32cc0c77cfeec544316f215a635c70705b` blijft de geaccepteerde kandidaat;
   de huidige stagingrelease wordt hiervoor niet opnieuw gedeployd.

Het acceptatierecord voor de vijf bestaande stagingpraktijktests is inmiddels
wel aanwezig. Het berust op de expliciete verklaring van de gebruiker,
“Ja alles is getest”, over gezinslogin, regierollen, bestellen/PDF, werkelijke
mailontvangst en showaudio/bellen. Codex heeft de
providers of hardware niet zelf gerepeteerd. De verklaring blijft uitsluitend
gebonden aan de bestaande app-SHA, stagingrun/release en configuratie en wordt
niet naar een nieuwe appcommit of andere stagingrun overgenomen.

Er zijn geen extra blijvende GitHub-secrets nodig. Het bestaande environment
`production` houdt zijn vier publieke variabelen; OpenAI, LiveKit en Resend
worden vervolgens via de versleutelde Milo-regie-instellingen beheerd. De
Storage-projectlimiet en Supabase Auth SMTP zijn afzonderlijke
projectinstellingen en worden niet door deze providerinstellingen gewijzigd.

## Veilige vervolgstappen

1. Bevestig de nieuwe globale Storage-limiet en herhaal de gerichte preflight.
2. Behoud de aangemaakte runtime-login, onveranderbare bundel en masterkey exact.
   Maak de login niet opnieuw aan en reset het wachtwoord niet. De lokale
   parserfout bij twee JSON-uitvoerregels is opgevolgd door een onafhankelijke
   geslaagde runtimecontrole. Bewaar het beheerpad, de volledige versleutelde
   backup en de gecontroleerde externe kopie. Organiseer afzonderlijk herstel
   van de backupkey; externe sleutelbewaring is nog niet bevestigd.
3. Rond de productie-Auth-inrichting af met de bedoelde Google-app, redirects
   en eigen SMTP-route en test echte aanmelding en terugkeer.
4. Commit de nieuwe openbare profiel-/workflowbron en bootstrapcorrecties.
   Wacht op geslaagde CI voor die exacte controlecommit. Behoud de geaccepteerde
   appcommit `17fa1d32cc0c77cfeec544316f215a635c70705b`, de huidige
   stagingrelease en het bijbehorende root-only acceptatierecord; deploy de
   nieuwe controlecommit hiervoor niet naar staging.
5. Controleer runner-ID `22` opnieuw vlak vóór dispatch. Publiceer uitsluitend
   het eigen beoordeelde Caddyfragment met validatie van de volledige
   Caddyconfiguratie. Start de beschermde productieworkflow met de geaccepteerde
   app-SHA en het bestaande configuratie-ID. Omzeil de productiegate niet.
6. Verifieer loopback en publieke HTTPS, exacte SHA/run/configuratie, assets,
   anonieme grenzen en de echte gebruikersflow. Vergelijk alle bestaande
   sitefragmenten, service-identiteiten en publieke health met de baseline.
   Vul dit verslag aan met de werkelijke productie-identiteit en run-URL.

De huidige gezonde stagingbron is
`17fa1d32cc0c77cfeec544316f215a635c70705b`, release `43754522473-1`, configuratie
`staging-2026-11-11-v2`. De bijbehorende
[CI-run](https://github.com/milobingo/platform/actions/runs/43753495523) en
[staging-uitrol](https://github.com/milobingo/platform/actions/runs/43754522473)
slaagden. De gebruiker heeft alle vijf praktijktests voor precies deze
stagingrelease bevestigd; de root-only attestatie legt die herkomst vast.
De productie-app is daarmee nog niet geactiveerd of op productie getest.

De definitieve workflow scheidt de bronnen: controlecode en productieprofiel
komen uit de nieuwe main-controlecommit onder `production-control`; de
geaccepteerde appcommit komt onder `application-source`. De publieke controle
draait met de appbron als werkdirectory en vergelijkt assets daardoor met de
werkelijke kandidaat. Het ontbreken van het latere productieprofiel in
appcommit `17fa1d3` is geen reden om staging of haar acceptatierecord te
vervangen. De rootgate en broker blijven ongewijzigd controleren op eigen
main-bronnen, exacte app-CI, de huidige stagingrelease en het passende record.

## Uitgevoerde technische controles

De volledige lokale checkrunner slaagde met **124 van 124 checkscripts**. De
nieuwe controlecommit moet nog zijn eigen exacte CI doorlopen; er is voor deze
promotie geen nieuwe staging-uitrol gepland.

Werkelijk tegen het productieproject uitgevoerd: geverifieerde TLS en
PostgreSQL-authenticatie voor de beheer- en runtime-login, volledige versleutelde
backup met aparte restore, identieke data-/beveiligingsdigests, beide schema-
initialisaties, 23 tabellen met RLS, checksumhistorie en de private-bucketcontrole.
Ook de onafhankelijke runtimecontrole en de validatie van de opgeslagen bundel
door de daadwerkelijk geïnstalleerde broker zijn geslaagd.
De productie-app en de gebruikers-/uitzendketen zijn hiermee nog niet actief of
geaccepteerd.

De nieuwe runtimehelper is lokaal met fictieve gegevens op PostgreSQL 17 getest:
zeven tests slaagden, waaronder echte SCRAM-authenticatie, toegang tot alle 23
tabellen, afwijzing van DDL/rolwrites, rollback van te ruime rechten en behoud
van de private overdracht na een onzekere commit. De zes afzonderlijke
bootstraptests en elf hostvoorbereidingstests slaagden. De twaalf beschermde
productiecontracttests en tien bestaande productiedeploytests slaagden ook.
De legacy Storage-404-in-HTTP-400-respons heeft een eigen regressietest;
andere 400-, 401-, 403- en 500-responses blijven blokkeren.

De read-only nacontrole van 15 november om 20:24 UTC bevat uitsluitend geslaagde
vergelijkingen met de vooraf vastgelegde hostbaseline: alle zeven bestaande
apps geven HTTP 200 met `status=ok`; service-identiteiten en PIDs, alle zeven
Caddyfragmenten en de hoofdconfiguratie, applicationlisteners en release-/health-
identiteiten zijn ongewijzigd. Milo-productie is daarbij niet geactiveerd.

Deze controles gebruikten geen echte kinderen of kijkers en bewijzen geen
uitgevoerde Google-, mail-, LiveKit-, YouTube- of OBS-repetitie.
De praktijkacceptatie van de bestaande stagingrelease is afzonderlijk door de
gebruiker bevestigd, niet door Codex waargenomen. De productiegebruikersflow
moet na activatie nog worden gecontroleerd. De productiegate en bestaande
winstregels worden hiervoor niet versoepeld.
