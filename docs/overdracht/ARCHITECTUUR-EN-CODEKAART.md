# Architectuur en codekaart — Milo & Friends BingoShow

**Bronmoment:** commit `08e1a652a78586d2e791179eead388acad8a3266`, gepubliceerde Sites-versie 63, 4 november 2026. Dit document beschrijft de aanwezige broncode. Het is geen verklaring dat externe providers met echte accounts of echte uitzendingen zijn beproefd.

## 1. De bestaande applicatie

Dit is momenteel een React-app met een Cloudflare Worker-backend. Het project is **geen Next.js-, Vite-, Supabase- of zelfstandige Node-webserverapp**. Een migratie naar die voorzieningen is aanvullend werk; de bestaande vormgeving en spelcontracten vormen daarbij de te behouden referentie.

| Onderdeel | Aanwezige implementatie |
|---|---|
| Interface | React/React DOM 19.3.1, eigen CSS, Motion 14.4.0, lucide-react |
| Build | esbuild, ES-modules, browserdoel ES2022 |
| Studio | Canvas2D/2,5D-compositor, PNG/WebP-decors en geanimeerde beeldrigs; Three.js 0.180.0 blijft voor aanwezige modules behouden |
| Oudere modules | Onder meer Lit 3.3.3 en klassieke `public/`-modules; niet klakkeloos verwijderen |
| Backend | `server/index.js`, Worker `fetch(request, env)` |
| Gegevens | Cloudflare D1-binding `DB`, SQLite-schema en revisiegestuurde documenten |
| Bestanden/geheimen | R2-binding `SETTINGS`; `ASSETS.fetch` voor statische buildbestanden |
| PDF/QR | pdf-lib, qrcode-generator; QR-scannen met jsQR |
| Audio/media | Web Audio, LiveKit client 2.23.0, OpenAI-koppeling via server |
| Tests | Node-scripts, node:test/assert, `node:sqlite`, linkedom, gemockte browser/media/providerinterfaces |

De onderzochte runtime rapporteerde Node `v24.22.1`. Het pakket heeft geen `engines`-pin. Gebruik voor reproduceerbare uitvoering een passende Node 24-omgeving; de tests gebruiken onder meer `node:sqlite` en scripts gebruiken `import.meta.dirname`.

## 2. Entrypoints en toegangsgrenzen

`frontend/main.jsx` normaliseert de URL en laadt de familie-app alleen wanneer het pad met `/spelen` begint. Anders start de regie-app. `server/site-entry.js` bepaalt ook op de server de canonieke ingangen.

| Route | Betekenis |
|---|---|
| `/` en `/regie` | Regie/voorbereiding; `/regie` wordt de hoofdroute met `#/live` |
| `/uitzending` | Schoon 16:9-uitzendvenster; regie blijft de eigenaar van officiële spelacties |
| `/spelen` | Echte familie-app: account, kinderen, boekjes, nummers, chat en deelname |
| `/spelen?demo=1` | Gevulde, browserlokale demofamilie met gesimuleerde uitzending |
| `/spelen?spel=...` | Exacte showkeuze; een deeplink mag niet naar een andere show springen |
| `/spelen?boek=...&spel=...` | Gescand boekje voor een specifieke show |
| `/klassiek`, oude HTML-entrances, oude `view=show/overlay` | Compatibiliteit; normalisatie naar de nieuwe werkplek/uitzending |

De Sites-doelgroep is een buitenste toegangslaag. Een `?demo=1`-link of spelerslink verandert de Site-sharing niet. De gepubliceerde versie is eigenaarprivé gebleven.

De regie-identiteit komt in de huidige hosting uit `oai-authenticated-user-id` en `oai-authenticated-user-email`, plus `VLAMPIE_ADMIN_EMAIL`. Die headers zijn alleen betrouwbaar wanneer de hosting ze heeft gezet. Een toekomstige VPS/proxy mag willekeurige door een browser aangeleverde versies hiervan nooit als authenticatie accepteren. E-mailspelerssessies worden bewust geen regie-/hostaccounts.

## 3. Belangrijkste codegebieden

