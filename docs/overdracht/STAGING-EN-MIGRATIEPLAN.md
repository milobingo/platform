# Van Sites-bron naar DG-staging

Dit is een uitvoeringsplan voor Codex, geen reeds uitgevoerde migratie. De ZIP bevat een werkende bronmomentopname van Sites en een lokale UI-demo. Er zit nog geen aangesloten Supabase-project, GitHub Actions-workflow, `dg-site-deploy`-configuratie of zelfstandige Next.js-server voor dit project in.

## 1. Twee technische situaties

| Gebied | Huidige bron | Doel volgens de DG-masterprompt |
|---|---|---|
| App | React 19, eigen CSS, esbuild | Bestaande Next.js-basis; goedgekeurde componenten en vormgeving overnemen |
| Backend | Cloudflare Worker `fetch(request, env)` | Geautoriseerde serverroutes/services in de doelruntime |
| Database | D1/SQLite, revisies en JSON-documenten | Supabase/PostgreSQL, migraties en gelijkwaardige atomaire mutaties |
| Identiteit | Trusted Sites-headers voor beheer, eigen OTP-spelerssessies | Servergeverifieerde Supabase Auth, OTP/Google en expliciete beheerrechten |
| Bestanden | R2-binding en statische assets | Doelopslag expliciet bepalen; assets, versleutelde instellingen en caches scheiden |
| Mail | Huidige Resend-integratie | Vaste gesigneerde Supabase-mailgateway en duurzame outbox |
| Live audio | LiveKit Cloud + GPT-Live via server | Dezelfde scheiding met doelruntime-adapters en echte repetitie |
| Release | Sites-publicatie | Development-VPS → GitHub → native stagingrelease → dezelfde bron-SHA naar productie |

De overzetting is geen frontend-herontwerp. De goedgekeurde familie-app en studio blijven de visuele referentie. Een generiek Next.js-startscherm of nieuwe componentstijl is geen gelijkwaardige oplevering.

## 2. Inventarisatie in de doelomgeving

Codex leest eerst aanwezige AGENTS.md, workflows, deployscripts, package-/lockfiles en het bestaande runbook. Vul `PROJECTPROFIEL.json` vanuit bewijs aan. Stel repository, hosts, domeinen, site-ID’s, Linux-gebruikers, runnerlabels, paden, poorten, wrapperversie, Supabase-projectrefs en mailgateway vast. Het pakket levert daarvoor geen gegokte waarden.

Maak een baseline van de huidige bron en de doelrepository. Bij een bestaande app eerst verschillen en gegevensbehoud vastleggen; geen werkende repository vervangen door alleen deze uitgepakte map. Pin de gekozen Node-/package-manager- en dependencyversies. De bron gebruikt npm; de doelrepository volgt haar afgesproken lockfilebeleid.

## 3. Portvolgorde

1. **Interface-basis.** Neem de routes, familiecomponenten, eigen CSS en assets over in Next.js. Browser-only code (Canvas, AudioContext, BroadcastChannel, sessionStorage, window) blijft in clientgrenzen. Maak serverimports en toegangspaden expliciet; voer geen Worker-handlers ongewijzigd als Node-server uit.
2. **Identiteit en rollen.** Vervang Sites-platformidentiteit door de doel-authadapter. Supabase Auth beheert OTP/Google; behoud aparte ouder-/kindprofielen en boekje-eigendom. Test dat een ouderaccount geen regierol kan verkrijgen met een clientveld of e-mailadres. Vertrouw nooit op extern ingestuurde `oai-authenticated-*`-headers.
3. **Database.** Vertaal `drizzle/` en `server/*-store.js` bewust naar PostgreSQL. Houd kaarten, codes/tokens, revisies, request-ID’s, claims en resultaten consistent. Definieer transactiegrenzen voor game + familie, reserve/commit van nummers en installatie/vrijgave van drawHold. Maak relevante ownership- en rolpolicies en behoud server-only schrijfpaden voor spelautoriteit.
4. **Instellingen/opslag.** Scheid publieke assets, private instellingen, encryptiesleutel en voice/PDF-caches. Kies een gecontroleerde import van bestaande instellingen wanneer echte R2-data beschikbaar komt. Het pakket bevat die runtime-export en encryptiegeheimen niet.
5. **Spel- en regie-API.** Port de handlers en behoud hun fout-, autorisatie-, revisie- en retrycontract. Sluit showplanner, personage-instellingen, outputlease en chat aan. Behoud een duurzame cursor en idempotentie bij chat-/claimmutaties.
6. **Media en provideradapters.** Worker-WebSockets en `Response.webSocket` vragen een doelruntime-implementatie. Houd OpenAI-sleutels en sessieconfiguratie server-side. Zet LiveKit URL/key/secret afzonderlijk, met beperkte rol-/kamertokens. Sluit privé en live audio werkelijk gescheiden aan op de uitzendmix.
7. **Print.** Behoud de bestaande kaartdata en tokens. De meegeleverde templates maken een normale build mogelijk zonder alle printart opnieuw te genereren. Bij wijzigingen: documenteer de aanvullende Canvas-/Poppler-authoringdependencies en verifieer opnieuw.
8. **Demo.** Houd `?demo=1` expliciet, lokaal en herkenbaar. Echte API’s mogen nooit een mockantwoord als succes teruggeven. Behoud aparte opslagkeys en een reset die echte accountgegevens ongemoeid laat.
9. **Acceptatie.** Voer de regressies en echte browser-/providerrepetitie uit. Werk status en bewijs per omgeving bij.

