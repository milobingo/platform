# Providersleutels beheren in de regie

De centrale OpenAI-koppeling staat onder **Instellingen → AI & stemmen**. De LiveKit-koppeling staat onder **Instellingen → E-mail & bellen**. Beide koppelingen gelden voor alle producties op deze omgeving, dus voor Milo en Vlampie samen.

## OpenAI

1. Vul de bestaande of nieuwe eigen OpenAI API-sleutel in bij **OpenAI API-sleutel**.
2. Kies **Sleutel veilig opslaan**. Dit bewaart de sleutel versleuteld; er wordt nog geen provideroproep gedaan.
3. Kies bewust **Test verbinding** en, voor de gebruikte stemmen, **Test GPT-Live-toegang**. Een geslaagde verbinding is nog geen geslaagde geluids- of uitzendproef.

Een opgeslagen sleutel wordt nooit teruggestuurd. Het lege veld betekent dat er geen vervangende sleutel is ingevuld; de status toont of een sleutel aanwezig is. Invoer wordt na een bevestigde opslag gewist. De sleutel hoort niet in personage-instellingen, browseropslag, Git of chat.

## LiveKit

Vul de eigen `wss://…livekit.cloud`-project-URL, API-key en API-secret in. Kies **LiveKit-koppeling opslaan** en daarna afzonderlijk **Test opgeslagen koppeling**. Bij hetzelfde project kunnen de key en het secret leeg blijven om de aanwezige gegevens te behouden. Een gewijzigde project-URL of API-key vraagt opnieuw bijbehorende volledige gegevens; er wordt geen secret van een ander project geleend.

De opgeslagen key en het secret worden niet teruggestuurd of vooraf in de velden ingevuld. Alleen de project-URL en de aanwezigheid van credentials zijn zichtbaar. Een gewijzigde koppeling verliest haar vorige teststatus.

## Serverinstellingen, uitschakelen en toegang

Zonder bewuste regie-instelling gebruikt de app de bestaande `OPENAI_API_KEY` en `LIVEKIT_*`-serverwaarden. Opslaan via de regie maakt een afzonderlijke versleutelde instelling voor deze omgeving. **Koppeling uitschakelen** schakelt bewust uit; er wordt dan niet stil op serverwaarden teruggevallen. **Serverinstellingen gebruiken** zet die terugval na bevestiging expliciet aan, wanneer servergegevens beschikbaar zijn.

Alleen een opnieuw gecontroleerde regierol mag deze instellingen wijzigen. Iedere opslag gebruikt de huidige revisie; een gelijktijdige wijziging vraagt herladen. Opslag gebruikt de bestaande private bucket, masterkey `VLAMPIE_SETTINGS_KEY` en afzonderlijke native objectnamen. Oude geïmporteerde prototype-instellingen en serverwaarden worden niet overschreven. Een onleesbare versleutelde instelling wordt als fout behandeld, niet als reden om een andere sleutel te kiezen.

Tijdens een actief belmoment, onzekere provideropruiming, open microfoontest of nog niet vrijgegeven belblokkade blijven sleutelwijzigingen geblokkeerd. Intrekken van toestemming en opruimen moeten bereikbaar blijven. Sleutels wijzigen hervat geen trekking en start geen gesprek.

## Mailtemplates en controle vóór uitrol

De mailstudio bevat zeventien templates: de veertien oorspronkelijke templates en drie operationele aanvullingen. Zij zijn leesbaar zonder actieve mailgateway. Het inlogcodevoorbeeld blijft alleen-lezen; de echte inlogmail wordt door Supabase Auth beheerd.

Supabase Storage kan een ontbrekend instellingenobject melden met HTTP400 en de gestructureerde fout `NoSuchKey`/`statusCode:404`. De native adapter herkent uitsluitend die combinatie als ontbrekend object. Een ontbrekende bucket, autorisatiefout of storing blijft een fout. De mailstudio toont bij een laadfout een blijvende melding en **Opnieuw laden**; zij toont dan geen lege zoekresultaten of bewerkbare onvolledige werkplek.

De staginguitrol controleert vóór activatie het werkelijke database-/private-opslagpad: beide templatecatalogi en de leesbare, bewerkbare, geredigeerde providerinstellingen. Die controle voert geen database-/objectwijziging of provideroproep uit. Zij bewijst geen echte Google-aanmelding, mailbezorging of uitzending. Daarvoor blijven de afzonderlijke account- en apparatenproeven nodig.
