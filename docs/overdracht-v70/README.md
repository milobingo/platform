# Herkomst en interpretatie van overdracht v70

Deze map bewaart de ontvangen opdracht als historisch referentiemateriaal en koppelt haar aan de exacte Sites-bron. Dit document vervangt het integratie- of vrijgaverapport van de doelrepo niet.

## Exacte bron

De broncheckout `/tmp/milobingo-v70-source/.sites-checkout` heeft HEAD `f81d0c1c60cbe1422d43ce46d896af6cd4d2939c` (Sites-versie 70). Bij het maken van de inventaris waren de getrackte werkbestanden schoon. De inventaris gebruikt onafhankelijk daarvan uitsluitend de oorspronkelijke Git-blobs: 568 bestanden, samen 268.720.724 bytes. Daarmee kan een build die later gedeelde `public/`-bestanden genereert de geregistreerde bronhashes niet veranderen.

[De broninventaris](../../verification/v70/source-inventory.json) bevat per bestand de Git-blob-ID, bestandsmodus, lengte en SHA-256. Een afzonderlijk bestand is bijvoorbeeld opnieuw te controleren met:

```sh
git -C /tmp/milobingo-v70-source/.sites-checkout show \
  f81d0c1c60cbe1422d43ce46d896af6cd4d2939c:server/bingo-model.js | sha256sum
```

Dit is bronherkomst, geen bewijs dat Sites of een productieomgeving dezelfde code draait. Er is voor deze inventaris geen hosting-, account-, provider- of databasewijziging uitgevoerd.

## Ontvangen tekst en werkpakketten

De volledige ontvangen tekst staat ongewijzigd in [de historische tekstkopie](historisch/Milo-Friends-v70-Codex-Overdracht-Zonder-ZIP.txt): 1.397 regels, SHA-256 `541a2bbde556f507fd223438fa8549b40a0758739c85bbb7628621052401715f`. Alle mailtemplates, voorbeelden, shortcodes en overige secties blijven daarin behouden.

De volgende leesbare uitsneden bevatten exact de oorspronkelijke tekstregels; hun grenzen en hashes staan eveneens in de inventaris:

- [Startprompt](STARTPROMPT.md): oorspronkelijke regels 9–40.
- [Spel, live regie en familieapp](work/01-SPEL-LIVE-EN-FAMILIE.md): regels 44–159.
- [Bestellingen en mail](work/02-BESTELLINGEN-EN-MAIL.md): regels 163–245.
- [Repetitie en vrijgave](work/03-REPETITIE-EN-VRIJGAVE.md): regels 249–281.
- [Historische bron- en staginginstructie](historisch/BRON-EN-STAGING.md): regels 285–314.
- [Historische mailstudio-instructie](historisch/MAILSTUDIO-V70.md): regels 318–378.

De historische tekst bevat opdrachten en oorspronkelijke installatieaanwijzingen. De actuele gebruikersopdracht bepaalt welke werkzaamheden zijn geautoriseerd. Een historische publicatieopdracht, providerverwijzing of hostingmanifest is geen zelfstandige toestemming om infrastructuur aan te maken, berichten te verzenden, productiegegevens te wijzigen of een andere omgeving uit te rollen.

## Bronarchitectuur en doelarchitectuur

De Sites-bron gebruikt React/esbuild, een Worker-entrypoint in `server/index.js`, D1/SQLite en R2. De bestaande doelrepo gebruikt Next/Node, geverifieerde Supabase-sessies, serverrollen en de eigen SQLite/PostgreSQL- en private-opslagadapters. Deze bestaande doelarchitectuur blijft leidend. Bronpaden worden op gedrag vergeleken; er wordt geen tweede losse Sites-demo als vervanging aangelegd.

Canonieke gedeelde modellen staan in `server/`; gegenereerde browserkopieën in `public/` worden via de bestaande build bijgewerkt. De historische `.openai/hosting.json` identificeert alleen de oorspronkelijke Site. Oude proxyheaders verlenen in de doelrepo geen identiteit of hostrechten. Oude directe Resend-/Worker-contracten worden evenmin automatisch nieuwe provider- of deploymentcontracten; de bestaande DG-mailgateway, geverifieerde identiteit en serverconfiguratie blijven behouden.

Nieuwere, reeds bewezen correcties in de doelrepo gaan niet verloren door een bronbestand over te kopiëren. Voor implementatiebewijs van de serverkern en opslagmarge bestaat daarnaast [de afzonderlijke technische verificatie](../V70-SERVER-GAME-VERIFICATION.md); een volledige status per werkpakket en de actuele go/no-go horen bij het integratierapport van de hoofdtaak.

## Zeven oorspronkelijke rode scripts

[De analyse van de zeven rode scripts](ZEVEN-RODE-SCRIPTS.md) onderscheidt oorspronkelijke bronrepro, oorzaak, huidige porttegenhanger en bewijsgrens. [Machineleesbare classificatie](../../verification/v70/baseline-zeven-rood.json), oorspronkelijke logs en latere portlogs blijven afzonderlijk bewaard. Een geslaagde aangepaste porttest maakt de oorspronkelijke nulmeting niet achteraf groen.