## 4. Configuratie

De huidige bron bevat een lege `.env.example`; de exacte huidige servernamen staan in de codekaart. De centrale sleutel kan in de bron ook versleuteld via de instellingen worden bewaard. LiveKit-configuratie staat in een apart instellingencontract, niet in een OpenAI-karakterprofiel.

Voor de doelomgeving maakt Codex een namenlijst van build- en runtimeconfiguratie. Supabase publieke URL/publishable key mogen alleen in de daarvoor bedoelde frontendconfiguratie. Geprivilegieerde database-, OpenAI-, LiveKit-, mailgateway-, cookie- en encryptiesleutels blijven server-only. Stel geen fictieve waarden in om checks groen te maken.

Wanneer `NEXT_PUBLIC` wordt gebruikt, hoort de publieke configuratie bij de build van die omgeving. Dezelfde bron-SHA op staging en productie betekent daarom niet dat de gebouwde bestanden byte-identiek zijn. Registreer ook toolchain, configuratieversie en release-ID.

## 5. Databehoud

Deze overdracht bevat schema en test-/demodata, geen productie-export. Als bestaande D1/R2-gegevens moeten worden overgenomen, maak een expliciete export/import met eigenaarschap, ID-mapping, aantallen, kaartnummers/tokens, revisies, bytechecks en terugvalpad. Doe een proefimport op staging. Zet geen SQLite-bestand rechtstreeks als PostgreSQL-schema in en kopieer geen oude OTP-/sessiegeheimen zonder passend migratiebeleid.

Supabase-tabellen in blootgestelde schema’s krijgen toegangsrechten én toepasselijke RLS/ownership. Browserprofielen mogen geen officiële trekking, winnende kaart of beheerrol aanpassen. Laat transactionele functies de centrale spelinvarianten bewaken. Richt mail-outbox/retries en afgeleide caches zo in dat een retry geen dubbele claim, prijs, mail of trekking oplevert.

## 6. Releasepad

Volg de meegeleverde actuele DG-masterprompt. Development-VPS is de werkomgeving; GitHub is leidend. Groene CI op de exacte volledige SHA gaat vóór muterende stagingreleasestappen. De runner controleert haar identiteit/checkout, configuratie en hostcapaciteit en roept de aanwezige `dg-site-deploy`-wrapper aan. Die voert de native release-build en activatie uit. Caddy blijft de reverse proxy. Dit plan introduceert geen Docker-imagepipeline.

Gebruik gescheiden staging/production-environments. Controleer backup/herstel vóór databasemigraties en behoud compatibiliteit als alleen backendwijzigingen slagen. Laat productie dezelfde geaccepteerde bron-SHA bouwen met productieconfiguratie, uitsluitend binnen de afgesproken releasescope. Leg runtime-SHA, migraties, actieve release en terugvalpad vast; een app-rollback herstelt externe providerconfiguratie of database niet vanzelf.

## 7. Bronnen en actualiteit

De DG-werkwijze hierboven komt uit het meegeleverde, op 4 november 2026 gelezen masterdocument. Voor de toekomstige Supabase-implementatie zijn de actuele primaire documentatie-ingangen gecontroleerd:

- https://supabase.com/changelog
- https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs
- https://supabase.com/docs/guides/database/postgres/row-level-security

Deze bronnen beschrijven SSR-clients/sessies en ownership via RLS. Ze zijn geen bewijs van een al ingerichte Milo-database of werkende Auth-configuratie. Codex moet bij uitvoering de dan geldende API’s, changelog en concrete doelconfiguratie controleren. De Markdown-varianten waren via de gebruikte zoektool niet uitleesbaar; de HTML-documentatie is daarna wel geopend.
