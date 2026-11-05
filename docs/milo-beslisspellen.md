# Milo’s vijf magische beslisspellen

Beschikbaar via **Showelementen → Beslisspellen**. Sterrenplingo krijgt Milo’s
magische afwerking; Lintenlabyrint, Spiegelpaleis, Toverdrank en Sterrenvlinder
zijn vier nieuwe, afzonderlijke Canvas-scènes. De catalogusminiaturen gebruiken
dezelfde renderer als de uitzending.

Kies **Kies deze vijf** om precies deze selectie klaar te zetten, en daarna
**Spelkeuze opslaan**. Dit kan in voorbereiding of oefenstand. Bij een lopende
show liggen de spelregels en ingeschakelde spellen vast. Bestaande opgeslagen
selecties worden niet automatisch uitgebreid. Nieuwe Milo-shows bevatten
de nieuwe spellen; Vlampie en Rocco houden hun eigen bestaande aanbod.

| Spel | Duur | Onthulling |
| --- | --- | --- |
| Sterrenplingo | 24 sec | De gouden bal stuitert naar het vak met de opgeslagen winnaar. |
| Lintenlabyrint | 28 sec | Zijden linten weven door een labyrint; een knoop onthult de gouden ster. |
| Spiegelpaleis | 26 sec | Spiegelbeelden verschuiven en verdwijnen; de echte gouden onthulling blijft over. |
| Toverdrank | 26 sec | Ingrediënten kleuren de flesjes; één flesje maakt de gouden fontein. |
| Sterrenvlinder | 30 sec | Linten vormen een vlinder die de finalisten bezoekt en de gouden envelop brengt. |

**Bekijk oefenspel** gebruikt fictieve deelnemers en maakt geen loting,
bingomelding of prijs aan. De voorvertoning is als oefenspel herkenbaar, ook
in het uitzendbeeld. Regie kan pauzeren, hervatten of terugkeren met de bestaande
showbediening. Voor deze animaties zijn geen extra AI-sessies nodig.

Bij een echte gelijke bingo selecteert de spelserver de winnaar en het spel
één keer en slaat beide op. De animatie bepaalt of verandert geen winnaar.
Een herladen resultaat gebruikt dezelfde uitslag; routes zijn reproduceerbaar
op basis van resultaat-ID en verstreken showtijd. Namen/boekjes blijven via
vaste kleur- en groepslabels zichtbaar. Bij grote aantallen is ieder toegelaten
boekje precies eenmaal in een vaste groep vertegenwoordigd; de serverlootkans
blijft per boekje en hangt niet af van de groepsgrootte.

De bestaande meldvensters, trekkingblokkades, kaarten, uitslagen en privé-/live
gespreksrouting blijven leidend. De regie bevestigt pas na de afgeronde
onthulling de bestaande uitslag. Native Canvas-controles en lokale server-/
runtimetests dekken de route; een nieuwe OBS-/YouTube-uitzendproef is niet
onderdeel van die lokale verificatie.

## Doorlopende animatie en Plingo-spanning

De Milo-renderer heeft nu één doorlopende beeldklok per spelinstantie.
Herhaalde of verouderde statusberichten zetten de animatie niet meer terug.
Beeld en spelgeluid gebruiken dezelfde soort synchronisatie; pauze blijft
exact staan. Een nieuwe afspeelinstantie begint opnieuw en een expliciete
preview-seek gebruikt een eigen seekRevision. De vastgelegde uitslag verandert
daarbij nooit.

Sterrenplingo heeft een grotere bal, duidelijke botsingen met opwaartse
stuiters, een sneller boventraject en een trager eindtraject met late
richtingswissels en een rustige landing. Botsingsgeluid volgt de werkelijke
tijdstippen van pinnen en opvangranden. De pinnen behouden hun materiaal;
lichtaccenten verlopen geleidelijk.

Sterren, fontein- en confettideeltjes vervagen vóór ze naar het begin van
hun baan teruggaan. Kleurwissels vloeien over en het eindbeeld komt tot rust.
Naast stilstaande beelden controleren regressietests nu herhaalde
uitzendpakketten en opeenvolgende videoframes op tijdsprongen en lichtsprongen.
