# Providers beheren vanuit Milo

OpenAI, LiveKit en Resend kunnen vanuit de regie worden opgeslagen, vervangen,
gecontroleerd en uitgeschakeld. Daarvoor zijn geen providerkeys in GitHub nodig.
De instellingen gelden per serveromgeving voor Milo en Vlampie samen. Hun eigen
showomgeving, personages, mailtemplates, campagnes en toestemmingen blijven apart.

Deze pagina beschrijft het nieuwe beheer. De werkelijke uitrolstatus staat in
[het projectprofiel](../PROJECTPROFIEL.json) en [het stagingresultaat](STAGING-RESULTAAT.md).
De overgang naar beschermde hostconfiguratie is afzonderlijk beschreven in
[BESCHERMDE-CONFIGURATIE.md](BESCHERMDE-CONFIGURATIE.md).

## OpenAI

1. Open **Instellingen → AI & stemmen**.
2. Vul de centrale OpenAI API-sleutel in en kies **Sleutel veilig opslaan**.
   Opslaan doet geen provideroproep en geeft geen model- of audiogarantie.
3. Kies bewust **Test verbinding** en zo nodig **Test GPT-Live-toegang**.
   Beluister vervolgens de gebruikte stem bij het personage en test de uitzending.

Een opgeslagen sleutel wordt nooit teruggestuurd of vooraf ingevuld. Een leeg
vervangingsveld bewaart de bestaande sleutel; om bewust uit te schakelen gebruik
je **Koppeling uitschakelen**. Na bevestigde opslag wist de app het invoerveld.
Elk personage behoudt zijn eigen stemprofiel; er is geen afzonderlijke API-key per
personage nodig.

## LiveKit Cloud

Open **Instellingen → E-mail & bellen** en vul de eigen
`wss://…livekit.cloud`-project-URL, API-key en API-secret in. Kies
**LiveKit-koppeling opslaan** en daarna **Test opgeslagen koppeling**.

Bij dezelfde koppeling mogen key en secret leeg blijven om de aanwezige gegevens
te behouden. Een gewijzigd project of gewijzigde API-key vraagt de bijbehorende
volledige gegevens. De app leent geen secret van een andere koppeling. Alleen de
project-URL en de aanwezigheid van credentials zijn zichtbaar; key en secret
worden niet teruggegeven. Een wijziging verwijdert de eerdere groene teststatus.

De servercontrole bewijst bereikbaarheid en credentials. Een echt gesprek met
een tweede apparaat, oudertoestemming en de private/uitzendaudio blijven aparte
repetitiestappen. Een sleutelwijziging start geen gesprek en hervat geen trekking.

## Resend voor showmails en nieuwsbrieven

Open **Instellingen → E-mail & bellen → Resend e-mailkoppeling**, of ga naar
**E-mail & nieuwsbrieven → Instellingen**. Deze twee plaatsen beheren dezelfde
centrale koppeling.

1. Vul de **Resend API-sleutel**, het **Afzenderadres** op het geverifieerde
   Resend-domein en eventueel het **Antwoordadres** in.
2. Kies bewust een verzendmodus. De standaard is **Uit — niets versturen**.
3. Kies **Instellingen en verzendmodus opslaan**. De key blijft op de server;
   een leeg keyveld behoudt de bestaande key. Afzender en antwoordadres blijven
   bewerkbaar zonder opnieuw een key te hoeven invoeren.
4. Kies **Test Resend-koppeling**. De server gebruikt de opgeslagen key voor een
   begrensde GET naar Resends domeinlijst en controleert exact het afzenderdomein.
   Deze actie verstuurt geen e-mail en bewijst geen bezorging. Een sleutel met
   uitsluitend verzendrecht kan geen domeincontrole toestaan; de app meldt dat.
5. Voor een echte proefmail kies je bewust **Testmail** in de mailwerkplek. Die
   gebruikt fictieve inhoud en uitsluitend het ingelogde organisatieadres; dat
   adres moet ook binnen de ingestelde verzendbeperking vallen.