| Gebied | Begin bij |
|---|---|
| Hoofdapp en navigatie | `frontend/main.jsx`, `frontend/App.jsx`, `frontend/components.jsx` |
| Centrale show-engine | `frontend/engine.js`, `frontend/show-runtime.js`, `frontend/show-cue-runtime.js`, `frontend/startup-recovery.js` |
| Regiekamer | `frontend/RegieWorkspace.jsx`, `frontend/RegiePanels.jsx`, `frontend/regie-layout.js`, regie-CSS |
| PROGRAM/PREVIEW/studio | `frontend/StudioShotPreview.jsx`, `public/mf-studio.js`, `public/mf-camera.js`, `public/milo-puppet.js`, `public/mf-broadcast-set.js` |
| Draaiboek en presentatie | `server/plan-model.js`, `server/presentation-model.js`, `server/show-cues.js`, `server/presentation.js`, `frontend/ShowCuePanel.jsx` |
| Showelementen/beslisspellen | `frontend/ShowElements.jsx`, `frontend/MinigameThumbnail.jsx`, `public/milo-magic-games.js`, `public/milo-ribbon-game.js`, `public/milo-minigame-art.js`, `public/milo-minigame-plan.js`, `docs/milo-beslisspellen.md` |
| Deelnemers, boekjes en administratie | `frontend/Administration.jsx`, `frontend/administration.css`, `server/bingo.js` |
| Personages | `server/characters.js`, `server/character-settings.js`, `frontend/CharacterProfile.jsx` |
| Merken | `server/show-brands.js`, `frontend/family-brand.js`, `public/brand-ui.js` |
| Familie-app | `frontend/FamilyApp.jsx`, `frontend/FamilyExtras.jsx`, `frontend/player-api.js` |
| Familie-vormgeving | `frontend/family.css`, `family-show.css`, `family-responsive.css`, `family-extras.css`, `family-live-call.css` |
| Familie-demo | `frontend/family-demo.js`, `frontend/FamilyDemoStage.jsx`, `frontend/family-demo-stage.css` |
| Chat | `public/live-chat.js`, `public/live-chat.css`, `server/chat.js`, `server/chat-store.js`, `frontend/AudienceWorkspace.jsx` |
| YouTube in de app | `frontend/YouTubeBroadcast.jsx`, `frontend/youtube-player.js` |
| LiveKit/gesprekken | `server/live-calls.js`, `server/live-call-model.js`, `server/livekit.js`, `frontend/LiveCallDesk.jsx`, `frontend/live-call-runtime.js`, `frontend/player-live-call.js`, `frontend/livekit-media.js` |
| Audio naar uitzending | `frontend/live-call-output.js`, `frontend/live-call-audio.js`, `frontend/live-call-api.js` |
| Uitvoerrelay | `server/output.js`, `public/output-bridge.js` en de engine |
| AI/stem/voorbereide clips | `server/openai.js`, `server/gpt-live.js`, `server/voice-cache.js` |
| PDF | `server/bingo-pdf.js`, `server/milo-print-layout.js`, `server/milo-print-assets.js`, `server/milo-print-scenery.js` |

Niet elke genoemde klassieke module is de standaardrenderer. De imports vanuit de nieuwe React-engine en de actuele merkkeuze bepalen welk pad actief is. De gedeelde modelbestanden in `server/` zijn leidend; de build kopieert ze naar `public/`.

## 4. Spelserver en gegevensmodel

`server/bingo-model.js` bevat de zuivere spelregels: unieke kaarten, rondes, patronen, reserve/commit van ballen, meldvensters, claims en resultaten. `server/bingo.js` is de geautoriseerde API-laag. `server/bingo-store.js` bewaart de documenten.

Belangrijke echte API's onder `/api/bingo` zijn `/me`, `/profiles`, `/games`, `/families` en `/games/:uuid/...`. Mutaties omvatten onder meer `generate`, `register`, `begin`, `claim`, `start`, `activate`, `reserve`, `commit`, `pause`, `extend`, `admit`, `finish-result`, `raffle`, `delivery` en `finish`. PDF-routes leveren opgeslagen boekjes/batches. Lees voor de volledige actieset de router; dit overzicht is geen vervangende API-specificatie.

De game- en familiedocumenten worden met vergelijk-en-wissel-revisies opgeslagen. Een gecombineerde game/familie-operatie gebruikt een D1-batch met autorisatie- en revisievoorwaarden. Idempotente request-ID's voorkomen dubbele acties. Chat heeft eigen tabellen/cursor en herschrijft het game-JSON niet voor elk bericht. Behoud deze eigenschappen in een andere database.

Schema: `db/schema.ts`, `drizzle.config.ts`, migraties `drizzle/0000_...sql` t/m `0008_character_settings.sql` en `drizzle/meta/`.

