# Installatie, opslag en koppelingen

> **Bij deze ZIP-export:** lees eerst `PAKKET-LEESMIJ.md` in de pakketroot. Het accountgebonden hostingmanifest is weggelaten. Kopieer voor uitsluitend een lokale build in `bron/` eerst `.openai/hosting.example.json` naar `.openai/hosting.json`. Dit generieke bestand is een niet-deploybare builddummy; richt productie volgens de doelrepo in. De pakketroot en `handoff/` bevatten de leidende documenten en geldige screenshotlinks.


Dit document beschrijft de meegeleverde bronversie. Het is geen verklaring dat externe diensten in een andere omgeving al zijn aangesloten. Een groene lokale test met nagebootste providers bewijst geen werkende echte uitzending.

## 1. Bron en uitvoering

De huidige hoofdapp gebruikt React 19.3.1, Motion 14.4.0, esbuild en een Worker-server met D1/SQLite en R2. `package-lock.json` bepaalt de reproduceerbare installatie. Lit en Three staan ook in de dependencies voor bestaande onderdelen; dat maakt de actieve app niet tot een Lit-shell. Historische stukken onderaan `README.md` zijn geen migratiehandleiding voor de huidige app.

De waargenomen ontwikkelomgeving gebruikt Node **v24.22.1** en npm **11.9.0**. Gebruik voor de controles van deze bron een recente Node 24-versie met `node:sqlite`, Web Crypto, `fetch` en de overige gebruikte Node-API’s. Een oudere Node-versie kan al vóór een functionele test falen. Respecteer bij integratie eerst de Node-/lockfilekeuzes van de doelrepo; leg een noodzakelijke compatibiliteitsaanpassing expliciet vast. Upgrade niet automatisch het framework of alle dependencies.

```sh
npm ci
npm run build
npm run dev
```

De ontwikkelserver luistert standaard op poort 4173; `PORT` kan die poort wijzigen. Open `/spelen?demo=1` voor de expliciete gezinsdemo. De lokale `npm run dev`-server is een UI-preview: niet nagebootste `/api/*`-routes geven bewust een duidelijke 503. Deze opdracht maakt geen echte D1/R2, logins, betaling, e-mail, YouTube-uitzending of LiveKit/OpenAI-verbinding aan.

De build maakt `dist/client`, `dist/server` en `dist/.openai`. `scripts/build-worker.mjs` bundelt de React-app, controleert de Worker-export en kopieert gedeelde servermodellen naar browserbestanden. Bewerk de canonieke bestanden in `server/`; een losse wijziging in een gegenereerde `public/`-kopie is niet duurzaam.

De Sites-preview/hosting voert de echte Worker-routes en bindings uit. Gebruik voor een extern doelproject zijn bestaande staging- en deployworkflow. Het projectspecifieke `.openai/hosting.json` is bewust geen onderdeel van de export; `SOURCE-INFO.json` beschrijft de Sites-herkomst. Het is geen universele VPS-deployconfiguratie.

## 2. Beveiligde runtimegegevens

De volgende namen staan daadwerkelijk in `.env.example`. Alleen lege voorbeelden horen in een overdrachtsarchief.

| Naam | Functie / grens |
|---|---|
| `OPENAI_API_KEY` | Eén centrale serversleutel; een veilig opgeslagen koppeling kan de omgevingsfallback vervangen. Nooit naar de browser sturen. |
| `OPENAI_TEXT_MODEL` | Tekstreacties; huidige fallback `gpt-4.1-mini`. |
| `OPENAI_SPEECH_MODEL` | Legacy/fallback-spraak, huidige fallback `gpt-4o-mini-tts`; dit is niet de modelkeuze voor de voorbereid ingestelde GPT Live-personages. |
| `VLAMPIE_ADMIN_EMAIL` | Bepaalt de organisatierol bij de geverifieerde platformidentiteit. De naam blijft voor compatibiliteit bestaan. |
| `VLAMPIE_SETTINGS_KEY` | 64 hextekens / 32 bytes voor versleutelde instellingen; ook gebruikt in de aanmeldroute. Bewaar stabiel en beveiligd. |
| `RESEND_API_KEY` | Optionele serverfallback voor mail; ook via de beveiligde instellingen te bewaren. |
| `PLAYER_MAIL_FROM` | Afzender op een geverifieerd maildomein; ook via instellingen. |

Roteer `VLAMPIE_SETTINGS_KEY` niet zonder een expliciet herencryptie-/herstelplan. Een nieuwe willekeurige waarde kan bestaande versleutelde instellingen onleesbaar maken. `.env.example` wordt niet automatisch een veilig ingerichte productieomgeving en de UI-preview laadt geen echte providerconfiguratie stilzwijgend.