| Modus | Gedrag |
| --- | --- |
| Uit | Credentials kunnen opgeslagen en gecontroleerd worden; verzending blijft uit. |
| Alleen testontvangers | Maximaal 100 expliciete adressen; alleen deze adressen kunnen mail krijgen. Dit is de beschikbare verzendroute op staging. |
| Live | Alleen toegestaan op een server met de vaste productie-omgevingsgrens. Showmails mogen worden aangeboden; nieuwsbrieven blijven onderworpen aan oudertoestemming, afmeldingen en bewuste verzendbevestiging. |

Een eventuele aanvullende serverbeperking blijft een bovengrens. De regie kan
die niet verruimen. Alleen credentials opslaan of controleren zet verzending
niet aan. Kies je in hetzelfde opslagformulier bewust een actieve modus, dan
wordt ook die keuze bewaard. Controleer **Verzendlog**: aangeboden, geaccepteerd,
bezorgd en onzekere ontvangst zijn verschillende uitkomsten.

Een onzekere eerdere aanbieding wordt niet automatisch opnieuw verzonden.
Bestaande outboxhistorie en de eerder vastgelegde berichtinhoud blijven behouden
bij sleutel- of afzenderwijziging. Een oude afzender wordt niet stil herschreven.

## Beveiliging, gelijktijdige wijzigingen en herstel

Alleen een echte regierol mag deze instellingen wijzigen. De server controleert
de aanmelding en rol opnieuw na het wachten op een provideroperatie. Opslaan
gebruikt een revisiecontrole: als een andere tab al iets wijzigde, vraagt de app
herladen in plaats van diens gegevens te overschrijven. Bij een mislukte opslag
blijft de invoer beschikbaar. Sleutels horen niet in Git, chat, browseropslag of
personage-instellingen.

De instellingen worden met AES-GCM versleuteld opgeslagen in de bestaande private
Storage. De masterkey **`VLAMPIE_SETTINGS_KEY`** staat uitsluitend in de beschermde
hostruntime. Deze historische naam geldt ook voor Milo. Behoud dezelfde key bij
release, herstel en dataoverdracht: een nieuwe willekeurige key maakt bestaande
instellingen en private mailhistorie onleesbaar.

Tijdens actieve belmomenten, open microfoontests, onzekere provideropruiming of
een nog niet vrijgegeven belblokkade blijven relevante OpenAI-/LiveKitwijzigingen
geblokkeerd. Resendbeheer en verzending delen de providerlock: een voltooide
uitschakeling kan niet worden ingehaald door een wachtende oude mailadapter.

Bestaande OpenAI-/LiveKit-serverwaarden kunnen als beschermde fallback behouden
blijven. **Koppeling uitschakelen** bewaart een bewuste uitschakeling; de app valt
dan niet stil terug op die waarden. **Serverinstellingen gebruiken** herstelt
alleen na een bewuste actie een werkelijk aanwezige serverkoppeling. Corruptie of
een verkeerde masterkey geeft een fout en activeert geen alternatieve sleutel.

Gebruik na invoering van nieuwe beheerinstellingen alleen een compatibele
terugrolrelease. Een oudere app die de native instellingen of Resendroute niet
kent kan serverfallbacks gebruiken of de ingestelde route missen. Kies dan een
compatibele correctie vooruit; draai geen providergegevens of mailhistorie terug.

## Supabase Auth en Google staan apart

Google-aanmelding, e-mailcodes, OAuth-clientgegevens en de SMTP-/afzenderinstellingen
voor **Supabase Auth** worden in het eigen Supabase-project beheerd. De
Resend-koppeling in Milo verandert deze Auth-instellingen niet. Het alleen-lezen
inlogcodevoorbeeld in de mailstudio is geen echte Auth-templatewijziging.

Voor de accounts en het beperkte GitHub-model zie
[PROJECTGEGEVENS-EN-SECRETS.md](PROJECTGEGEVENS-EN-SECRETS.md). De oude beschrijving
is bewaard als [historisch archief](REGIE-SLEUTELS-LEGACY-2026-11-10.md).