| Tabellen | Inhoud |
|---|---|
| `show_workspaces`, `presentation_workspaces` | Eigenaargebonden voorbereiding/presentatie |
| `bingo_games`, `bingo_families`, `bingo_codes` | Shows, gezinnen, vaste kaartidentiteiten/uitgifte |
| `bingo_chat_rooms`, `bingo_chat_members`, `bingo_chat_messages`, `bingo_chat_events`, `bingo_chat_operations` | Chat, moderatie, cursor en idempotentie |
| `studio_outputs`, `studio_calls` | Uitvoerlease, één gesprek per host, herstelbare status |
| `player_accounts`, `player_sessions`, `player_challenges`, `player_auth_limits` | E-mailaccounts, gehashte sessies, OTP en limieten |
| `show_character_settings` | Eigen stem-/personage-instellingen per eigenaar |

D1/SQLite-specifieke SQL gebruikt onder meer `prepare().bind().first()/all()/run()`, `DB.batch`, `json_extract`, `json_each`, `RETURNING` en revisieguards. Dit is geen direct uitvoerbare Postgres/Supabase-migratie. Een port moet transacties, JSON/JSONB-operaties, autorisatie en concurrency opnieuw bewijzen.

## 5. Authenticatie en configuratie

De familie-aanmelding is een eigen e-mail-OTP-route, geen Supabase Auth. `server/player-auth.js` verstuurt via Resend. Een code is tien minuten geldig; een challenge heeft een aparte verificatiecookie, pogingenlimiet en HMAC-hash. Het sessietoken wordt gehasht in D1 bewaard; de cookie is `HttpOnly`, `Secure`, `SameSite=Lax`. Same-origin controles en actieheaders blijven een aanvullende grens, geen vervanging voor identiteit.

| Binding/variabele | Functie in de huidige code |
|---|---|
| `DB` | D1 met bovengenoemde schema/migraties |
| `SETTINGS` | R2 voor privé-instellingen, stemcache, PDF-cache en geüploade prijsafbeeldingen |
| `ASSETS` | Statische bestanden uit `dist/client` |
| `VLAMPIE_ADMIN_EMAIL` | Vergelijking met vertrouwde platform-e-mail voor regierechten |
| `VLAMPIE_SETTINGS_KEY` | 64 hextekens; AES-GCM-hoofdsleutel voor privé-instellingen en HMAC-basis voor OTP |
| `OPENAI_API_KEY` | Serverfallback voor centrale OpenAI-sleutel, wanneer geen opgeslagen sleutelobject bestaat |
| `OPENAI_SPEECH_MODEL`, `OPENAI_TEXT_MODEL` | Optionele modeloverrides voor respectievelijk gewone TTS en tekst/reacties |
| `RESEND_API_KEY`, `PLAYER_MAIL_FROM` | Serverfallback voor opgeslagen e-mailinstellingen |
| `OPENAI_REALTIME_MODEL` | Komt nog voor in het behouden oudere `/api/calls`-pad; niet de huidige GPT-Live-modelconstante |

**Alleen namen, geen werkende geheime waarden horen in de overdracht.** Een `OPENAI_API_KEY` alleen is in deze code onvoldoende: `readSecret()` vereist ook beschikbare `SETTINGS` en een geldige `VLAMPIE_SETTINGS_KEY`. Bewaar een bestaande encryptiesleutel zorgvuldig; blind vervangen maakt opgeslagen instellingen onleesbaar en kan OTP-verificatie beïnvloeden.

Privé R2-objecten bevatten o.a. `openai-key`, `livekit-cloud`, `player-mail` en `call-connection` in versleutelde enveloppen. LiveKit Cloud wordt via de eigen instellingenpagina geconfigureerd met `wss://...livekit.cloud`, API key en API secret. De huidige `server/livekit.js` heeft hiervoor geen `LIVEKIT_*`-envfallback. Namen voor zulke variabelen in een toekomstig stagingplan zijn dus een nieuwe mapping, geen bestaande aansluiting.

Het oudere `call-connection`-instellingenpad kan Cloudflare TURN of direct WebRTC gebruiken. Dat is niet hetzelfde als de gekozen nieuwe LiveKit Cloud-route. Verwar het niet met de globale OpenAI-sleutel.

## 6. Gesprekken, privacy en audio

De echte call-route is `preparing → ringing → backstage → staged → live → returning → returned → completed`. Er is maximaal één actief gesprek per host. Voorbereiden installeert een blijvende `drawHold` op de spelserver. Weigeren, time-out, netwerkverlies, herladen en stoppen geven de trekking niet automatisch vrij. Alleen gecontroleerde terugkeer, gesloten resources en bewuste `resume-draw` voltooien de vrijgave. Een bestaand bingomeldvenster blijft leidend.

Voor live gaan bevriest de server het gekozen kind, de gecorrigeerde roepnaam/uitspraakhulp, de reden en bevestigde feiten. De oudernaam mag niet als kindnaam worden gebruikt. Persoonlijke details of prijzen ontstaan niet uit AI-vrije tekst.

