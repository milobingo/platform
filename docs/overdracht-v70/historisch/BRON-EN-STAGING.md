# Bron, installatie en staging

| Veld | Waarde |
|---|---|
| Sites-versie | 70 |
| Commit | `f81d0c1c60cbe1422d43ce46d896af6cd4d2939c` |
| Sites-referentie | [Vlampie Studio / Milo & Friends](https://vlampie-studio.dgwebserv.chatgpt.site) |
| Techniek | React 19, Motion, esbuild, Worker ESM, D1/SQLite, R2 |
| Uitvoer | Node 24, npm, pakketversies uit `package-lock.json` |

De **volledige ZIP** bevat `bron-v70/`: de getrackte Git-snapshot van bovenstaande commit inclusief bronassets, voorbeeldboekjes, tests, historische overdrachtsdocumentatie en de Sites-hostingmanifestatie als herkomstreferentie. Het archief bevat geen Git-geschiedenis, geïnstalleerde modules, echte omgevingsbestanden, credentials of database-export. De **compacte ZIP** bevat het volledige werkplan, audit, offline mailvoorbeelden en geselecteerde referentiebeelden; haal bij gebruik daarvan de bron van exact deze commit op via de bevoegde Sites-bronrepo, of gebruik de volledige ZIP. `docs/BRON-SHA256.txt` kan de uitgepakte bronbestanden onafhankelijk verifiëren. Controleer een bestaande repo met `git rev-parse HEAD` en behoud nieuwere doelrepo-aanpassingen.

Maak een onafhankelijke lokale kopie om de Sites-bron te bekijken:

```sh
cd bron-v70
npm ci
npm run build
npm run dev
```

- De preview luistert standaard op poort 4173. `/spelen?demo=1` opent het gevulde familievoorbeeld. Regie staat op `/#/live`, mail op `/#/mail`, uitzendvenster op `/uitzending`. De devserver geeft buiten de demodata bewust 503 voor echte koppelingen.
- In de bron komt de Worker uit `server/index.js`. `scripts/build-worker.mjs` genereert ook gedeelde browserbestanden. Pas daarom de canonieke modellen in `server/` aan in plaats van alleen een gegenereerde kopie.
- De meegeleverde `.openai/hosting.json` hoort bij de oorspronkelijke Site. Gebruik hem niet om een andere Site of de VPS-doelrepo uit te rollen. Volg de bestaande stagingworkflow van de doelrepo en verifieer daar op welke auth, opslag en hostname de app echt draait.
- LiveKit, OpenAI en Resend zijn drie verschillende koppelingen. Bewaar alle sleutels uitsluitend in de beveiligde serverconfiguratie. De bestaande `.env.example` bevat alleen namen en niet-geheime defaults. Lees `bron-v70/handoff/INSTALLATIE-EN-KOPPELINGEN.md` voor details; bij conflict zijn de actuele canonieke code en dit werkpakket leidend.
- Neem geen authenticatie uit door de browser ingestuurde proxyheaders over. Gebruik de geverifieerde doelrepo-sessie en autoriseer elk show-, merk-, account- en profielgebonden verzoek opnieuw.
- Voor regressies: begin met `scripts/check-bingo.mjs`, `scripts/check-bingo-orders.mjs`, `scripts/check-live-calls.mjs`, `scripts/check-family-demo.mjs`, `scripts/check-family-extras.mjs`, `scripts/check-mail-templates.mjs`, `scripts/check-mail-hooks.mjs`, `scripts/check-mail-service.mjs` en `scripts/check-mail-ui.mjs`. Kijk per script naar het contract en eventuele verplichte argumenten. Gebruik providerstubs; voor externe verkeerblokkade bij de audit was `docs/test-zonder-providers.mjs` de Node-preload.

De v70-nulmeting: build en canonieke routecontrole geslaagd; 94 van 101 controlescripts groen na correcte uitvoermap voor de rendercheck. Zeven rode scripts zijn beschreven in audit-PDF p. 9. Controleer openstaande tekortkomingen opnieuw op de doelrepo. Stop bij productieconfiguratie, ongeautoriseerde data of een onbekende nevenwerking; pas de stagingopstelling aan vóór verdere tests.

