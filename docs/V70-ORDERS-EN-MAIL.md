# v70 · Bestellingen en mail

De actuele audit, ontvangstkeuzes, Bunq-stroom en verificatieresultaten staan in [Bestellen, betalen en ophalen](BESTELLEN-BETALEN-OPHALEN.md).

De implementatie behoudt de native sessies en de DG-mailadapter. De geverifieerde Sites-bron is `f81d0c1c60cbe1422d43ce46d896af6cd4d2939c`; de daarin aanwezige veertien mailtemplates zijn behouden, met drie afzonderlijke operationele templates voor verplaatsing, annulering en bevestigde terugbetaling. Deze overdracht heeft geen betaling, echte verzending, campagne of externe provideractie uitgevoerd.

## Bestellingen

Nieuwe showtijden en besteldeadlines worden op de server omgezet naar UTC met `Europe/Amsterdam` als expliciete showzone. Een zonevrije API-waarde zonder deze zone wordt geweigerd. Niet-bestaande en dubbelzinnige zomertijden vragen een correctie of expliciete offset. Bestellen is gesloten vanaf exact de vroegste grens van deadline en showstart. Regie, familie, PDF en mail tonen Amsterdamse tijd.

Historische zonevrije tijden worden niet stil herschreven. De formatter bewaart hun zichtbare wandtijd en geeft `reviewRequired`; bestellen en starten vereisen een beoordeelde tijd. Het afzonderlijke [read-only inventarisatiehulpmiddel](V70-HISTORISCHE-SHOWTIJDEN.md) maakt een fingerprint en een voorstel met letterlijke before/proposal-waarden, uitsluitend na expliciet beoordeelde Nederlandse intentie. Er is geen remote dataconversie toegepast. Een geboekte show moet via de bevoegde verplaatsingsroute worden beoordeeld; controleer oorspronkelijke intentie, boekingen en communicatie vóór bevestiging.

| Overgang | Bevoegdheid en bewijs | Rechten |
|---|---|---|
| Bestellen / betaling melden | Eigen bevestigd volwassen account | Nog geen betaalbewijs of nieuwe speelrechten |
| Betaling bevestigen en uitgeven | Regie; referentie, exact bedrag, EUR en ordernummer | Eén idempotente boekjesset binnen de bestaande accountlimiet |
| Late betaling na annulering | Regie; hetzelfde bewijs | Zichtbaar reconciliatie-/refundgeval, geen automatische heruitgifte |
| Refund starten / mislukking registreren | Regie; auditmetadata | Blijft zichtbaar totdat bewijs is gecontroleerd |
| Refund bevestigen | Regie; referentie, bedrag, EUR en ordernummer | Pas dan `verified` en een operationele bevestigingsmail |
| Show verplaatsen / annuleren | Regie; actuele revisie, preview, uitleg en bevestiging | Behoud van historie; verplaatsing behoudt show-, order-, kaart- en code-identiteit |

Een serverberekende ontvangsthash voorkomt dat dezelfde betaalreferentie bij twee orders/shows van dezelfde organisatie wordt gebruikt. De sleutel bindt versienaam, opgeslagen `ownerId`, NFKC-genormaliseerde referentie en valuta; het bedrag maakt geen nieuwe ontvangstidentiteit. De claim wordt samen met de betaalbevestiging van de order atomair vastgelegd in `bingo_payment_receipts`. Deze eerste fase commit vóór de uitgifte. Een afzonderlijke atomaire spelmutatie legt vervolgens de boekjes, codes, orderbatch en eventuele gezinskoppeling vast; een generatiefout behoudt daardoor de bevestigde betaling en kan veilig worden hervat. Er wordt geen bank of betaalprovider geraadpleegd. Raw referenties en ontvangsthashes komen niet in publieke foutmeldingen.

De startcontrole en uitgifte lopen door dezelfde atomaire spelmutatie. Open betaalcontrole, ontbrekende uitgifte of onopgeloste financiële afhandeling blokkeert start. Na start kan regie financieel blijven reconciliëren; dat voegt geen nieuwe kaart aan het lopende spel toe. Algemene boekadministratie kan een orderblad niet naar een ander gezin overdragen of de orderuitgiftestatus wijzigen. Correctie van een kind binnen hetzelfde gezin blijft vóór start mogelijk en wordt gelogd. Losse en complete order-PDF's controleren de actuele order, show, eigenaar, uitgiftestatus, intrekking en waar vereist toelating, ook vóór een gecachete download.

