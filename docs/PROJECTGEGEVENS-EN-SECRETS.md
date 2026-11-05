# Projectgegevens, accounts en configuratie

Deze lijst hoort bij de lokale Next.js-overzetting van 4 november 2026. De lokale bouw en inventaris zijn opgeleverd. Op 5 november 2026 is repository `milobingo/platform` aangeleverd voor synchronisatie naar `main`. Op 5 november is ook stagingdeployment opgedragen. GitHub bevat inmiddels de stagingvariabelen, runtime-secrets en een werkende runner; de host mist nog het releasepad. Er is geen stagingrelease geactiveerd. Zie [STAGING-DEPLOY.md](STAGING-DEPLOY.md) en [STAGING-HOST.md](STAGING-HOST.md).

## Eerst aanleveren

| Onderdeel | Benodigde gegevens |
| --- | --- |
| GitHub | Bevestigd: [milobingo/platform](https://github.com/milobingo/platform), integratiebranch `main`, remote `origin`. Environments `staging` en `production` bestaan; de Milo-stagingrunner is online. |
| Development | VPS-host, checkoutpad en Linux-gebruiker. De huidige werkmap is `/home/codex/repos/milobingo`; dat bewijst geen DG-developmenthost. |
| Staging | Bevestigd: `https://milo-staging.dgwebservices.nl`, `milobingo-staging`, host `dg-nxttrack-01`, root `/srv/sites/milobingo-staging`, runner `run-mil-stg`, app `app-mil-stg`. Exacte labels/workspace staan in het projectprofiel. Lokale servicepoort en root-releasepad nog inrichten. |
| Productie | Dezelfde gegevens afzonderlijk, plus de toegestane releasescope. |
| DG-wrapper | Geïnstalleerde `dg-site-deploy`-versie, CLI-contract, build-lock, start-/activatie-/rollbackcommando en Caddy-configuratie. |
| Supabase | Organisatie/eigenaar, apart staging- en productieproject, projectrefs, regio, databaseverbinding en Auth-/Storageinstellingen. |
| Beheer | Wie regie/eigenaar mag worden en diens Supabase user-ID; toekenning via `app_user_roles`, niet via een invulbaar e-mailadres of metadata. |
| Mail | Bestaand DG-mailgatewaycontract, omgevinggebonden endpoint, signing/key-ID-contract, worker/outbox, afzender, ontvangerbeleid en webhookcontract. Deze bron bevat het vaste DG-contract nog niet. |
| Over te nemen data | Of bestaande D1/R2-gegevens moeten worden behouden; zo ja: gecontroleerde export, ID-/eigenaarsmapping en de oorspronkelijke encryptiesleutel via een veilig kanaal. De ZIP bevat geen runtime-export. |
| Uitzending | YouTube-kanaal/uitzending, insluitbare video-ID/URL, OBS-opstelling en testapparaten voor de belrepetitie. |

Werk de bevestigde gegevens bij in het actuele `PROJECTPROFIEL.json` in de projectroot. Het gelijknamige bestand onder `docs/overdracht/` blijft de oorspronkelijke bronbeschrijving.

## Accounts en diensten

| Dienst | Aanmaken of beschikbaar stellen | Waar de configuratie hoort |
| --- | --- | --- |
| GitHub | Repository; environments `staging` en `production`; bevoegde beheerders en selfhosted runners per doelomgeving. | GitHub environment variables/secrets en DG-hostconfiguratie. De meegeleverde CI publiceert niets. |
| Supabase | Twee afzonderlijke projecten voor PostgreSQL, Auth en desgewenst private Storage. | Runtimewaarden per omgeving; beheer-/CLI-tokens uitsluitend in het releasepad. |
| Google Cloud | OAuth webclient en consentconfiguratie als Google-login wordt gebruikt. | Client-ID en client-secret in de Google-provider van het bijbehorende Supabase-project. Geen app-runtimevariabelen hiervoor. |
| Resend | Beschikbaar account, geverifieerd afzenderdomein/DNS en afgesproken verzendbevoegdheden. | Auth-mailinstellingen en de DG-mailgateway; applicatiemail via een duurzame outbox. Contract nog aanleveren en aansluiten. |
| OpenAI | Alleen voor echte AI-/stemfunctionaliteit: eigen project, facturering/tegoed en toegang tot de gekozen modellen. | Eén centrale serversleutel via `OPENAI_API_KEY`. Geen sleutel per personage. |
| LiveKit Cloud | Eigen project met Cloud-URL, API key en API secret voor de echte belverbinding. | `LIVEKIT_URL`, `LIVEKIT_API_KEY` en `LIVEKIT_API_SECRET` op de server, of de aparte beveiligde regie-instellingen. |
| YouTube / OBS | Kanaal met bruikbare insluitbare uitzending; OBS op het uitzendapparaat. | Show-/streaminstellingen. OBS is lokale uitzendsoftware, geen benodigde app-secret. |
| DNS / VPS | DNS-toegang, DG-hostcapaciteit en TLS/Caddy-configuratie. | Beheeromgeving, buiten de applicatie-runtime. |

Voor bouwen en de expliciete demofamilie zijn geen externe accounts nodig. De lokale repetitielogin is alleen beschikbaar wanneer die expliciet is ingeschakeld op een developmentserver op loopback. Echte OTP, Google-login, AI, mail en bellen blijven afzonderlijke aansluit- en acceptatiestappen.

Het oorspronkelijke Cloudflare-WebSockettransport van GPT-Live is overgezet naar een uitgaande Node-WebSocketadapter. Zeven lokale tests gebruiken een echte loopback-WebSocketserver voor onder meer PCM-audio, sessieafsluiting, time-outs en afwijzing; ze openen geen providerverbinding. De status `transportStatus: local_contract_tested` is geen bewijs van OpenAI-modeltoegang of een echte uitzending. Verifieer na configuratie het huidige model-/API-contract, de gekozen stemmen en de volledige audioketen met het eigen account. Het vaste DG-mailgateway-/outboxcontract ontbreekt nog en vraagt aanvullende implementatie, geen fictieve secretwaarde.

## Exacte appconfiguratie

Kopieer `.env.example` naar `.env.local` voor lokaal gebruik. Vul nooit echte secrets in `.env.example`, Git, chat of testlogs in. Alle onderstaande namen worden op de server gelezen; de huidige app heeft geen verplichte `NEXT_PUBLIC_*`-configuratie.

| Naam | Soort / fase | Gebruik |
| --- | --- | --- |
| `APP_URL` | Publieke URL, serverruntime | Canonieke app-origin. Voor live Auth verplicht; per omgeving gelijk aan de daadwerkelijke app-origin. Callback: `/auth/callback`. |
| `MILO_LOCAL_AUTH` | Runtimevariabele | Alleen `true` voor expliciete lokale repetitielogin in development op `localhost`, `127.0.0.1` of `::1`, zonder remote projectconfiguratie of proxy. In staging/productie uit. |
| `SQLITE_PATH` | Runtimepad | Lokale database; standaard `.data/milobingo.sqlite`. Geen productie-databasekeuze. |
| `OBJECT_STORAGE_PATH` | Runtimepad | Lokale private bestanden; standaard `.data/objects`. Buiten een wegwerp-release bewaren als dit later bewust wordt gebruikt. |
| `DATABASE_URL` | **Serversecret**, runtime | Beperkte PostgreSQL-login van het eigen Supabase-project, lid van `milo_backend`, zonder superuser/rolbeheer/RLS-bypass; activeert de PostgreSQL-adapter. De beheerverbinding `MIGRATION_DATABASE_URL` blijft uitsluitend in het releasepad. |
| `SUPABASE_URL` | Publieke project-URL, serverruntime | Eigen Supabase-project voor Auth en optionele Storage. |
| `SUPABASE_DB_CA_BASE64` | Publieke CA, serverruntime en databasebeheer | Officieel Supabase-rootcertificaat als base64-PEM; peer- en hostnaamverificatie blijven aan. In GitHub staging geplaatst na de echte TLS-fout; geen private key. |
| `SUPABASE_PUBLISHABLE_KEY` | Publieke sleutel, serverruntime | Supabase Auth-client. Gebruik de publishable key van dezelfde omgeving. Deze sleutel is geen regiebevoegdheid. |
| `SUPABASE_SECRET_KEY` | **Serversecret**, runtime | Alleen voor expliciet gekozen private Supabase Storage; blijft buiten browserbundels. |
| `SUPABASE_STORAGE_BUCKET` | Runtimevariabele | Leeg voor lokale objecten. Staging gebruikt de bevestigde private bucket `milo-staging` en vereist `DATABASE_URL`, `SUPABASE_URL` en `SUPABASE_SECRET_KEY`. De oorspronkelijke SQL noemt `milo-private`; de deployprocedure controleert en configureert daarom afzonderlijk de gekozen stagingbucket. |
| `VLAMPIE_SETTINGS_KEY` | **Serversecret**, runtime | 64 hextekens voor AES-encryptie van private instellingen. Historische naam bewust behouden. Bewaar dezelfde sleutel wanneer bestaande versleutelde instellingen meegaan. |
| `OPENAI_API_KEY` | **Serversecret**, runtime, optioneel | Eén centrale providerkey, alleen als echte AI-functies worden aangesloten. Anders blijven die functies ongeconfigureerd. |
| `OPENAI_TEXT_MODEL` | Runtimevariabele, optioneel | Bestaande tekstmodelkeuze; bronstandaard `gpt-4.1-mini`. Werkelijke accounttoegang nog verifiëren. |
| `OPENAI_SPEECH_MODEL` | Runtimevariabele, optioneel | Bestaande speechmodelkeuze; bronstandaard `gpt-4o-mini-tts`. De GPT-Live-personageflow heeft een eigen vastgelegd modelcontract. |
| `LIVEKIT_URL` | Runtimevariabele, optioneel | Eigen `wss://…livekit.cloud`-projectorigin. Alleen samen met de twee LiveKitkeys configureren. |
| `LIVEKIT_API_KEY` | **Serversecret**, runtime, optioneel | Eigen LiveKit API key. |
| `LIVEKIT_API_SECRET` | **Serversecret**, runtime, optioneel | Eigen LiveKit API secret; nooit naar de browser. |
| `PORT` | Host/runtimevariabele | Lokale Next-poort of later de bevestigde servicepoort; geen nu gekozen DG-productiepoort. |
| `RELEASE_SHA` | Publieke release-identiteit, runtime | Optionele volledige 40-teken broncommit voor het healthcontract; in te vullen door het latere bevestigde releasepad. |
| `RELEASE_ID` | Publieke release-identiteit, runtime | Optionele unieke actieve release-identiteit. |
| `CONFIG_VERSION` | Publieke release-identiteit, runtime | Optionele configuratieversie zonder secretwaarden. |

`RESEND_API_KEY` en `PLAYER_MAIL_FROM` zijn namen van de historische directe mailintegratie in `server/player-auth.js`. De nieuwe Auth-adapter gebruikt Supabase voor OTP; deze waarden sluiten de vaste DG-mailgateway/outbox niet aan. Daarom staan ze niet als te activeren mailconfiguratie in het nieuwe voorbeeld. Hetzelfde geldt voor `OPENAI_REALTIME_MODEL`, dat alleen door de historische call-handler wordt gelezen: dit is geen vervanging voor het GPT-Live-contract.

`VLAMPIE_ADMIN_EMAIL` is een historische interne compatibiliteitsnaam. De nieuwe identiteit komt uit een servergeverifieerde sessie en `app_user_roles`; een browserheader, e-mailadres of `user_metadata` verleent nooit een rol.

De nieuwe OpenAI-adapter gebruikt uitsluitend de centrale serversleutel uit de omgeving. Opslaan van een OpenAI-key via het historische instellingenendpoint wordt expliciet geweigerd met `server_secret_required`; de oorspronkelijke versleutelhelper blijft alleen voor broncompatibiliteit en regressies aanwezig.

Zodra één `LIVEKIT_*`-waarde is ingevuld, hebben de omgevingswaarden voorrang op de versleuteld opgeslagen LiveKitkoppeling. Een onvolledige set geeft geen geconfigureerde verbinding en leent niet stilzwijgend een eerder opgeslagen secret. Zonder omgevingswaarden blijft de aparte beveiligde regie-instelling bruikbaar.

## GitHub environments en secrets buiten de app

Gebruik voor staging en productie aparte waarden voor `APP_URL`, Supabase URL/key/projectref, databaseverbinding, encryptiesleutel, Storagebucket en eventuele providerconfiguratie. De encryptiesleutel kan alleen worden gedeeld wanneer dat voor een expliciete datamigratie nodig is; documenteer die keuze.

De huidige CI heeft geen secrets nodig. De stagingworkflow gebruikt uitsluitend environment `staging` en de bevestigde Milo-runner. De aanvullende namen voor het releasepad staan in [STAGING-DEPLOY.md](STAGING-DEPLOY.md): `DG_DEPLOY_WRAPPER_SHA256`, `DG_STAGING_PORT`, `DG_CONFIG_VERSION`, `MIGRATION_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY` en `RESTORE_TEST_DATABASE_URL`. De laatste drie horen uitsluitend bij databasebeheer/backup/herstel en gaan niet naar de app-runtime. De beheerder moet eerst de rootwrapper en beperkte deploybevoegdheid installeren. Mailgateway-/webhooksigning hoort bij het nog te leveren gatewaycontract.

Op dit moment leest de browser geen `NEXT_PUBLIC_*`-waarden. Worden die later toegevoegd, bouw iedere omgeving met haar eigen publieke configuratie: Next.js bakt deze tijdens `next build` in. Een gelijke bron-SHA bewijst geen byte-identieke staging-/productiebuild.

## Supabase-inrichting en aansluitbewijs

1. Maak of selecteer de expliciete staging- en productieprojecten. Houd de nieuwe API-keytypen aan: publishable voor gewone clients, secret alleen server-side. Zie [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).
2. Controleer het migratieplan en een herstelbare backup vóór toepassing. De speldata gaan via geautoriseerde serverroutes; RLS en ingetrokken browsergrants zijn aanvullende bescherming. Ken regie doelbewust toe in `app_user_roles`.
3. Zet de juiste Site URL en `/auth/callback` in de Supabase redirectallowlist. Activeer e-mail-OTP en gebruik een OTP-template met de Supabase-tokenvariabele. [Passwordless email sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless) beschrijft dit contract.
4. Stel de Google webclient in met de callback uit het eigen Supabase-dashboard; zet het client-secret in de Supabase-providerinstellingen. De appcallback en provider-callback zijn verschillende adressen. Zie [Sign in with Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).
5. Richt de gekozen Auth-mailroute en de bestaande DG-gateway in. Voor nieuwe gratis projecten is aanpassing van Auth-mailtemplates niet beschikbaar met de standaard SMTP-dienst; regel eigen SMTP of een passend projectplan wanneer nodig. Zie [wijziging van 3 juni 2026](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).
6. Doorloop OTP en Google met echte testaccounts; controleer sessieherstel, uitloggen, ongeautoriseerde toegang, meerdere kindprofielen en een echte postbus. Leg provideracceptatie, aflevering en ontvangst afzonderlijk vast.

De Supabase-changelog en bovenstaande primaire documentatie zijn op 4 november 2026 geraadpleegd. De aangekondigde [TLS-wijziging vanaf 10 november](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) is relevant voor oude testapparaten; test de werkelijk gebruikte browsers tijdens acceptatie. Er is met deze documentatiecontrole geen projectverbinding of provideraccount getest.
