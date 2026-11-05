# Milo staging: overdracht aan de hostbeheerder

Staging is in deze opdracht geautoriseerd; productie niet. Deze overdracht maakt de resterende hostinrichting concreet. De voorbeelden onder `infra/staging/` zijn niet geïnstalleerd en bewijzen geen actieve release. Er wordt geen nieuwe privileged deploywrapper gebouwd: gebruik de bestaande, door DG beoordeelde implementatie en haar echte configuratiecontract.

## Vastgestelde bestemming

De uitgebreide read-only runnerinspectie is [GitHub Actions-run 42051941726](https://github.com/milobingo/platform/actions/runs/42051941726). Onderstaande gegevens komen uit de inspectie en de bevestigde GitHub-stagingconfiguratie; ze zijn geen afleiding uit andere projecten.

| Onderdeel | Bevestigd |
| --- | --- |
| Repository / integratiebranch | `milobingo/platform`, `main` |
| GitHub environment | `staging` |
| Host | `dg-nxttrack-01` |
| Bereikbare beheerhost op Tailscale | `100.111.66.17`; dit is geen beschikbare SSH-identiteit |
| Staging-origin | `https://milo-staging.dgwebservices.nl` |
| Publieke DNS A | `128.140.93.95` op het inspectiemoment |
| Runnernaam | `dg-nxttrack-01-nxttrack-staging` |
| Aangetroffen labels | `self-hosted`, `Linux`, `X64`, `dg-milobingo-01`, `dg-nxttrack-01`, `milobingo`, `staging` |
| Runnergebruiker | `run-mil-stg`, UID `1001`, lid van `dg-build` |
| Exacte checkout | `/home/run-mil-stg/_work/platform/platform` |
| Appgebruiker / groep | `app-mil-stg`, UID `996`, GID `987` |
| Site-ID / siteroot | `milobingo-staging`, `/srv/sites/milobingo-staging` |
| Bestaande siteroot | Eigenaar `root:app-mil-stg`, mode `0750`; de runner kan deze grens niet zelfstandig wijzigen |
| Bestaande persistente map | `/srv/sites/milobingo-staging/shared`, eigendom van de appgebruiker; bestaande inhoud behouden |
| Supabase-project | `lfsdgxcpdyghidzkzzvn`, URL `https://lfsdgxcpdyghidzkzzvn.supabase.co` |
| Private Storagebucket | `milo-staging` |
| Apppoort | **Nog door de hostbeheerder te kiezen en te reserveren.** Er is geen poort afgeleid uit een ander project. |

De runner heeft geen `sudo`-bevoegdheid voor de noodzakelijke hostinrichting. Sleuteltoegang als `dgadmin` is inmiddels getest; diens sudo is interactief. Root-SSH is uitgeschakeld door de bestaande hosthardening. Een tijdelijke adresgebonden beheerverbinding kan pas na de geautoriseerde sudo-stap van de beheerder worden gebruikt. De inspectie vond geen inzetbare `dg-site-deploy`, Node-/pnpm-deploytoolchain of PostgreSQL-backupclients. De interne Node van GitHub Actions is geen app- of buildtoolchain. Caddy is actief via zijn bestaande systemd-unit, maar luisterde alleen op poort 80; er is geen Milo-appservice of Milo-sitefragment aangetroffen. `/etc/dg-sites` is `root:root`, mode `0700`; de inhoud is niet door de runner geïnspecteerd.

## Inrichting door de bestaande beheerconsole

Gebruik de bestaande geautoriseerde root-/beheerconsole op **deze host**. Deel geen toegangssleutels of secretwaarden in chat, Git of logs. Beperk alle projectwijzigingen tot Milo staging; verander geen bestaande andere app, productieservice, runner of domein.

1. **Bevestig de bestaande grenzen.** Controleer hostnaam, UID/GID, runnernaam, exact checkoutpad, siteroot en bestaande symlinks. Behoud de bestaande eigenaren en inhoud; gebruik geen recursieve `chown`, brede groepsrechten of `chmod 777` om de runner toegang te geven.
2. **Installeer de vastgelegde toolchain via het bestaande DG-beheerpad.** Vereist: Node `24.18.0` en pnpm `11.25.0`, bereikbaar via vaste beoordeelde systeempaden voor de gekozen build- en appidentiteit. Controleer versie en herkomst. Gebruik niet de interne runner-Node en voer geen onbekend downloadscript als root uit.
3. **Lever de bestaande DG-wrapper aan.** Installeer de beoordeelde implementatie als root-beheerd bestand, niet schrijfbaar voor runner of app. Leg de werkelijke versie, absolute padnaam, SHA-256, configuratiecontract, buildidentiteit en herstelinterface vast. Er is geen lokaal verzonnen profielbestand of zelfgeschreven attestatie die deze review kan vervangen.
4. **Registreer Milo volgens dat bestaande wrappercontract.** Bind uitsluitend site-ID `milobingo-staging`, de exacte checkout, appgebruiker, siteroot, service en gekozen loopbackpoort. Inspecteer de bestaande root-only configuratiestructuur; neem geen ander siteprofiel over en maak geen nieuw onbeoordeeld schema omdat `/etc/dg-sites` niet leesbaar is voor de runner.
5. **Reserveer een vrije poort.** Controleer zowel het actuele hostregister als de werkelijk luisterende sockets. Noteer één gekozen poort boven 1023, gebonden aan `127.0.0.1`. Vervang daarna `__MILO_STAGING_PORT__` in de relevante voorbeelden. Het appproces krijgt geen publieke listener en geen privilege voor poort 80/443.
6. **Richt de beperkte releasebediening in.** Geef `run-mil-stg` uitsluitend de gedocumenteerde DG-deployactie voor deze site en checkout. De wrapper valideert alle overige argumenten en paden. Geen algemene `NOPASSWD: ALL`, root-shell, vrij `systemctl`-/`rsync`-/`cp`-commando, `sudo -E` of onbeperkt `SETENV`. Gebruik de bestaande beoordeelde methode voor beperkte configuratiedoorvoer.
7. **Plaats runtimeconfiguratie buiten checkout en releases.** Het servicevoorbeeld stelt `/etc/dg-sites/milobingo-staging.runtime.env` voor, root-beheerd met mode `0600`; dit pad is een voorgestelde inrichting, geen aangetroffen bestand. De systemd-manager leest het bestand en geeft alleen de appallowlist door. Stem het definitieve pad af met de werkelijke DG-wrapper en pas het servicevoorbeeld daarop aan. Bouwprocessen mogen dit bestand niet kunnen lezen.
8. **Installeer en valideer de Milo-unit en het Caddyfragment.** Gebruik de voorbeelden pas na het invullen van alle placeholders. Controleer de volledige bestaande Caddyconfiguratie vóór een gerichte reload. Controleer via het bestaande hostbeheer de HTTP-/HTTPS-bereikbaarheid en de TLS-uitgifte voor het bevestigde Milo-domein; de apppoort blijft uitsluitend loopback. Vervang geen globale Caddyconfig en neem geen DNS-providercredentials in een projectfragment op.
9. **Lever databasegereedschap en hersteldoel.** Stel de werkelijke PostgreSQL-serverversie vast en installeer compatibele `psql`, `pg_dump` en `pg_restore`. Leg een afzonderlijke, expliciet disposable hersteldatabase vast, plus versleutelde backupopslag en een apart bewaarde herstelsleutel. Gebruik geen andere bestaande appdatabase als hersteldoel.
10. **Voer eerst de niet-muterende releasepreflight opnieuw uit.** Versies, wrapperhash, gebruiker, workspace, poort, capaciteit, configuratienamen en herstelroute moeten overeenkomen. Pas daarna volgen de afzonderlijk gecontroleerde migratie en appactivatie.

Een sudoersregel met een onbeperkte argumentwildcard is geen uitgewerkte machtigingsgrens. De beheerder moet de exacte executable, vaste site en checkout begrenzen en de argumentvalidatie van de root-beheerde wrapper beoordelen. De workflow levert geen vrije shelltekst of alternatieve service-/doelpaden aan die wrapper.

## Wrapperinterface en uitvoering

De bestaande DG-native interface is in andere DG-workflows als vier positionele argumenten vastgelegd. Controleer die interface op de hier geïnstalleerde versie voordat hij wordt gebruikt:

```bash
/usr/local/bin/dg-site-deploy \
  milobingo-staging \
  /home/run-mil-stg/_work/platform/platform \
  "$GITHUB_SHA" \
  "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

Het concrete bewijs voor deze interface staat onder meer in `/home/codex/repos/lesriooltechniek/.github/workflows/deploy-production.yml` en `/home/codex/repos/duindorphalloween-frightnight-2027/.github/workflows/deploy-staging.yml`. Hun site-ID's, hostpaden, poorten en machtigingen gelden niet voor Milo. De bovenstaande aanroep claimt geen reeds geïnstalleerde wrapper op `dg-nxttrack-01` en bevat geen gegokt rollbacksubcommando.

Vereist gedrag van de beoordeelde wrapper:

- Controleer caller/host, exact vier argumenten, site-ID, canoniek checkoutpad, volledige 40-hex-SHA en een numeriek run-ID met pogingnummer. Weiger onverwachte symlinks, padtraversal, extra argumenten en een checkout die niet bij die commit hoort. Voer geen repositorycode uit als root.
- Vereis groene CI op de exacte bron-SHA vóór muterende releasestappen. Houd branch-SHA, workflow-SHA en actieve runtime-SHA afzonderlijk bij.
- Gebruik de gedeelde build-lock `/run/lock/dg-build.lock`. Inspecteer bestaande lockeigenaar en mode; verander geen globale DG-lockafspraken voor één project. Controleer onder de lock vrije bytes én inodes op checkout-, release-, cache- en backupfilesystems, met ruimte voor de bestaande app, herstelpunt, dependencies en nieuwe build.
- Installeer uit `pnpm-lock.yaml` en bouw als de vaste ongeprivilegieerde buildidentiteit. Houd runtimebestanden en server-/migratie-/backupcredentials buiten de bouwomgeving. De huidige app heeft geen verplichte `NEXT_PUBLIC_*`-bouwconfiguratie.
- Maak een nieuwe release onder `/srv/sites/milobingo-staging/releases/`. De release-identiteit moet volledige SHA, run en poging naar elkaar herleidbaar maken. Kopieer uitsluitend gecontroleerde bron- en buildbestanden; geen `.env*`, lokale database, runnercredentials of backupgeheimen.
- Provision runtimeconfiguratie alleen via de expliciete appallowlist en de beoordeelde bestaande configuratiedoorvoer. `DG_RUNTIME_ENV_KEYS` mag geen vrij door repositorycode uitbreidbare root-envdoorvoer zijn. Accepteer geen `LD_*`, `NODE_OPTIONS`, shellcommando, willekeurig envpad of deploycredential als appruntimeconfiguratie.
- Activeer `current` atomisch binnen dezelfde siteroot en herstart uitsluitend de vastgelegde Milo-appunit. Caddy wordt uitsluitend met zijn bestaande gevalideerde beheerpad aangepast. Verifieer daarna release-identiteit, lokale listener, externe HTTPS en gebruikersflows.

## Standalone-runtimecontract

Het servicevoorbeeld gebruikt deze expliciete inrichting:

```text
/srv/sites/milobingo-staging/
  releases/<release-id>/.next/standalone/server.js
  releases/<release-id>/.next/standalone/public/
  releases/<release-id>/.next/standalone/.next/static/
  releases/<release-id>/.next/standalone/drizzle/
  current -> releases/<release-id>
  shared/
```

De release moet via Next.js `output: 'standalone'` zijn gebouwd. `public/` en `.next/static/` worden niet vanzelf aan die output toegevoegd en moeten expliciet worden verpakt. Controleer daarnaast de getraceerde runtimeafhankelijkheden `pg` en `ws`, de SQLite-ondersteuning van Node en de benodigde lokale migratiebestanden. Het appwerkpad is `current/.next/standalone`; relatieve bestandstoegang gaat dus vanuit die map. De bestaande PostgreSQL-stagingconfiguratie mag niet door een ontbrekende waarde stilzwijgend in lokale SQLite veranderen.

`milobingo-staging.service.example` gebruikt een vast Node-binarypad als placeholder en start rechtstreeks `server.js`; de app start geen package-manager, shell of build. Zet `NODE_ENV=production`, `HOSTNAME=127.0.0.1` en de gekozen `PORT`. Lokale repetitielogin blijft uit. Eventueel noodzakelijke beschrijfbare Next-caches moeten door de beoordeelde verpakking naar een eigen submap van `shared` worden geleid en getest; maak de complete release niet schrijfbaar voor de app. Deel geen buildcache met private runtimeobjecten.

Deze afspraken volgen de lokaal geïnstalleerde documentatie in `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` en `node_modules/next/dist/docs/01-app/02-guides/self-hosting.md`. Zij zijn hier op 5 november 2026 gelezen; een verpakkingsvoorbeeld is geen geslaagde hoststart.

## Configuratiegrenzen

`infra/staging/runtime.env.example` bevat alleen namen, bevestigde niet-geheime waarden en verplichte invulvelden. De bestaande GitHub-stagingsecrets worden uitsluitend via de afgesproken veilige inrichting gebruikt; hun waarden horen niet in de documentatie of repository. Nodig voor de aangesloten app: canonieke app-URL, eigen Supabase-URL/publishable key, PostgreSQL-runtimeverbinding, private bucket en Storage-secret. Overige providerkeys zijn alleen nodig voor de werkelijk aangesloten functie.

De runtimeverbinding mag geen migratie-/backupbeheermachtigingen krijgen. Migratiecredentials, geïsoleerde restorecredentials, backupencryptie, GitHub-tokens en deployrechten blijven buiten het appbestand en buiten `next build`. Een variabelenaam die zowel een runtime- als een beheerverbinding zou kunnen voorstellen moet per fase aan de juiste, afzonderlijke identiteit worden gebonden; hergebruik niet ongemerkt dezelfde machtige database-login.

Laat release-SHA, release-ID en configuratieversie na iedere activatie overeenkomen met de gerapporteerde healthmetadata. De aanwezigheid van secrets en een HTTP 200 bewijzen geen werkende OTP/Google, roltoekenning, providerstem, microfoon of mailbezorging. Het bestaande DG-mailgateway-/outboxcontract blijft afzonderlijk aan te sluiten.

## Backup, bewaring en herstel

Maak vóór migraties een versleutelde backup van de relevante bestaande stagingdata en toegangsrechten. Gebruik afgeschermde PostgreSQL-service-/passwordbestanden of de bestaande DG-backupvoorziening; plaats geen databasewachtwoord in commandline-argumenten. Verifieer de backup door herstel naar de vooraf expliciet bevestigde disposable database, met externe jobs/bezorging technisch uitgeschakeld. Vergelijk migratiehistorie, aantallen, eigenaarschap, grants/RLS en eventuele private Storage-objecten. Bewaar encryptiegeheimen afzonderlijk van het artifact.

Leg vóór activatie vast: backup-ID/checksum, encryptiemethode en sleutel-ID, hersteldoel, hersteltijdstip/resultaat, migratiehashes, bron-SHA, vorige gezonde release en de concrete door DG beoordeelde rollbackhandeling. Voor de eerste apprelease kan er nog geen vorige Milo-app zijn; registreer dat expliciet en beschrijf het stop-/herstelpad zonder een fictieve eerdere release te noemen.

De beheerder legt aantallen en termijnen voor releases, caches en backups vast. Bewaar ten minste de actieve release, het gekozen gezonde herstelpunt en de releasegebonden backup. Cleanup gebeurt onder de bestaande lock en raakt geen onbekende bestanden, actieve symlinkdoelen, andere sites of ongecontroleerde paden. Een approllback schakelt alleen de app terug: database, Auth, Storage, Edge Functions en providerconfiguratie rollen niet automatisch mee terug.

## Validatie en teruggave aan de releaseprocedure

De beheerder rendert de voorbeelden, kiest de nog ontbrekende poort en het vaste Node-pad, stemt het private envpad af en controleert dat geen `__...__`-placeholder is overgebleven. Valideer de gerenderde unit met `systemd-analyze verify` en de **volledige actieve** Caddyconfiguratie met `caddy validate` voordat bestanden worden geactiveerd. Deze voorbeelden zijn geen opdracht om zonder die controle `daemon-reload`, `enable`, restart of Caddy-reload uit te voeren. Zie de primaire documentatie voor [systemd-executie](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml) en [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Lever daarna aan de releaseprocedure terug:

- Werkelijke wrapperversie, absolute padnaam en beoordeelde SHA-256, plus bevestiging van het vierargumenten- en rollbackcontract.
- Gekozen poort, unitnaam/-pad, Caddyfragment/-include en effectieve appwerkmap; alleen relevante niet-geheime velden.
- Node-/pnpm- en PostgreSQL-clientversies, lock- en capaciteitsbewijs, eigenaar/modes van de Milo-mappen en beperkte deploymachtiging.
- Definitief private runtimeconfiguratiepad, gecontroleerde allowlists en configuratieversie; uitsluitend namen en aanwezigheid, geen waarden.
- Afzonderlijk restoredoel en aantoonbaar backup-/herstelpad vóór de eerste migratie.

Pas na deze inrichting kan de stagingrunner de normale releaseprocedure afronden. De runnerinspectie heeft geen rootconfiguratie geïnstalleerd, migratie uitgevoerd of stagingapp geactiveerd.