## Mail en herstel

Operationele gebeurtenissen worden in dezelfde domeinmutatie vastgelegd. Herstel vult een ontbrekend outboxrecord aan met een vaste identiteit per merk, template, event en volwassen ontvanger. Een opslagfout draait bestelling, uitgifte of gepubliceerde uitslag niet terug. Een definitief gepubliceerde hoofdprijs gaat alleen naar de volwassen accountbeheerder; voorlopige claims en minigames versturen geen prijsmail.

De outbox onderscheidt `pending`, een vervallende claim vóór contact, `offering`, `accepted`, aantoonbaar `failed`, `uncertain` en `blocked`. Een verlopen claim mag veilig worden overgenomen. Een onderbroken aanbieding blijft onzeker en wordt niet automatisch herhaald. Alleen een mislukte voorbereiding zonder enige contactmarker kan via hetzelfde domeinevent en een CAS opnieuw een beveiligde payload krijgen. Daarmee herstelt ook een aanvankelijk ontbrekende encryptiesleutel of objectopslag. Een eerder bevroren bericht wordt niet vervangen. Beleid wordt vlak vóór het enige providercontact opnieuw getoetst.

De bestaande DG-adapter bepaalt de goedgekeurde afzender. De app bewaart geen Resend-sleutel. Een geldig serverbeheerd organisatiecontact is bovendien vereist. Zonder deze configuratie blijft echte verzending uit. `accepted` betekent alleen gatewayacceptatie, niet inboxbezorging. Er is geen nieuwe bounce-/bezorgwebhook verzonnen; bewijs van bezorging of bounce vereist de echte gatewaykoppeling.

Nieuwsbriefdeelname is standaard uit en wordt met tijd en versie per merk opgeslagen. Een afmelding bij Milo onderdrukt Vlampie niet. Een publieke afmeld-GET verandert niets; bevestigde POST kan zonder login afmelden. Campagnes blijven concept → voorbereiden → bewust starten, in begrensde batches. De huidige native adapter heeft `supportsMarketing:false`; campagnes mogen daarom niet echt versturen. De echte inlogmail wordt door Supabase Auth beheerd. Het studiovoorbeeld is alleen-lezen en wijzigt geen OTP-configuratie.

## Lokaal bewijs en resterende vrijgave

Gerichte verificatie gebruikt uitsluitend stubs en fictieve gezinnen:

- `scripts/check-bingo-orders.mjs`: 24 tests, waaronder de vastgelegde bestellimiet na regelpublicatie, dubbele uitgifte, cross-show ontvangstconflict, eigenaarschap, PDF, late betaling, refundbewijs en verplaatsing.
- `scripts/check-mail-service.mjs`: 16 tests, waaronder crashherstel vóór/na contact, parallelle workers, payloadherstel, beleidscontrole, merktoestemming, publieke afmelding en gepubliceerde prijs.
- `scripts/check-mail-templates.mjs`: 9 tests; veertien oorspronkelijke plus drie operationele templates.
- `scripts/check-mail-ui.mjs`: echte React/UI→API-contracten met providerstub.
- `tests/check-show-time.mjs`: winter, zomer, zomertijdgaten/-overlap en strikte deadline.
- De afzonderlijke [database-upgradeprocedure](V70-DATABASE-UPGRADE.md) beschrijft de vijf nieuwe backendtabellen en terugval.

Betaling en mail hebben elk een afzonderlijke vrijgave nodig: beoordeelde deelnamevorm en betaalbeleid, verifieerbare organisatie-/afzenderconfiguratie, afgesproken volwassen testadressen en een expliciet toegestane providerrepetitie. Die repetitie moet echte account-/betaal-/afmeldlinks, publieke HTTPS-assets, Gmail/Outlook, mobiel, platte tekst, afbeeldingen uit, geweigerde aanbieding en bounce onderzoeken. Deze punten zijn niet door lokale stubs afgetekend. Log daarbij geen codes, betaal-URL's of kindgegevens. Bepaal vóór echte communicatie een bewaartermijn en toegangsbeleid voor financiële metadata en de versleutelde mailsnapshots; er draait geen automatische historische opschoning.