De huidige voorbereide personages en live gespreksroute gebruiken de centrale `LIVE_MODEL` uit `server/gpt-live.js` (`gpt-live-1`). Controleer de bron en de toegang van het echte API-project bij een repetitie. Een oude notitie over een ander Realtime-model is geen bewijs dat dat model actief is. De oudere compatibiliteitsroute in `server/calls.js` is evenmin het nieuwe LiveKit-callcontract.

| Binding | Inhoud |
|---|---|
| `DB` | D1/SQLite: shows, gezinsgegevens, kaarten, resultaten, orders binnen showdocumenten, instellingen per karakter, callstate en revisies. |
| `SETTINGS` | R2: beveiligde instellingen en gebruikte object-/mediabestanden. |
| `ASSETS` | Runtimebinding voor de gebouwde statische appbestanden. |

Deze namen komen uit de huidige hostingconfiguratie en server. Geef bij een adapter naar een ander platform dezelfde contracten een passende implementatie; doe niet alsof D1 automatisch Supabase wordt.

## 3. Identiteit en gegevens behouden

De huidige hosting injecteert geverifieerde `oai-authenticated-user-id`- en `oai-authenticated-user-email`-headers. De spelerroute heeft daarnaast eigen mailcode-/sessieafhandeling in `server/player-auth.js`. Een externe server mag zulke headers niet rechtstreeks uit een browser overnemen: leid de identiteit af uit zijn eigen geverifieerde sessie, verwijder inkomende spoofbare kopieën en geef alleen intern een vertrouwde identiteit door.

Bewaar bestaande account-ID’s, kind-ID’s, show-ID’s, kaart-ID’s, order-ID’s, award-ID’s en revisies. Organisatietoegang en accountbezit moeten server-side worden gecontroleerd. Een React-tab verbergen is geen toegangscontrole.

`db/schema.ts` en `drizzle/0000…0008_character_settings.sql` documenteren de huidige SQLite-opslag. Controleer welke migraties de doeldatabase al heeft. Geen productiedatabase opnieuw initialiseren, geen tabellen leegmaken en geen IDs opnieuw genereren. De nieuwe orders gebruiken bestaande showopslag; zij vereisen geen tweede kaartenbron. Voor Next/Supabase: maak eerst een expliciet adapter-/migratieplan, een herstelbaar gegevenssnapshot en contracttests, voordat bestaande opslag wordt vervangen.

## 4. Centrale OpenAI-koppeling en twaalf karakterinstellingen

Stel de centrale sleutel uitsluitend server-side in via de beveiligde koppeling of de bestaande omgevingsfallback. Gebruik daarna de centrale testfunctie; vermeld afzonderlijk of die een echte providerrespons heeft gekregen. Er staat geen werkende sleutel in dit pakket.

Elke presentator heeft een eigen instellingenpagina met stem, persoonlijkheid, spreekstijl en gedrag. De karakterroute weigert een karaktergebonden `key`/`apiKey`/`OPENAI_API_KEY`: twaalf instellingen betekenen geen twaalf sleutels of sessies. Gewone YouTube-kijkers starten geen AI-gesprek. Stemreacties en de actieve presentator moeten de actuele, opgeslagen karakterinstellingen gebruiken.

Wijziging 6 gebruikt diezelfde centrale koppeling. Buiten een gesprek bereidt de server een begrensde karakterreactie voor; de regie controleert die en kiest expliciet **Laat reactie uitspreken** voordat hij wordt ingepland. In een live gesprek wordt uitsluitend de bestaande presentatorsessie bijgewerkt. De regieaanwijzing is geen gesproken tekstveld en mag niet in openbare studio-/spelersnapshots belanden.

## 5. LiveKit Cloud apart aansluiten

Voor een echte repetitie heeft LiveKit zijn **eigen** verbindingsgegevens nodig. De centrale OpenAI-sleutel vervangt die niet. De bron leest de LiveKit-configuratie uit het versleutelde settingobject **`livekit-cloud`** met `url`, `apiKey`, `apiSecret` en `connectionTest`. Er zijn in deze versie geen kant-en-klare `LIVEKIT_URL`, `LIVEKIT_API_KEY` of `LIVEKIT_API_SECRET`-omgevingsvariabelen geïmplementeerd.

