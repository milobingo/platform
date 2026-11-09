# v70 · live bellen en audioherstel

Bronvergelijking: Sites v70 `f81d0c1c60cbe1422d43ce46d896af6cd4d2939c`, lokale doelbranch `feat/v70-audit-20261109`, uitgangspunt `d8306ed134c494f84e6c80d57a3fdff6ace6d4d4`. `live-calls.js`, `live-call-model.js`, `player-live-call.js` en `youtube-player.js` waren gelijk aan v70. De nieuwere lokale voice-cancel- en whispercorrecties in de uitzendbridge zijn behouden.

| Punt | Lokale correctie en bewijs | Nog te repeteren |
|---|---|---|
| L01 | Spelhold en call-document worden samen geschreven met twee revisiecontroles in één databasebatch. Het checkpoint volgt de beslissende spelrevisie. Een eerdere bal wordt meegenomen; een mislukte tweede write draait beide wijzigingen terug. De gedeelde capaciteit-/historiereserve blijft gelden. Uitnodiging, tokens en AI-start vereisen de bijbehorende hold. | Dezelfde races op het staging-opslagpad en met twee regieapparaten. |
| L02 | Eén startreservering van 30 seconden, duurzaam correlation-ID en credentialfingerprint. De correlation-ID gaat mee als `X-Client-Request-Id`; dit is geen idempotentiegarantie. Een late respons na stoppen geeft geen SDP terug en wordt afgesloten. Timeout zonder bekende sessie-ID blijft expliciet onzeker en blokkeert hervatten. Een willekeurige andere sessie afsluiten bewijst geen opruiming. Bekende sessies kunnen opnieuw worden afgesloten; sleutelwissel tijdens gesprek/opruiming wordt geweigerd. | Provideronderzoek bij verloren sessie-ID, echte timeout/hangup en bewaartermijn-/sluitingsgaranties. Zonder bewijs blijft de hold staan; veilige handmatige afhandeling is noodzakelijk. |
| L03 | Per browserdocument een eigen oproepclient. De tweede tab opent geen media en kan het gesprek niet annuleren; ouderlijke intrekking blijft afzonderlijk beschikbaar. YouTube wordt gedempt of fysiek verwijderd vóór direct geluid. Afspelen op 120 s bij een meetbare rand van 240 s wordt geweigerd. Terugkeer vereist een recente seek naar het meetbare livepunt óf een actuele servercue die de uitzendroute volledig heeft bevestigd en die de ouder daarna hoort. Regie bevestigt vervolgens expliciet. | DVR/livepunt op iOS/Android, twee fysieke apparaten, toestemming intrekken na sluiting en herkenbare cue op de echte YouTube-uitzending. |
| L04 | Uitzendbron gebruikt instantie, generatie en volgnummer. Een nieuwe generatie wordt met verwachte generatie geclaimd; oude berichten leveren 409. Een bestaand spel vereist actuele regiecontrole. Lokale relay verstuurt alleen serverbevestigde packets. Uitzend-ACK volgt de echte Canvas-rendercallback; ontbrekend beeld krijgt een wachtstand. Backstage, gast, AI-invoer en mix-minus blijven gescheiden. Gastmute, AI-mute en stop hebben afzonderlijke paden. Ongepubliceerde uitslagen ontbreken uit AI-context. | OBS-opname en gescheiden audio-opnamen/transcriptie met volwassen gast, twee personages en echte providers. Een browserframe-ACK bewijst geen ontvangst door OBS of YouTube. |

De cue wordt via de gewone uitzendroute uitgesproken. De server registreert publicatie pas na een passende `ended`-receipt voor dezelfde vaste tekst en voice-opdracht. Een succesvolle HTTP-status, een weergegeven tekst, alleen afspelen of een vaste wachttijd geldt niet als publicatie- of terugkeerbewijs. Wanneer automatische afspelercontrole geen betrouwbaar livepunt geeft, blijft de gerichte cuecontrole beschikbaar; zonder voldoende bewijs volgt geen vrijgave.

Vrije AI-spraak bestuurt geen spelresultaat en geldt niet als officiële prijsuitspraak. Alleen door spelserver én regie gepubliceerde resultaten komen in de gastcontext. Een herkende onbevestigde winuitspraak in het transcript stopt lokaal de audio en meldt een fout onder hold. Dit is een aanvullende noodrem: transcriptie kan later komen dan audio en is geen garantie dat willekeurige AI-spraak nooit iets onjuists uitspreekt. Officiële prijsuitspraken blijven vaste spelservertekst; de echte audio-/providerpoort blijft dicht totdat de praktische repetitie is vastgelegd.

Nieuwe gesprekken binden ook de LiveKit-projectgegevens aan een private fingerprint. Een gewijzigde serverkoppeling kan geen nieuwe tokens uitgeven of de oude kamers als afgesloten verklaren. De oorspronkelijke koppeling moet worden hersteld voordat die opruiming kan slagen. De fingerprint verschijnt niet in familie- of regie-antwoorden.

Lokale regressies gebruiken SQLite, expliciete CAS/rollback-interleavings, afspelerfixtures, audiograaf-fixtures en providerstubs. Er zijn geen echte deelnemers gebeld, mails verzonden, providers geconfigureerd of externe databasegegevens gewijzigd.

```sh
node scripts/check-live-call-recovery.mjs
node scripts/check-live-calls.mjs
node scripts/check-player-live-call.mjs
node scripts/check-youtube-player.mjs
node scripts/check-live-call-output.mjs
node scripts/check-live-call-audio.mjs
node scripts/check-live-call-runtime.mjs
node scripts/check-production.mjs
node scripts/check-gpt-live.mjs
```

Status: de beschreven scenario's zijn lokaal gecorrigeerd en getest. Staging met deze wijzigingen en de echte apparatuur-/providerrepetitie zijn afzonderlijke vrijgavepoorten; deze tests verklaren die niet groen.
