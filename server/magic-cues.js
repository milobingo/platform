// Canonical performance catalog, copied to public/ by the normal build.
// Times are seconds on the paused/seekable show clock; no cue owns game state.
const cue=(id,title,description,duration,theme,color,prop,choreography,times,intro)=>Object.freeze({
 id,title,description,intro,duration,theme,color,prop,choreography,camera:'magic',motion:'magic',hostId:'milo',sound:theme==='comedy'?'friendly':'prize',art:id,
 phases:Object.freeze({prepare:Object.freeze([0,times[0]]),suspense:Object.freeze([times[0],times[1]]),reveal:Object.freeze([times[1],times[2]]),settle:Object.freeze([times[2],duration])}),
});
export const MAGIC_CUES=Object.freeze([
 cue('star-hat','De zwevende sterrenhoed','Milo laat zijn hoge hoed zweven en onthult een stralende gouden ster.',14,'starlight','#f6cc76','hat-star','hat-lift',[3,5,11.5],'Zou mijn hoed een ster kunnen laten zweven? Kijk goed mee!'),
 cue('silk-stars','Van lint naar sterrenvlinder','Zijden linten volgen de toverstaf en veranderen in een fonkelende sterrenvlinder.',15,'ribbons','#82e3dc','silk-butterfly','ribbon-loop',[2.5,5,12.5],'Deze linten willen vandaag vliegen. Zullen we ze helpen?'),
 cue('flower-hat','De regenboogbloemenhoed','Een lege hoed krijgt één gouden zaadje. Daarna ontvouwt zich een steeds groter regenboogboeket.',20,'botanical','#f394c8','flower-hat','hat-bloom',[4,8,17],'Eén klein zaadje in mijn hoed… wat zou daaruit groeien?'),
 cue('linking-rings','De onmogelijke sterrenringen','Drie losse gouden ringen dansen rond Milo’s handen en klikken zichtbaar in elkaar.',22,'illusion','#f3ce77','gold-rings','rings-circle',[4,10,19],'Drie losse ringen. Zouden ze samen een sterrenketting kunnen worden?'),
 cue('floating-table','Het zwevende tovertafeltje','Milo tilt een fluwelen doek op. Het kleine gouden tafeltje volgt, los van de vloer.',24,'levitation','#c2a2ff','velvet-table','cloth-lift',[5,10,20],'Dit tafeltje heeft danskriebels. Zou het ook kunnen zweven?'),
 cue('rainbow-cube','De draaiende regenboogkubus','Een donkere kubus komt langzaam tot leven. Hij draait en onthult regenboogkleuren en een gouden ster.',20,'prism','#80e1dd','rainbow-cube','cube-turn',[4,8,17],'In deze kubus zitten kleuren verstopt. Help je ze wakker toveren?'),
 cue('cookie-mystery','Het verdwenen gelukskoekje','Een koekje verdwijnt onder een beker. Milo zoekt ernaast, terwijl het koekje vrolijk terugzweeft.',18,'mystery','#edb968','cookie-cup','cookie-cover',[4,8,15],'Eén koekje, één beker. Houd dat koekje goed in de gaten!'),
 cue('star-rabbit','Het konijn van sterrenstof','Milo toont een lege hoge hoed. Een sterrenspoor vormt oren, pootjes en een vriendelijk lichtkonijn.',22,'creature','#e9c3ff','star-rabbit','rabbit-rise',[4,9,19],'Mijn hoed voelt kriebelig. Zou er een sterrenvriendje in zitten?'),
 cue('bubble-world','De wereld in de reuzenbel','Een klein zeepbelletje groeit tot een glanzende wereld vol draaiende sterren en springt zacht uiteen.',24,'cosmos','#89e5e4','galaxy-bubble','bubble-gather',[5,10,21],'Een klein belletje met een groot geheim. Kijk maar mee!'),
 cue('reverse-hourglass','De omgekeerde zandloper','Het gouden zand stopt even en stroomt dan omhoog, tegen de zwaartekracht in.',20,'time','#efd185','hourglass','hourglass-turn',[4,9,17],'Zand hoort omlaag te vallen. Zullen we het eens andersom proberen?'),
 cue('wand-multiplication','Eén staf, drie verrassingen','Milo’s toverstaf wordt langer, splitst in drie dansende staven en komt weer als één staf in zijn hand.',18,'multiplication','#cbb4ff','three-wands','wand-split',[3,7,15],'Eén toverstaf is handig. Maar hoeveel passen er in mijn handen?'),
 cue('banana-surprise','De banaan die niet besteld was','Milo verwacht een deftige ster. Zijn hoed presenteert eerst een veel te vrolijke gouden banaan.',18,'comedy','#ffe182','banana-hat','banana-reveal',[4,8,15],'Ik heb een deftige ster besteld. Hopelijk heeft mijn hoed goed geluisterd!'),
]);
export const MAGIC_IDS=Object.freeze(MAGIC_CUES.map(cue=>cue.id));
export const getMagicCue=id=>MAGIC_CUES.find(cue=>cue.id===id)||null;