1. Maak in je eigen LiveKit Cloud-account een project aan voor de Bingoshow.
2. Neem de project-URL over, zoals `wss://jouw-project.livekit.cloud`, plus een bij dat project horende API-key en API-secret. Gebruik geen geheimen van een ander project.
3. Open **Koppeling & stream → LiveKit Cloud** en vul de drie gegevens in. Een leeg secretveld bij een latere wijziging behoudt het opgeslagen secret.
4. Kies de echte verbindingstest. De server probeert een geautoriseerde RoomService-aanvraag. Alleen succesvol opslaan is geen verbindingstest.
5. Test daarna met twee echte browsers/apparaten: regie/output en één gezin. Controleer browsermicrofoon, HTTPS, toestemming en de geluidsroute. Een geslaagde RoomService-test bewijst nog niet dat microfoons, echo-onderdrukking en retourgeluid kloppen.
6. Houd de spelersapp geopend om oproepen te ontvangen. Alleen beschikbare/geselecteerde gezinnen gebruiken preflight/backstage/live-rooms; verbind de overige kijkers niet met LiveKit.

Tokens worden kortlevend en per rol/room uitgegeven. Backstage en live zijn verschillende geluidsruimtes. De output en AI mogen niet aan de backstagekamer deelnemen. Start geen egress/opname of tweede AI-sessie als vervanging voor die scheiding. Regie kan privé spreken, live volgen, dempen en beëindigen; test de daadwerkelijke audiorechten.

Bij het voorbereiden wordt de centrale trekkingsblokkade gezet. Afwijzen, geen antwoord, refresh, microfoonproblemen of netwerkverlies heffen die niet stilzwijgend op. Terugkeer naar YouTube moet eerst worden gecontroleerd en daarna hervat de regie bewust. Een geopend meldvenster blijft geldig.

## 6. YouTube, output en retour

YouTube verzorgt de openbare uitzending. Vul bij de show/stream de werkelijke video-/streaminstelling in en houd de output/encoderrouting van het doelproject in stand. Deze bron opent niet zelfstandig een betaalde of publieke uitzending.

Voor een beller moet het laatste getrokken nummer eerst gehoord en verwerkt kunnen zijn. Gebruik betrouwbare afspeelgegevens waar aanwezig, aangevuld met een bevestiging van deelnemer/regie; geen vaste wachtduur als enig bewijs. De app dempt YouTube tijdens het rechtstreekse gesprek en herstelt daarna de normale kijkstand. Controleer dat de deelnemer zichzelf niet vertraagd terughoort en dat Milo plus live deelnemer samen in de echte uitzendmix zitten.

Gebruik `docs/live-calls-contract.md` als aanvullende routebeschrijving, maar neem modelnamen en endpoints uit de actuele bron. Oude repetitienotities kunnen op de vroegere providerroute slaan.

## 7. Mail, handmatige betaallink en uitgifte

Configureer mail via de beveiligde centrale mailinstellingen of `RESEND_API_KEY`/`PLAYER_MAIL_FROM`. Het afzenderdomein moet door de mailprovider zijn geverifieerd. Gebruik voor een echte mailtest een expliciet gekozen testadres; de demostand verstuurt niets.

Open bestellingen per toekomstige conceptshow en stel prijs/maximum in. De organisatie plaatst een persoonlijke **HTTPS-betaallink** op een ontvangen aanvraag. De mail is een betalingsverzoek via die externe link, geen interne betalingstransactie. **Ik heb betaald** meldt alleen een vermoeden aan de organisatie. Pas na controle van de echte ontvangst keurt de organisatie goed en ontstaan de unieke bladen.

Test betaalmail en gereedmail afzonderlijk. Leg provideracceptatie, fout en onzeker resultaat eerlijk vast. Bij een onzekere levering niet blind opnieuw sturen. Kleur en inktarm/A5/A4 moeten dezelfde uitgegeven kaartidentiteit behouden. De demo-download is herkenbaar als voorbeeld en is geen bewijs van een echte uitgegeven bestelling.

## 8. Nodig voor een echte repetitie

| Onderdeel | Nog door de eigenaar te leveren/controleren |
|---|---|
| Hosting/auth | Werkende stagingomgeving, DB/R2-equivalent, vertrouwde organisatie- en gezinsidentiteit. |
| OpenAI | Eén eigen centrale sleutel met toegang/tegoed voor de modellen die de actuele bron gebruikt. |
| LiveKit | Eigen Cloud-project-URL, key/secret en geslaagde RoomService- én apparaatrepetitie. |
| YouTube/output | Echt videoadres, encoder/uitzendmix, gemeten vertraging en retourcontrole. |
| Mail | Eigen providerconfiguratie, geverifieerde afzender en gecontroleerd testadres. |
| Betaling | Eigen betaallink en een medewerker die de werkelijke ontvangst controleert. |
| Show | Gecontroleerde kindnamen/uitspraakhulp, script, kaartuitgifte, prijzen en operator voor de volledige route. |

De installatie is pas een geslaagde echte repetitie wanneer deze onderdelen met echte accounts/apparaten samen zijn doorlopen. Screenshots en geautomatiseerde providerfixtures zijn uitvoerbare voorbeelden, geen vervanging daarvoor.