Backstage en live gebruiken aparte LiveKit-ruimtes. De output heeft geen backstage-token; een overgang sluit de private ruimte eerst af. Track-allowlists begrenzen de tegenpartijen. De programmamixer accepteert alleen de geselecteerde live deelnemer plus de presentator. AI-input bevat alleen de deelnemer; de retour naar de deelnemer alleen de presentator (mix-minus). De regie heeft privébediening en subscribe-only live monitoring. Gewone kijkers gebruiken YouTube en openen geen eigen LiveKit-/AI-sessie.

`frontend/live-call-audio.js` kan een programmastream met canvasvideo en gemixte audio maken. OBS/YouTube blijft een externe uitzending: de Site publiceert niet op zichzelf een YouTube-livestream. Leg in een repetitie het specifieke uitzendvenster vast en voorkom dat algemene desktopaudio de private regiemicrofoon alsnog naar OBS stuurt.

## 7. Providercontract en echte repetitie

Er bestaat een concreet verschil tussen oudere documentatie en huidige code:

- `docs/live-calls-contract.md` en `docs/live-calls-rehearsal.md` noemen nog een Realtime-model als standaard.
- `server/gpt-live.js` declareert in deze commit `LIVE_MODEL='gpt-live-1'`, gebruikt `/v1/live/sessions`, WebRTC-SDP en een WebSocket-attach/hangup-pad.
- `server/live-calls.js` maakt nieuwe gesprekken met `speechEngine='gpt-live'` en antwoordt met die modelnaam. De publieke routenaam bevat nog `realtime`.
- `server/openai.js` bevat ook stemgeneratie via `/audio/voices` met een prompt en voorbereide GPT-Live-clips. Sommige eigen stemnamen verschillen van de oudere `REALTIME_VOICES`-compatibiliteitslijst.

Bij deze overdracht zijn de modelnaam `gpt-live-1`, de route `/v1/live/sessions` en het globale WebRTC-verzoek-/antwoordmodel ook met actuele officiële OpenAI-documentatie vergeleken; zie de afzonderlijke `OPENAI-DOCS-CHECK.md` met bronlinks. Het gaat dus om een verschil met oudere projectdocumentatie, niet om een als onbestaand aangemerkte API. **Modeltoegang, de gekozen stem-ID's, accountrechten, werkelijke audio en betrouwbare start/stop met de eigen account blijven onbeproefd totdat een echte, expliciet gestarte repetitie ze bevestigt.** Een lokale mocktest of alleen een modeltoegangstest bewijst geen werkend audio-einde-tot-eindepad. Werk de oude documentatie bij; verander niet stilzwijgend de persona of spreekstem als fallback.

## 8. Studio, personages, PDF en merkbehoud

Studio 1 is de gekozen Sterrenplein-compositie: 2,5D-diepte in een 2D-uitzending. De camera's zijn uitsneden/transformaties van deze compositie; geen volledig vrij navigeerbare 3D-set. `public/mf-studio.js` monteert de compositor. Milo gebruikt een eigen puppet; andere vrienden een beeldrig. Mondbeweging via audioniveau/tekst is geen bewezen foneem-lipsync.

De twaalf Milo-vrienden zijn Milo Magico, Stella Sterrenstof, Otto Octa, Pip Popcorn, Lola Lumière, Bella Bellissimo, Professor Piko, Bruno Bonbon, Nino Nonsens, Benny Bubbels, Kapitein Kora en Coco Calypso. Vlampie heeft een apart profiel en houdt zijn bestaande Showtime- en Sinterklaasdecors. Het globale OpenAI-secret hoort niet in een karakterprofiel.

De modulaire regie gebruikt één engine. Pop-outs zijn portals, geen tweede eigenaar/engine/LiveKit-verbinding. Het hoofdvenster moet open blijven. PREVIEW beïnvloedt PROGRAM pas na TAKE. Nummertrekkingen en winnaars blijven serverbesluiten; animaties veranderen geen uitslag. De nieuwe vijf beslisspellen en hun continuïteitsgedrag staan in `docs/milo-beslisspellen.md`.

De PDF-template is `milo-friends-sterrenmagie-a5-v4` in de onderzochte code. De server houdt vaste kaartnummers, codes en QR-identiteit aan. Het groepslogo, het gekleurde ontwerp en de inktarme variant zijn meegeleverde assets. Vier 5×5-kaarten beslaan drie rondes en de finale. A4 drukt twee bestaande A5-boekjes per liggend vel af; dit genereert geen nieuwe kaartidentiteit.

