# Tijdelijke vaste herstelrelay voor v70 staging

Deze vaste route zonder SSH is op **9 november 2026 daadwerkelijk gebruikt** voor de afzonderlijke volledige v70-herstelproef. De [upgrade- en herstelrun 42627576733](https://github.com/milobingo/platform/actions/runs/42627576733) is geslaagd voor bron `f32a854b408ed750001f2f768fc0f454f102c4f9`. Het [herstelbewijs](../verification/v70/staging-restore.json) bevestigt de echte PostgreSQL 17.11-restore met gelijke brondata en beveiligingsfingerprints, inclusief vijf extensies, vóór de additieve bronmigratie. Het [upgraderesultaat](../verification/v70/staging-upgrade.json) bevestigt daarna het volledige 23-tabellencontract. De Tailscale-policy is niet gewijzigd. De eerdere SSH-sleutels uit [de historische scratchprocedure](STAGING-RESTORE-SCRATCH.md) zijn ingetrokken en zijn voor deze route niet opnieuw gebruikt.

De oorspronkelijke read-only voorbereiding bevestigde worker-IP `100.79.0.26`, stagingpeer `dg-nxttrack-01` / `100.111.66.17` en de kernelroute via `tailscale0`. Daarna heeft de [werkelijke inventarisatie](../verification/v70/staging-inventory.json) via de vaste relays een geauthenticeerde, lege PostgreSQL 17.11-scratch aangetoond. De geslaagde volledige restore bevestigt het end-to-end databasepad voor deze uitvoering; een netmap of luisterende poort alleen was daarvoor onvoldoende.

Het [opruimbewijs van 13:43:38 UTC](../verification/v70/staging-restore-cleanup.json) bevestigt dat de workerrelay is gesloten en workerpoorten **54388 en 54389 gesloten** zijn. De runnerworkflow heeft haar exact overeenkomende relayproces gesignaleerd en de opruimstap is geslaagd. **De runnerpoort 55433 is niet onafhankelijk nagecontroleerd.** Beide eigen scratch-/relaycontainers, het eigen scratchnetwerk, de private scratchcredentials en de tijdelijke GitHub-hersteltestsecret zijn verwijderd. Andere projecten zijn niet aangeraakt; de versleutelde backup en escrow zijn behouden.

Onderstaande route en controles blijven het beoordeelde ontwerp voor een volgende uitvoering; daarvoor zijn opnieuw een eigen lege scratch, tijdelijke credentials en actuele preflight nodig.

## Vaste route

| Proces | Exacte bind | Enige geaccepteerde peer | Enige bestemming |
|---|---|---|---|
| `runner` als `run-mil-stg` | `127.0.0.1:55433` | `127.0.0.1` | `100.79.0.26:54388`, met lokale bron `100.111.66.17` |
| `worker` als normale workergebruiker | `100.79.0.26:54388` | `100.111.66.17` | `127.0.0.1:54389` |

De workerpoort54389 moet een uitsluitend loopbackgebonden relay naar de nieuwe eigen, geïsoleerde `milo_restore_test_*`-database zijn. Gebruik geen bestaande container, volume, poort of database van een ander project. Houd de scratch zelf zonder externe route en met dezelfde bronmajor, extensies, preloads, eigenaren en overige voorwaarden uit de bestaande scratchprocedure.

Het Node-script heeft alleen de CLI-rollen `runner` en `worker`; geen vrije host-, poort-, credential-, shell- of proxymogelijkheden. Het weigert root. De runnerrol vereist bovendien de exacte host, gebruikersnaam en UID1001, en beide rollen vereisen hun werkelijke lokale Tailscale-adres. De bind is exclusief; een bezette poort geeft een fout zonder de bestaande listener aan te raken. Het script kopieert uitsluitend TCP-bytes met backpressure en houdt maximaal16 verbindingen open. Connecttimeout is10seconden, idle-timeout10minuten en totale levensduur maximaal30minuten. Afsluiten of verlopen sluit ook actieve sockets.

## Netwerkbeleid en authenticatie

Beoordeel de volledige Tailscale-policy. Een passende beperkte grant is alleen staging-IP → worker-IP, `tcp:54388`. Een extra smalle allowregel beperkt een reeds aanwezige bredere grant niet. Maak geen wildcardtoegang, publieke listener, Funnel, Serve, subnetrouter, exitnode of SSH-uitzondering voor deze proef. De worker controleert iedere daadwerkelijke bronpeer opnieuw vóór zij een scratchverbinding opent. Andere peers worden zonder outbound verbinding geweigerd. Tailscale beschermt de netwerkverbinding; de tijdelijke sterke PostgreSQL-SCRAM-credential blijft onafhankelijk verplicht. Een IP-filter geeft geen onderscheid tussen Unix-gebruikers op dezelfde staginghost.

De relay ontvangt of logt geen databasecredentials. `RESTORE_TEST_DATABASE_URL` blijft uitsluitend een deploysecret met host `127.0.0.1`, poort55433 en een unieke `milo_restore_test_*`-database. Plaats een nieuw willekeurig wachtwoord en de volledige URL via een private0600file/stdin in het stagingsecret, bijvoorbeeld `gh secret set RESTORE_TEST_DATABASE_URL --repo milobingo/platform --env staging < "$scratch_url_file"`. Nooit de waarde afdrukken, als opdrachtargument doorgeven of als artifact publiceren. Geef deze tijdelijke credential niet aan de app, build of relayprocessen.

Het bestaande databasecontract hoeft voor deze route niet te worden verruimd: bron-Supabase blijft direct met de echte CA en `verify-full`; alleen de afzonderlijke scratchverbinding gebruikt de lokale relay. De bestaande native `pg_dump` en `pg_restore` blijven de werkelijke restore plus data-, beveiligings- en extensievergelijkingen uitvoeren. Verwijder geen owners, grants, objecten of controles om een groene proef te krijgen.

## Procesbeheer binnen de beoordeelde workflow

Start de workerrol pas nadat de eigen scratch, broncompatibiliteit, capaciteit, exclusieve poorten en policy zijn bevestigd:

```sh
node scripts/deploy/staging-restore-relay.mjs worker
```

De runnerrol hoort in dezelfde begrensde job en shellstap als de restore/upgrade. De job behoudt de bestaande exacte main/CI-gate, stagingrunneridentiteit, concurrencygroep en credentialscheiding. Een beheerpatroon voor die stap is:

```sh
set -euo pipefail
umask 077
relay_directory=$(mktemp -d "$RUNNER_TEMP/milo-restore-relay-XXXXXX")
relay_pid=
cleanup_relay() {
  if test -n "$relay_pid"; then
    kill "$relay_pid" 2>/dev/null || true
    wait "$relay_pid" 2>/dev/null || true
  fi
  rm -r -- "$relay_directory"
}
trap cleanup_relay EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node_path=$(command -v node)
env -i PATH=/usr/bin:/bin "$node_path" \
  scripts/deploy/staging-restore-relay.mjs runner \
  > "$relay_directory/status.jsonl" 2> "$relay_directory/error.jsonl" &
relay_pid=$!
# Wacht begrensd op de exacte niet-geheime ready-JSON én kill -0 "$relay_pid".
# Daarna: de bestaande geauthenticeerde scratchpreflight en gecontroleerde
# upgrade met independently reviewed manifests en werkelijke restore proof.
# Geen SQL of secretwaarden in de relaylog plaatsen.
```

De statusregel is uitsluitend `{"role":"runner","event":"ready","listeners":1}` (of `worker`). Een succesvolle bind bewijst nog geen end-to-end database. Laat de geauthenticeerde preflight vervolgens de verwachte nieuwe databasenaam, PostgreSQL-major, superuser voor restore en nul niet-systeemobjecten aantonen. Een onbereikbare route of afwijkende identiteit blokkeert de upgrade. Gebruik daarnaast een job-timeout van maximaal30minuten. Het script heeft een eigen30minutenstop als de shelltrap bij annulering niet meer kan draaien; stel geen automatische herstart in.

## Opruiming en bewijs

Na succes én na fouten: beëindig beide exacte eigen processen/PID's, verifieer dat runner127.0.0.1:55433 en worker100.79.0.26:54388 gesloten zijn, en verwijder de tijdelijke `RESTORE_TEST_DATABASE_URL`, private scratchcredentialfiles en uitsluitend de nieuwe eigen scratch/relaycontainer en netwerk. Ruim de scratch pas op nadat eventueel benodigde foutvergelijking is afgerond. Bewaar de versleutelde backup, sidecar, restoreproof en de bestaande encryptiesleutel volgens de bestaande procedure. Verwijder geen andere listeners of projectcontainers. Verwijder ook een eventuele uitsluitend voor deze proef toegevoegde policygrant na afloop.

Leg als niet-geheim bewijs vast: exacte source-SHA, vaste endpointidentiteiten, peer/policybeoordeling, versie/extensiematch, lege scratchpreflight, geslaagde volledige restorevergelijking, upgrade-resultaat en poort-/procesopruiming. De uitvoering van 9 november is vastgelegd in het [herstelbewijs](../verification/v70/staging-restore.json) en [opruimbewijs](../verification/v70/staging-restore-cleanup.json), met de hierboven genoemde beperking van de runnerpoortcontrole. De eerdere codevoorbereiding bevatte daarnaast geïsoleerde regressies in `tests/check-staging-restore-relay.mjs`: binaire roundtrip inclusief half-close, peerweigering vóór outbound, bezette poort, root/verkeerde runner en hardexpiry met actieve sockets.

Primaire contracten: [Tailscale-policy: bronnen, bestemmingen en acceptregels](https://tailscale.com/docs/reference/syntax/policy-file) en [Node TCP-server en sockets](https://nodejs.org/api/net.html). De effectieve policy is bij deze uitvoering niet aangepast. De geauthenticeerde preflight en volledige restore bewijzen de gebruikte verbinding; ze vervangen geen onafhankelijke controle van alle effectieve policygrants.
