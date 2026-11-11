> Historisch archief van de documentatie vóór de beschermde deployroute van 11 november 2026. Dit document beschrijft de eerdere werkwijze en eerdere waarnemingen; het is geen actuele installatie- of acceptatiestatus. Gebruik [PROJECTGEGEVENS-EN-SECRETS.md](PROJECTGEGEVENS-EN-SECRETS.md) voor de huidige procedure en [BESCHERMDE-CONFIGURATIE.md](BESCHERMDE-CONFIGURATIE.md) voor de migratiestatus.

# Projectgegevens, accounts en configuratie

De lokale Next.js-bouw is opgeleverd en de bron staat op `main` van [milobingo/platform](https://github.com/milobingo/platform). De native stagingwrapper, toolchains, beperkte deploybevoegdheid, appunit en Caddy/TLS zijn geïnstalleerd. GitHub, het bestaande Supabase-stagingproject en de benoemde OpenAI-/LiveKitwaarden zijn al geconfigureerd: hiervoor hoeven geen nieuwe stagingaccounts te worden aangemaakt. De v70-upgrade naar **23 applicatietabellen met RLS** is geslaagd na een werkelijke volledige backup-/herstelproef; de bestaande beperkte runtime-login is geverifieerd. De app is actief op [Milo staging](https://milo-staging.dgwebservices.nl), met geslaagde native deployment, publieke release-/asset-/toegangscontroles en 19 releasegebonden browsertests. Regie-/familie-API en providers zijn in de UI-proef gesimuleerd; echte account- en uitzendacceptatie blijft apart.

De actuele actieve bron, workflow, browserregistratie en resterende vrijgavepoorten staan in [PROJECTPROFIEL.json](../PROJECTPROFIEL.json) en [STAGING-RESULTAAT.md](STAGING-RESULTAAT.md). Een groene CI voor een volgende kandidaat is nog geen nieuwe staginguitrol. De [hostaudit](../verification/staging-release.json), [backendacceptatie](../verification/staging-backend-acceptance.json) en [handmatige app/configuratie-hersteloefening](../verification/staging-recovery.json) van 5 november blijven historisch bewijs. Zie ook [de v70-integratie](V70-INTEGRATIE-EN-VRIJGAVE.md), [STAGING-DEPLOY.md](STAGING-DEPLOY.md) en [STAGING-HOST.md](STAGING-HOST.md). Productie is op 6 november 2026 expliciet geautoriseerd; de echte bestemming en gescheiden backendconfiguratie ontbreken nog. De [productieprocedure](PRODUCTIE-DEPLOY.md) beschrijft de vereiste inrichting.

## Bevestigd en nog aan te leveren

| Onderdeel | Benodigde gegevens |
| --- | --- |
| GitHub | Bevestigd: [milobingo/platform](https://github.com/milobingo/platform), integratiebranch `main`, remote `origin`. Environments `staging` en `production` bestaan; de Milo-stagingrunner is online. |
| Development | De lokale werkmap `/home/codex/repos/milobingo` en lokale demo zijn beschikbaar. Alleen wanneer daarnaast een DG-developmenthost gewenst is: host, checkoutpad en Linux-gebruiker afzonderlijk bepalen. |
| Staging | Bevestigd: [milo-staging.dgwebservices.nl](https://milo-staging.dgwebservices.nl), `milobingo-staging`, host `dg-nxttrack-01`, root `/srv/sites/milobingo-staging`, runner `run-mil-stg`, build `build-mil-stg`, app `app-mil-stg`, loopbackpoort `4173`. Native uitrol, publieke controles en 19 browsertests zijn geslaagd; de UI-proef simuleert regie-/familie-API en providers. Exacte actuele release en bewijslinks: [projectprofiel](../PROJECTPROFIEL.json) en [stagingresultaat](STAGING-RESULTAAT.md). Muterende CRUD/private-Storageacceptatie van 5 november blijft afzonderlijk historisch bewijs. |
| Productie | Geautoriseerd op 6 november 2026. Nog nodig: domein, host/site-ID, runner/accounts/paden/poort, productionenvironmentwaarden en een afzonderlijk Supabase-project. Environment production is leeg; er is alleen een stagingrunner. |
| DG-wrapper | Geïnstalleerd: nieuwe Milo-specifieke native versie 1, vier argumenten, root-owned entry/helper, globale build-lock, begrensde sudoers-regel, releasegebonden env, appunit/Caddy en automatische health-rollback. Geen eerder aanwezige centrale wrapperstandaard aangetroffen. Hashes en exacte paden staan in het hostbewijs. |
| Supabase | Stagingproject `lfsdgxcpdyghidzkzzvn`, URL `https://lfsdgxcpdyghidzkzzvn.supabase.co` en private bucket `milo-staging` zijn ingericht; de upgrade naar 23 RLS-tabellen, volledige backup/restore en beperkte runtime zijn gecontroleerd. De eerdere echte database-/Storagebewerkingen blijven historisch bewijs. Nog bevestigen: verantwoordelijke eigenaar/teamtoegang en echte Auth-/mail-/accountacceptatie. Een productieproject later afzonderlijk bepalen; staging niet opnieuw aanmaken. |
| Beheer | Nog nodig: wie regie/eigenaar mag worden en diens echte Supabase user-UUID, plus bruikbare testaccounts. Toekenning via `app_user_roles`, niet via een invulbaar e-mailadres of metadata. |
| Mail | Bestaand DG-mailgatewaycontract, omgevinggebonden endpoint, signing/key-ID-contract, worker/outbox, afzender, ontvangerbeleid en webhookcontract. De gesigneerde DG-envelopadapter is geïntegreerd; daadwerkelijke Milo-worker/outbox/afzender en reconciliatiecontract moeten nog worden ingericht. |
| Over te nemen data | Of bestaande D1/R2-gegevens moeten worden behouden; zo ja: gecontroleerde export, ID-/eigenaarsmapping en de oorspronkelijke encryptiesleutel via een veilig kanaal. De ZIP bevat geen runtime-export. |
| Uitzending | YouTube-kanaal/uitzending, insluitbare video-ID/URL, OBS-opstelling en testapparaten voor de belrepetitie. |

Werk de bevestigde gegevens bij in het actuele `PROJECTPROFIEL.json` in de projectroot. Het gelijknamige bestand onder `docs/overdracht/` blijft de oorspronkelijke bronbeschrijving.

## Accounts en diensten

| Dienst | Aanmaken of beschikbaar stellen | Waar de configuratie hoort |
| --- | --- | --- |
| GitHub | Repository, stagingenvironment, runner en configuratie bestaan. Geen nieuwe stagingrepository of runner nodig. Productierunners/bevoegdheden later afzonderlijk bepalen. | GitHub environment variables/secrets en DG-hostconfiguratie. CI verifieert bron; deployment verloopt via de afzonderlijke handmatige workflows. |
| Supabase | Bestaand stagingproject gebruiken. Database/restore en private Storageacceptatie zijn geslaagd; Auth-/accountacceptatie afronden. Productie later als afzonderlijk project bepalen. | Runtimewaarden per omgeving; migratie-/backup-/herstelcredentials uitsluitend in de eigen beheerstappen. |
| Google Cloud | Bestaande OAuth-webclient en consentconfiguratie bevestigen als Google-login wordt gebruikt. Alleen een client aanmaken wanneer geen geschikte bestaande client beschikbaar is. | Client-ID en client-secret in de Google-provider van het bestaande Supabase-project. Geen app-runtimevariabelen hiervoor. |
| Resend / SMTP | Bestaand mailaccount, afzenderdomein/DNS en verzendbevoegdheden volgens het nog aan te leveren DG-mailcontract bevestigen. De geplaatste appkeys configureren deze mailroute niet. | Auth-mailinstellingen en de DG-mailgateway; applicatiemail via een duurzame outbox. Contract nog aanleveren en aansluiten. |
| OpenAI | Stagingkey en modelnamen zijn geplaatst. Geen nieuw stagingaccount nodig; echte project-/modeltoegang en stemgebruik zijn nog niet geaccepteerd. | Eén centrale sleutel via `OPENAI_API_KEY` of de versleutelde regie-instelling bij Instellingen → AI & stemmen. Geen sleutel per personage. |
| LiveKit Cloud | Staging-URL, API key en API secret zijn geplaatst. Geen nieuw stagingproject nodig; echte belverbinding en audio nog testen. | `LIVEKIT_URL`, `LIVEKIT_API_KEY` en `LIVEKIT_API_SECRET` op de server, of de beveiligde regie-instelling bij Instellingen → E-mail & bellen. |
| YouTube / OBS | Kanaal met bruikbare insluitbare uitzending; OBS op het uitzendapparaat. | Show-/streaminstellingen. OBS is lokale uitzendsoftware, geen benodigde app-secret. |
| DNS / VPS | Staging-DNS, native toolchains, poort `4173` en Caddy/TLS zijn ingericht. Productiedomein/hosting nog afzonderlijk bepalen. | Beheeromgeving, buiten de applicatie-runtime. |

Voor bouwen en de expliciete demofamilie zijn geen externe accounts nodig. De lokale repetitielogin is alleen beschikbaar wanneer die expliciet is ingeschakeld op een developmentserver op loopback. Echte OTP, Google-login, AI, mail en bellen blijven afzonderlijke aansluit- en acceptatiestappen.

Het oorspronkelijke Cloudflare-WebSockettransport van GPT-Live is overgezet naar een uitgaande Node-WebSocketadapter. Zeven lokale tests gebruiken een echte loopback-WebSocketserver voor onder meer PCM-audio, sessieafsluiting, time-outs en afwijzing; ze openen geen providerverbinding. De status `transportStatus: local_contract_tested` is geen bewijs van OpenAI-modeltoegang of een echte uitzending. Verifieer na configuratie het huidige model-/API-contract, de gekozen stemmen en de volledige audioketen met het eigen account. De gesigneerde DG-bestelmailadapter is gebouwd. De daadwerkelijke Milo-gateway/worker, het reconciliatiecontract en een beoordeelde runtime-allowlist zijn nog nodig; een fictieve secretwaarde activeert dit niet.

## Exacte appconfiguratie

Kopieer `.env.example` naar `.env.local` voor lokaal gebruik. Vul nooit echte secrets in `.env.example`, Git, chat of testlogs in. Alle onderstaande namen worden op de server gelezen; de huidige app heeft geen verplichte `NEXT_PUBLIC_*`-configuratie.

| Naam | Soort / fase | Gebruik |
| --- | --- | --- |
| `NODE_ENV` | Vaste stagingruntimevariabele | `production` in het native releasepad; de lokale repetitielogin blijft daardoor uitgeschakeld. |
| `HOSTNAME` | Vaste stagingruntimevariabele | `127.0.0.1`; Caddy benadert uitsluitend de loopbackserver. |
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
| `VLAMPIE_SETTINGS_KEY` | **Serversecret**, runtime | 64 hextekens voor AES-encryptie van private instellingen, mailstudio-templates en frozen outboxpayloads. Vereist voor die beveiligde opslag; alleen de lokale demo kan zonder. Historische naam bewust behouden. Bewaar de sleutel bij instellingen-/mailhistorie en bij data-import; vervang haar niet zonder gecontroleerde migratie. |
| `OPENAI_API_KEY` | **Serversecret**, runtime, optioneel | Eén centrale providerkey; stagingwaarde geplaatst. Werkelijke provider-/modeltoegang volgt nog uit acceptatie, niet uit aanwezigheid van de key. |
| `OPENAI_TEXT_MODEL` | Runtimevariabele, optioneel | Bestaande tekstmodelkeuze; bronstandaard `gpt-4.1-mini`. Werkelijke accounttoegang nog verifiëren. |
| `OPENAI_SPEECH_MODEL` | Runtimevariabele, optioneel | Bestaande speechmodelkeuze; bronstandaard `gpt-4o-mini-tts`. De GPT-Live-personageflow heeft een eigen vastgelegd modelcontract. |
| `LIVEKIT_URL` | Runtimevariabele, optioneel | Eigen `wss://…livekit.cloud`-projectorigin; stagingwaarde met beide keys geplaatst. Echte verbinding nog accepteren. |
| `LIVEKIT_API_KEY` | **Serversecret**, runtime, optioneel | Eigen LiveKit API key; stagingwaarde geplaatst. |
| `LIVEKIT_API_SECRET` | **Serversecret**, runtime, optioneel | Eigen LiveKit API secret; stagingwaarde geplaatst, nooit naar de browser. |
| `PORT` | Host/runtimevariabele | Lokaal en op de bevestigde staginghost `4173`. Productiepoort wordt later afzonderlijk bepaald. |
| `MAIL_ENVIRONMENT` | Servervariabele, runtime | `staging` of `production`; bepaalt toegestane bestelmailmodus. |
| `MAIL_MODE` | Servervariabele, runtime | Standaard `disabled`; staging alleen `allowlist`, productie eventueel `live`. |
| `MAIL_ALLOWED_RECIPIENTS` | Servervariabele, runtime | Expliciete kommagescheiden lijst voor bestelmail in allowlistmodus. |
| `SEND_EMAIL_HOOK_SECRET` | Serversecret, runtime | Afzonderlijke signing secret voor de vaste DG Supabase-mailgateway. Niet een Resend-API-key. |
| `MAIL_ORGANIZATION_EMAIL` | Servervariabele, runtime | Geldig organisatieadres voor v70-servicemails en organisatiemeldingen. Geen `.invalid`-voorbeeldadres voor verzending. Vereist eerst beoordeelde wrapperuitbreiding. |
| `MAIL_FROM` | Optionele servervariabele, runtime | Contact-/voorbeeldafzender voor de studio; de vaste gateway beheert de werkelijke afzender. Activeert op zichzelf geen verzending. Vereist eerst beoordeelde wrapperuitbreiding. |
| `MAIL_ASSET_BASE_URL` | Optionele publieke URL, serverruntime | HTTPS-basis voor publieke maillogo's en assets. Zonder waarde gebruikt de renderer de app-origin. Geen secret en geen verzendbevoegdheid; een wrapperuitbreiding is nodig om dit op een native host door te geven. |
| `RELEASE_SHA` | Publieke release-identiteit, runtime | Volledige 40-teken broncommit; verplicht ingevuld en gecontroleerd door het stagingreleasepad, optioneel bij lokale demo. |
| `RELEASE_ID` | Publieke release-identiteit, runtime | Staging: GitHub run-ID en pogingnummer; optioneel lokaal. |
| `CONFIG_VERSION` | Publieke release-identiteit, runtime | Staging: gemapt vanuit `DG_CONFIG_VERSION`; gecontroleerd in health en bevat geen secretwaarden. |

De **geïnstalleerde stagingwrapper heeft 21 toegestane runtimevelden en laat geen van bovenstaande mailnamen door**: `MAIL_ENVIRONMENT`, `MAIL_MODE`, `MAIL_ALLOWED_RECIPIENTS`, `SEND_EMAIL_HOOK_SECRET`, `MAIL_ORGANIZATION_EMAIL`, `MAIL_FROM` en `MAIL_ASSET_BASE_URL` staan daarbuiten. Stagingmail is dus niet ingericht en blijft uit. Een `.env.example`-regel of GitHub-secret op zichzelf verandert dit niet.

De nog niet geïnstalleerde productiescaffold heeft 25 velden: dezelfde 21 plus uitsluitend de vier gatewaynamen `MAIL_ENVIRONMENT`, `MAIL_MODE`, `MAIL_ALLOWED_RECIPIENTS` en `SEND_EMAIL_HOOK_SECRET`. Zij levert nog geen v70-organisatiecontact of assetmetadata. Voor echte v70-mail moeten het organisatieadres, gateway-/afzender-/reconciliatiecontract, ontvangerbeleid en de volledige workflow-/preflight-/wrapperconfiguratie eerst samen worden beoordeeld en ingericht. `MAIL_FROM` en `MAIL_ASSET_BASE_URL` blijven optioneel; marketing blijft door de huidige native adapter geblokkeerd. Voorbeeld- of previewgegevens zijn geen aansluitbewijs.

`RESEND_API_KEY` en `PLAYER_MAIL_FROM` zijn namen van de historische directe mailintegratie in `server/player-auth.js`. De nieuwe Auth-adapter gebruikt Supabase voor OTP; deze waarden sluiten de vaste DG-mailgateway/outbox niet aan. Daarom staan ze niet als te activeren mailconfiguratie in het nieuwe voorbeeld. Hetzelfde geldt voor `OPENAI_REALTIME_MODEL`, dat alleen door de historische call-handler wordt gelezen: dit is geen vervanging voor het GPT-Live-contract.

`VLAMPIE_ADMIN_EMAIL` is een historische interne compatibiliteitsnaam. De nieuwe identiteit komt uit een servergeverifieerde sessie en `app_user_roles`; een browserheader, e-mailadres of `user_metadata` verleent nooit een rol.

De native adapter ondersteunt centrale versleutelde OpenAI- en LiveKit-instellingen vanuit de regie, ook wanneer de bestaande serveromgeving al credentials bevat. Alleen de geverifieerde regierol mag de afzonderlijke native instellingen opslaan. Opgeslagen sleutelwaarden worden niet teruggestuurd; opslaan en een werkelijke providertest zijn aparte acties. [Bediening, revisiecontrole, uitschakelen en terugkeer naar serverwaarden](REGIE-SLEUTELS.md).

Zonder bewuste native regie-instelling blijven de omgevingswaarden de bron. Een bewust opgeslagen native instelling heeft voorrang; een expliciete uitschakeling blijft uit totdat de regie een andere keuze bevestigt. Een onvolledige LiveKit-set of onleesbare versleutelde instelling wordt geweigerd en leent geen oude credentials. Een project- of keywijziging vereist het bijbehorende secret. De eigen masterkey en private opslag blijven noodzakelijk; tijdens actieve of onzeker opgeruimde providerresources is rotatie geblokkeerd.

## GitHub environments en secrets buiten de app

Gebruik voor staging en productie aparte waarden voor `APP_URL`, Supabase URL/key/projectref, databaseverbinding, encryptiesleutel, Storagebucket en eventuele providerconfiguratie. De encryptiesleutel kan alleen worden gedeeld wanneer dat voor een expliciete datamigratie nodig is; documenteer die keuze.

De huidige CI heeft geen projectsecrets nodig. De stagingworkflows gebruiken uitsluitend environment `staging` en de bevestigde Milo-runner. Het releasepad, de rootwrapper en de beperkte deploybevoegdheid zijn geïnstalleerd. De blijvende deploymentconfiguratie is geplaatst: `DG_DEPLOY_WRAPPER_SHA256`, `DG_STAGING_PORT`, `DG_CONFIG_VERSION`, `MIGRATION_DATABASE_URL` en `BACKUP_ENCRYPTION_KEY`. De tijdelijke `RESTORE_TEST_DATABASE_URL` en scratchomgeving zijn na de geslaagde volledige herstelproef verwijderd; richt die voor een volgende muterende migratie opnieuw afzonderlijk in. Migratie-, backup- en herstelcredentials gaan niet naar de app-runtime. De [tijdelijke beheertoegang en bootstrapduplicaten zijn opgeruimd](../verification/staging-access-cleanup.json); beide nieuwe sleutel-logins zijn geweigerd. Actieve runtime-envs, versleutelde backups en het private sleutelherstelpad zijn behouden. De publieke eindcontrole is na intrekking opnieuw geslaagd.

Voor het nog in te richten GitHub-environment `production` zijn daarnaast de beschermde releasevariabelen **`DG_PRODUCTION_PROFILE_SHA256`** en **`DG_STAGING_ACCEPTANCE_JSON`** nodig, naast de eigen `DG_DEPLOY_WRAPPER_SHA256`. De eerste bindt het beoordeelde openbare productieprofiel; de tweede registreert de daadwerkelijk uitgevoerde praktische stagingacceptatie. Geen van beide is een appsecret of runtimevariabele. Vul het acceptatierecord niet automatisch met CI-, mock- of demoresultaten. Exacte velden en inrichting: [productieprocedure](PRODUCTIE-DEPLOY.md#github-variabelen-en-secrets). Het bestaande productionenvironment is nog leeg; deze namen zijn nog geen geplaatste configuratie.

Het [databaseapply-/herstelbewijs](../verification/staging-database-apply.json), [offhost-escrowbewijs](../verification/staging-backup-escrow.json), de [onafhankelijke runtimecontrole](../verification/staging-runtime-verification.json) en [werkelijke backendacceptatie](../verification/staging-backend-acceptance.json) zijn vastgelegd. `DATABASE_URL` bevat de beperkte app-login en `MIGRATION_DATABASE_URL` de afzonderlijke beheerlogin; beide zijn via de directe IPv6-projectverbinding met geautoriseerde TLS en hostnaamcontrole geverifieerd. De routewisseling gebruikte dezelfde wachtwoorden en wijzigde geen rolrechten. Iedere volgende schemamigratie blijft vooraf een nieuwe beoordeelde backup-/herstelgate vereisen. Zie [STAGING-DEPLOY.md](STAGING-DEPLOY.md). Mailgateway-/webhooksigning hoort bij het nog te leveren gatewaycontract.

Op dit moment leest de browser geen `NEXT_PUBLIC_*`-waarden. Worden die later toegevoegd, bouw iedere omgeving met haar eigen publieke configuratie: Next.js bakt deze tijdens `next build` in. Een gelijke bron-SHA bewijst geen byte-identieke staging-/productiebuild.

## Supabase-inrichting en aansluitbewijs

1. Gebruik het bestaande stagingproject `lfsdgxcpdyghidzkzzvn`; maak dit niet opnieuw aan. Bevestig eigenaar/teamtoegang en de aanwezige Auth-/Storageinstellingen. Bepaal productie later afzonderlijk. Houd de nieuwe API-keytypen aan: publishable voor gewone clients, secret alleen server-side. Zie [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).
2. Controleer het migratieplan en een herstelbare backup vóór toepassing. De speldata gaan via geautoriseerde serverroutes; RLS en ingetrokken browsergrants zijn aanvullende bescherming. Ken regie doelbewust toe in `app_user_roles`.
3. Zet de juiste Site URL en `/auth/callback` in de Supabase redirectallowlist. Activeer e-mail-OTP en gebruik een OTP-template met de Supabase-tokenvariabele. [Passwordless email sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless) beschrijft dit contract.
4. Stel de Google webclient in met de callback uit het eigen Supabase-dashboard; zet het client-secret in de Supabase-providerinstellingen. De appcallback en provider-callback zijn verschillende adressen. Zie [Sign in with Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).
5. Richt de gekozen Auth-mailroute en de bestaande DG-gateway in. Voor nieuwe gratis projecten is aanpassing van Auth-mailtemplates niet beschikbaar met de standaard SMTP-dienst; regel eigen SMTP of een passend projectplan wanneer nodig. Zie [wijziging van 3 juni 2026](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).
6. Doorloop OTP en Google met echte testaccounts; controleer sessieherstel, uitloggen, ongeautoriseerde toegang, meerdere kindprofielen en een echte postbus. Leg provideracceptatie, aflevering en ontvangst afzonderlijk vast.

De Supabase-changelog en bovenstaande primaire documentatie zijn op 4 november 2026 geraadpleegd. De aangekondigde [TLS-wijziging vanaf 10 november](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) is relevant voor oude testapparaten; test de werkelijk gebruikte browsers tijdens acceptatie. De stagingdatabase, volledige herstelproef en private Storagebewerkingen zijn inmiddels werkelijk gecontroleerd. Auth-, mail-, provider- en showacceptatie blijven afzonderlijke open controles.

## Nog nodig om het geheel af te ronden

- De echte productiegegevens en afzonderlijke backendconfiguratie; toestemming voor productie is al gegeven op 6 november 2026.
- Bevoegde regiegebruiker(s) met echte Supabase user-UUID en bruikbare testaccounts.
- Bevestigde Supabase Site URL/redirects, werkende OTP-mailtemplate/bezorging en Google-providerconfiguratie, gevolgd door echte accounttests.
- Het vaste DG-mailgateway-/outbox-/webhookcontract, afzendergegevens en benodigde mailproviderbevoegdheden.
- Een besluit over bestaande D1/R2-data; zo nodig een gecontroleerde export, eigenaarsmapping en de oorspronkelijke encryptiesleutel via een veilig kanaal.
- YouTube-/OBS-uitzendgegevens, testapparaten en echte OpenAI-/LiveKit-/bel-/audiorepetitie. Aanwezige keys bewijzen deze werking niet.
- De hierboven genoemde echte account-/mail-/provider-/showacceptatie uitvoeren. Publieke appcontrole, database-, herstel-, runtime- en backendbewijs zijn al vastgelegd; dit vervangt de echte gebruikers- en uitzendproef niet.
