// Fixed chat messages, never commands to the presenter or game engine.
export const FAMILY_REACTIONS=Object.freeze([
 Object.freeze({id:'applause',label:'Applaus',text:'👏 Applaus!'}),
 Object.freeze({id:'wow',label:'Wauw',text:'✨ Wauw!'}),
 Object.freeze({id:'cheer',label:'Hoera',text:'🎉 Hoera!'}),
 Object.freeze({id:'wave',label:'Zwaaien',text:'👋 Wij zwaaien!'}),
]);
export const familyReaction=id=>FAMILY_REACTIONS.find(reaction=>reaction.id===id)||null;
