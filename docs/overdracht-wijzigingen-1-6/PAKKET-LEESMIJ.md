# Eerst lezen bij deze ZIP-export

Open `index.html` in de pakketroot voor de offline galerij en lees daar `START-HIER.md` en `CODEX-PROMPT.md`. De documenten in de pakketroot en `handoff/` zijn leidend voor de screenshotlinks en deze exportaanvulling. De originele `bron/handoff/`-documenten komen ongewijzigd uit de broncommit; hun relatieve screenshotlinks zijn niet de navigatie voor deze pakketindeling.

## Lokale builddummy eerst aanmaken

Het oorspronkelijke accountgebonden `.openai/hosting.json` is bewust niet geëxporteerd. De bestaande build kopieert dat bestand onvoorwaardelijk. Daarom bevat deze export uitsluitend een aanvullend generiek `.openai/hosting.example.json` met `project_id: local-preview-only-do-not-deploy` en de logische bindingsnamen `SETTINGS` en `DB`.

Voer vanuit de pakketroot uit:

```sh
cd bron
cp .openai/hosting.example.json .openai/hosting.json
npm ci
npm run build
```

Deze expliciete kopieerstap is nodig vóór de eerste lokale build. De dummy bevat geen account, projecttoegang, fysieke Cloudflare-resource-ID, sleutel of database. **Nooit met deze dummy deployen.** De namen `SETTINGS` en `DB` documenteren alleen de logische serverbindings; de export maakt geen echte R2/D1 aan.

Gebruik bij integratie de echte hosting/auth/opslag- en deploymentconventies van de doelrepo. Vervang niet blind een al werkend manifest, framework of lockbestand. De oorspronkelijke repository en zijn hostingmanifest zijn voor deze export niet gewijzigd.

De lokale UI-preview en providerfixtures bewijzen geen echte backend-, mail-, betaal-, AI- of audioverbinding. Zie de installatie- en acceptatiedocumenten. De extra exportbestanden en documentaanvullingen staan expliciet in `SOURCE-INFO.json`.
