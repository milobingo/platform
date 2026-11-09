# Het uitzendbeeld in OBS

Open in de aangemelde regie de gewenste opgeslagen show en ga naar **Studio & camera’s → OBS-browserbron**. Kies **OBS-link beheren → OBS-link maken** en kopieer de getoonde link. Kies **Beeld naar OBS sturen** en houd deze regiebrowser open. Voeg in OBS een **Browserbron** toe, plak de link en stel **1920 × 1080** in. Schakel **Audio beheren via OBS** in en controleer de audiomixer. Kies in de live regie de bestaande geluidsroute via het uitzendvenster wanneer het showgeluid door OBS moet lopen.

De link opent het uitzendbeeld zonder Google-aanmelding in de OBS-browser. Geluid wordt automatisch gestart als de browser dat toestaat. Blijft de activatieknop zichtbaar, open dan **Interactie** op de browserbron en kies **Beeld & geluid activeren**. Controleer beeld, stem, gastgeluid, mute en noodstop tijdens een repetitie op de werkelijk gebruikte OBS-computer. Een geslaagde browsertest vervangt die audioproef niet.

## Geldigheid en vervangen

Een link is zeven dagen geldig en hoort bij één show. Per regieaccount is één link actief; een link voor een andere show vervangt de vorige. **Nieuwe OBS-link maken** en **OBS-link intrekken** vragen een bevestiging wanneer er al een actieve link is. De server geeft de volledige link alleen direct na het maken terug. Ben je hem kwijt, maak dan een nieuwe.

Na intrekken, vervangen of verlopen weigert de server verdere aanvragen met de oude link. De gewone OBS-browserbron stopt dan beeld en geluid; bij een netwerkstoring wacht zij op een geldige verbinding. Een al uitgegeven verbinding met een externe audioprovider heeft daarnaast haar eigen opruiming en vervaltijd. Intrekken hervat geen trekking en heft geen onzekere belblokkade op.

De gewone knop voor een uitzendvenster in je aangemelde browser blijft beschikbaar. Gebruik voor OBS de apart gemaakte link, niet alleen `/uitzending`.

## Toegang en opslag

De link geeft alleen toegang tot het gepubliceerde uitzendbeeld, de actuele stemclip en het uitzendgedeelte van een live gesprek voor de gekozen show. Hiermee kun je geen regie voeren, andere shows lezen, backstage meeluisteren, instellingen wijzigen of sleutels opvragen. Privépersonagegegevens en gastadministratie worden uit het antwoord verwijderd. De regiesessie blijft afzonderlijk met Supabase gecontroleerd.

Het toegangsbewijs staat achter `#obs=` in de link; de browser stuurt het voor de beperkte uitzendroutes in een aparte header. Het staat niet in queryparameters, cookies of lokale browseropslag. De server bewaart alleen een willekeurige identificatie, een hash, show en geldigheid in de bestaande uitzendopslag. Er zijn geen nieuwe accounts, omgevingsvariabelen, secrets of databasekolommen nodig.

Bewaar de link bij de persoon die OBS bedient. OBS slaat browserbron-URL’s op in zijn scènecollectie; deel zo’n collectie alleen als je die toegang wilt delen. Bij een vermoeden dat de link is gedeeld kun je hem in de regie vervangen of intrekken.

Een terugrol naar een appversie van vóór deze functie kan de OBS-link niet gebruiken. Kies bij een correctie een release die ook de native regiesleutels en de OBS-toegang ondersteunt.
