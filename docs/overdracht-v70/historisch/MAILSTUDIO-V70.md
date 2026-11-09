# Wijziging 7 — E-mail & nieuwsbrieven

De showstudio krijgt één communicatieplek voor templates, automatische berichten, nieuwsbrieven en verzendstatussen. Milo & Friends en Vlampie behouden hun eigen logo, kleuren, teksten en abonnementen. De bestaande Resend-koppeling wordt hergebruikt; OpenAI- en LiveKit-sleutels zijn geen mailsleutels.

## Acties en berichten

| Actie | Template | Bediening |
| --- | --- | --- |
| Een ouder vraagt een inlogcode aan | `auth-code` | Automatisch; code en geldigheid blijven verplicht |
| Het gezinsaccount rondt de eerste kennismaking af | `welcome` | Eenmalige welkomstmail |
| Een gezin bestelt bingobladen | `order-received` | Bestelbevestiging na opgeslagen aanvraag |
| Er komt een nieuwe bestelling binnen | `org-order-new` | Bericht aan de organisatie |
| Organisatie koppelt of wijzigt een persoonlijke betaallink | `payment-link` | Automatisch via bestaande bestellingsoutbox |
| Ouder meldt de betaling | `payment-reported` | Ontvangst van de melding; nadrukkelijk geen betaalbevestiging |
| Organisatie controleert betaling en geeft unieke bladen vrij | `books-ready` | Automatisch, na de bestaande expliciete goedkeuring |
| Een bestelling wordt geannuleerd | `order-cancelled` | Na bevestigde statuswijziging |
| Organisatie wijst een bestelling af | `order-rejected` | Na bevestigde statuswijziging |
| Een show onder de aandacht brengen | `show-reminder` | Bewust klaargezette campagne voor abonnees bij de gekozen show |
| Showinformatie delen | `show-changed` | Bewust klaargezette campagne; geen automatische datumwijzigingsmail |
| Terugblik of bedankje | `show-thanks` | Bewust klaargezette campagne |
| Bevestigde prijs communiceren | `prize-confirmed` | Template voorbereid; nog geen automatische winnaarverzending |
| Algemene update of aankondiging | `newsletter` | Concept → ontvangers voorbereiden → expliciet verzenden |

Er gaan geen mails uit bij iedere bal, voorlopige bingomelding, kindbewerking of live oproep. Een nieuwsbrief is geen alternatief voor de oproepmelding in de geopende familie-app. Er is geen nieuwe automatische tijdscheduler aangezet.

## Premium templates en shortcodes

Templates bestaan uit onderwerp, voorvertoningstekst, kop, berichttekst en knop. De editor biedt shortcodes met een voorbeeldwaarde. Onder meer `{{gezinsnaam}}`, `{{voornaam}}`, `{{show_naam}}`, `{{show_datum}}`, `{{show_tijd}}`, `{{bestelnummer}}`, `{{aantal_bladen}}`, `{{bedrag}}`, `{{betaallink}}`, `{{account_link}}` en `{{afmeldlink}}` zijn beschikbaar waar de betreffende template die ondersteunt.

De canonieke lijst staat in `server/mail-templates.js`. Onbekende of ontbrekende verplichte shortcodes worden geweigerd. Ingevulde waarden worden als tekst ontsmet. De editor accepteert geen willekeurige HTML of scripts. Essentiële inlog- en bestellingsgegevens blijven uit de echte serveractie komen. Een voorbeeld gebruikt duidelijk fictieve gegevens; dat bewijst geen echte aflevering.

De e-mails hebben tabelopmaak, directe CSS, een leesbare lichte inhoud en een eigen Milo- of Vlampie-header. Een tekstversie blijft beschikbaar voor mailprogramma’s die geen HTML tonen. Het logo wordt niet uitgerekt; afzender en shownaam blijven als tekst herkenbaar als afbeeldingen uitstaan.

## Nieuwsbrief standaard aan, aanmelding bewust

De **nieuwsbriefmodule** staat standaard aan. Bestaande gezinnen worden niet automatisch op een verzendlijst gezet. Een ouder kiest in **Mijn account** zelf voor de nieuwsbrief van de betreffende showwereld. Toestemming heeft een tijdstip en versie; afmelden blijft mogelijk in het account en via de e-mail. Milo- en Vlampie-abonnementen zijn gescheiden.

Een campagne bewaart eerst het concept. Voorbereiden bepaalt de ontvangers; de expliciete verzendactie verwerkt kleine batches. Elke ontvanger krijgt een eigen bericht. De server controleert toestemming opnieuw vlak voor de aanbieding aan de maildienst, ook als de campagne eerder is voorbereid. Een afmelding moet dus ook een nog niet verzonden bericht tegenhouden.

Een afmeldlink opent eerst een bevestigingspagina: alleen het openen door een mailscanner wijzigt geen voorkeur. De afmeldactie vereist geen accountlogin binnen de toepassing. De toegangsinstelling van de huidige private Sites-omgeving blijft wel ongewijzigd; controleer openbare bereikbaarheid bij integratie op het echte domein.

## Verzendstatus en veilig opnieuw proberen

Een bevestigde aanvraag bij Resend betekent **aangenomen door de maildienst**, niet bewezen afgeleverd of gelezen. Een ontbrekende bevestiging blijft onzeker. De outbox gebruikt vaste berichtidentiteiten en voorkomt dubbele aanbiedingen bij herhaalde acties. Een onzekere aanbieding wordt niet stilzwijgend opnieuw verstuurd. Er is geen trackingpixel toegevoegd.

Een mailfout draait een geldige bestelling, betaalmelding, uitgifte of onboarding niet terug. Controleer de afzonderlijke verzendstatus; ga niet opnieuw kaarten genereren om een mail te herstellen.

## Instellen en echt repeteren

- Resend-sleutel en afzender worden via de bestaande beveiligde mailinstellingen beheerd, met omgevingsvariabelen `RESEND_API_KEY` en `PLAYER_MAIL_FROM` als bestaande fallback.
- De afzender moet bij de maildienst toegestaan zijn. Geheimen blijven op de server.
- `MAIL_ASSET_BASE_URL` is optioneel: een vertrouwde openbare HTTPS-basis voor de bestaande logo-assets. De huidige owner-private Sites-assets kunnen in een externe mailbox achter de inlogpoort vallen. Maak de Site hiervoor niet ongevraagd openbaar; richt op het echte domein geschikte publieke mailassets in.
- Testmail richt zich alleen op het ingelogde organisatieadres. Een echte testmail en campagne worden uitsluitend bewust vanuit de interface gestart.
- De oefenstudio en familie-demo simuleren templatewijzigingen, abonnementen en verzending lokaal. Zij benaderen geen maildienst.

Tijdens ontwikkeling worden providerstubs en fictieve gezinnen gebruikt. Een volledige echte mailboxrepetitie, afmeldtest op het beoogde domein en controle in Outlook/Gmail blijven onderdeel van ingebruikname.

## Bronnen voor de aanmeldkeuze

De implementatie volgt een expliciete aanmelding en eenvoudige afmelding. Zie [ACM — Spam voorkomen in uw reclame](https://www.acm.nl/nl/verkoop-aan-consumenten/reclame-en-verleiden/spam-voorkomen-uw-reclame) en [AP — Grondslag toestemming](https://autoriteitpersoonsgegevens.nl/themas/basis-avg/avg-algemeen/grondslag-toestemming).