## 9. Zelf bouwen en lokaal kijken

Vanuit de bronmap:

```sh
npm ci
npm run build
node scripts/check-site-entry.mjs --built
npm run dev
```

`npm ci` gebruikt de meegeleverde lockfile. Het script `build` kopieert benodigde Three.js-bestanden en bouwt de browser-app plus Worker. `npm run dev` luistert standaard op poort 4173 en `0.0.0.0`; zet zo nodig `PORT` voor een andere poort.

De gewone lokale server is **alleen een UI-preview**. Hij start geen echte Worker, D1, R2, provider- of mailbackend. Normale `/api/...`-verzoeken antwoorden daarom met een expliciete 503. `/spelen?demo=1` werkt wel met de nieuwe lokale clientadapter; `/spelen?voorbeeld=1&brand=milo` is de oudere ontwikkelfixture van `scripts/family-preview-data.mjs`. De oefenstudio in de regie simuleert eigen show- en belstatussen. Geen van deze demo's bewijst providerwerking.

`npm run build` produceert:

- `dist/client/`: statische pagina's/assets en gehashte React-chunks onder `app/`;
- `dist/server/index.js`: gebundelde Worker met `default.fetch`;
- `dist/server/milo-page.js`: gegenereerde canonieke HTML als JS-export;
- `dist/.openai/hosting.json`: gekopieerde hostingidentiteit/configuratie;
- `.sites-runtime/build-meta.json`: lokale buildanalyse (geen bronbestand).

De vier HTML-ingangen worden bij bouwen vanuit `public/milo-studio.html` gelijkgetrokken. Wijzig die canonieke ingang en behoud een consistente cache-release. `dist` en `node_modules` zijn reproduceerbare builduitvoer, geen vervanging voor broncode.

De Sites-pluginhelpers (`build-site.mjs`, `site-workflow.mjs`, `package-site.mjs`) horen bij de ChatGPT-omgeving, niet bij dit npm-project. Een externe Codex hoeft deze absolute plugincachepaden niet na te bouwen. De concrete `npm run build` is overdraagbaar; de hosting-/identiteitslaag moet voor de gekozen runtime bewust worden ingericht. Er is momenteel geen `npm start`, Dockerfile of GitHub-deployworkflow in dit project die zelfstandig een complete VPS-productieomgeving levert.

De grafische printbasis opnieuw renderen vereist aanvullend `@napi-rs/canvas` (niet in de huidige package.json) en voor preview-JPEG's Poppler. De reeds gebouwde PDF/afbeeldingsassets zitten in de overdracht; voor een normale appbuild hoef je deze authoringstap niet opnieuw uit te voeren.

## 10. Controle en grenzen van het bewijs

Begin met de bij de wijziging passende checks. Voor belangrijke contracten zijn o.a. beschikbaar:

```sh
node scripts/check-family-demo.mjs
node scripts/check-family-extras.mjs
node scripts/check-family-brand.mjs
node scripts/check-player-auth.mjs
node scripts/check-bingo.mjs
node scripts/check-live-chat.mjs
node scripts/check-chat-client.mjs
node scripts/check-regie-workspace.mjs
node scripts/check-regie-panels.mjs
node scripts/check-live-calls.mjs
node scripts/check-call-draw-hold.mjs
node scripts/check-live-call-audio.mjs
node scripts/check-player-live-call.mjs
node scripts/check-youtube-player.mjs
node scripts/check-milo-print.mjs
node scripts/check-gpt-live.mjs
node scripts/check-site-entry.mjs --built
```

Deze scripts testen modellen, identiteit, DOM-interacties, SQL-transacties, opbouw en gemockte audiopaden/providers. Alleen een daadwerkelijk uitgevoerde check mag als geslaagd worden gerapporteerd. Sommige rendererchecks vragen extra authoring-/rendergereedschap; controleer hun imports en voer ze niet blind als ongedocumenteerde verplichte buildstap in.

Een echte ingebruiknamerepetitie blijft nodig: eigenaar + ouder met twee kinderen, twee apparaten, HTTPS/microfoon, geldige OpenAI- en LiveKit-instellingen, betrouwbare YouTube-embedding/vertraging, OBS-programmamix, onhoorbaar backstagegesprek, gecorrigeerde gastnaam, handmatig/automatisch/AI geblokkeerde trekking, weigering/time-out/netwerkverlies, expliciete YouTube-terugkeer en daarna bewuste vrijgave. Zie ook `docs/live-calls-rehearsal.md`, met de documentatieafstemming uit §7.
