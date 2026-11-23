# Milo-productie: uitrol van 23 november 2026

De volledige actuele applicatieversie is succesvol uitgerold naar
**https://milo.dgwebservices.nl**. De bestaande productieconfiguratie blijft in
gebruik. Er zijn geen database-, Auth-, Storage- of providerinstellingen aangepast
voor deze uitrol.

| Onderdeel | Vastgelegde identiteit |
| --- | --- |
| Applicatiebron | `d7d14958afe1b000d6da4f4310c0aab02c88da36` |
| CI | [45054924092](https://github.com/milobingo/platform/actions/runs/45054924092), geslaagd |
| Geaccepteerde stagingrelease | `45056211553-1`, [geslaagde workflow](https://github.com/milobingo/platform/actions/runs/45056211553) |
| Productierelease | `45229874387-1`, [geslaagde workflow](https://github.com/milobingo/platform/actions/runs/45229874387) |
| Productieconfiguratie | `production-2026-11-15-v1` |
| Workflowbron | `38795c6663544a854a51eabafe02e4b0dfa17258` |
| Host en site | `dg-nxttrack-01`, `milobingo-production`, loopbackpoort `4178` |
| Vorige productierelease | `aab35f80b964-43911040530-1` |

De applicatiebron is exact gelijk aan de al draaiende en geaccepteerde
stagingrelease. Het verschil met de main-stand bij dispatch bestaat uit
documentatie en meetbewijs; er ontbreken geen applicatiewijzigingen.

## Wat is meegekomen

- Nieuwe bestellingen krijgen `MF-` plus zes willekeurige hoofdletters/cijfers,
  bijvoorbeeld `MF-8JK655`. De bestaande opslagtransactie controleert ook
  gelijktijdige creaties op referentieconflicten. Bestaande referenties blijven
  behouden.
- De gewone handmatige betaalroute is **Betaald → Ja, betaald**, zonder
  referentievelden of extra vinkje. Bijzondere financiële herstelroutes behouden
  hun eigen bewijsvereisten.
- Het gezin wacht op de geladen bestelgegevens voordat downloads worden geopend.
- De huidige applicatiecode voor rechtstreekse LiveKit-uitzendingen, HLS en
  Cast/AirPlay, inclusief de op staging geteste herstelwijzigingen, is aanwezig.

De laatste wijziging activeert geen eigen media-infrastructuur op productie.
Daar ontbreekt bewust nog een afzonderlijke beschermde
`MILO_BROADCAST_CONFIG`-inrichting. Bestaande shows gebruiken hun bestaande
YouTube-route en de besloten belverbinding behoudt haar bestaande instellingen.
De media-installatie en meetopstelling blijven op staging. Voor activering van
productie-LiveKit zijn de afzonderlijke productieconfiguratie en operationele
ontvangerproeven nog nodig; zie [LIVEKIT-STAGING.md](LIVEKIT-STAGING.md) en het
[meetrapport](LIVEKIT-FIREWALL-HERTEST-2026-11-22.md).

## Acceptatie en uitgevoerde controles

De gebruiker bevestigde voor precies deze stagingrelease de vijf controles
gezinslogin, regietoegang, bestellen/PDF, mailontvangst en showaudio/bellen met:
**“Ja ik bevestig alles. Rol uit aub.”** Dit is als gebruikersverklaring
vastgelegd in het
[acceptatiebewijs](../verification/production-release/2026-11-23/staging-user-acceptance-d7d1495.json).
Codex heeft deze echte account- en providerproeven bij deze uitrol niet zelf
opnieuw uitgevoerd. De verklaring vervangt geen nog openstaande fysieke OBS-,
Chromecast- of AirPlay-proef van de nieuwe streamingroute.

Het aan SHA, stagingrun en release-ID gebonden record is als `root:root 0600`
geïnstalleerd in de bestaande beschermde acceptatiemap. De bestaande gate en
deploybroker zijn ongewijzigd gebruikt. Alle drie de productiejobs slaagden:
`release-gate`, `deploy` en `verify-public`.

De broker voerde de build en de controle van de bestaande backend uit vóór
activatie. De publieke verifier bevestigde de exacte release-identiteit, de
script- en afbeeldingsbestanden en de grenzen voor anonieme toegang, vervalste
identiteit, vreemde origins en lokale login. De aparte publieke healthcontrole
bevestigde dezelfde productie-SHA, run en configuratie.

De hostcontrole vóór en na activatie bevestigde dat alle acht bestaande
Caddyfragmenten dezelfde hashes hebben. De zeven overige gecontroleerde
appservices, inclusief Milo staging, behouden hun eerdere status en PID. De
vorige verzegelde productierelease blijft beschikbaar voor gericht beheerherstel
volgens de [bestaande productieprocedure](PRODUCTIE-DEPLOY.md).

Er zijn voor de verificatie geen echte orders aangemaakt, betalingen bevestigd,
mails verzonden of deelnemers gebeld. Vlampies instellingen, studio's en
draaiboeken zijn niet aangepast.

Alle veilige uitrolbewijzen staan in
[verification/production-release/2026-11-23](../verification/production-release/2026-11-23/).
