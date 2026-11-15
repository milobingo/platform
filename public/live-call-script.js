// These fixed lines are prepared with the rest of the show. A selected child
// is identified on screen; their name never triggers a surprise audio request.
export const LIVE_CALL_LINES=Object.freeze({
 greeting:'Hallo, wat fijn dat je er bent! Jij bent mijn toverassistent. Doe je mee? Tovervinger klaar!',
 choice:'Welke magie kies jij: fonkelende sterren of vrolijke bubbels? Tik op het scherm, of zeg het hardop.',
 stars:'Sterren! Wat een schitterende keuze. Iedereen thuis mag meedoen. Houd je tovervinger maar klaar!',
 bubbles:'Bubbels! Wat een vrolijke keuze. Iedereen thuis mag meedoen. Houd je tovervinger maar klaar!',
 countdown:'Tel maar mee. Drie! Twee! Eén! Toverpret voor iedereen!',
 thank:'Wauw, samen getoverd! Een groot applaus voor onze toverassistent. Dank je wel! Ga weer gezellig kijken en meespelen. Dag!',
 fallback:'Onze toverassistent blijft vandaag lekker thuis meekijken. Dat is helemaal goed! Dan doen wij de magie gewoon samen. Tovervingers klaar? Drie, twee, één, toverpret voor iedereen!'
});
export const liveCallLine=key=>LIVE_CALL_LINES[key]||'';
